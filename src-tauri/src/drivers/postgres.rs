use crate::core::dialect::DatabaseKind;
use crate::core::driver::DatabaseDriver;
use crate::core::protocol::{
    ColumnDef, ColumnInfo, ConstraintInfo, DatabaseInfo, ForeignKeyReferenceInfo, FunctionInfo,
    FunctionParameterInfo, IndexInfo, ParameterizedStatement, QueryParameter, QueryResult,
    SchemaObjectInfo, TableInfo, DEFAULT_QUERY_RESULT_ROW_LIMIT,
};
use crate::core::statement::{
    execution_mode, execution_statement_kind, split_sql_statements, QueryExecutionMode,
    StatementScanDialect,
};
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use futures::{StreamExt, TryStreamExt};
use sqlx::pool::PoolConnection;
use sqlx::postgres::types::{Oid, PgInterval, PgTimeTz};
use sqlx::postgres::{
    PgArguments, PgConnectOptions, PgPoolOptions, PgRow, PgTypeInfo, PgTypeKind, PgValueFormat,
};
use sqlx::query::Query;
use sqlx::types::chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use sqlx::types::{BigDecimal, Uuid};
use sqlx::{Column, ConnectOptions, Executor, Pool, Postgres, Row, TypeInfo, ValueRef};
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::time::timeout;

struct PostgresTransactionSession {
    connection: Mutex<PoolConnection<Postgres>>,
    /// A database-scoped session owns a dedicated one-connection pool. Keeping
    /// it beside the checked-out connection prevents a selected database from
    /// sharing (or being replaced by) the Explorer metadata pool.
    _database_pool: Option<Pool<Postgres>>,
}

type PostgresTransactionSessionHandle = Arc<PostgresTransactionSession>;
const POOL_CLOSE_TIMEOUT: Duration = Duration::from_secs(5);
const METADATA_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const METADATA_QUERY_TIMEOUT: Duration = Duration::from_secs(20);
const METADATA_POOL_IDLE_TIMEOUT: Duration = Duration::from_secs(60);
const METADATA_POOL_MAX_LIFETIME: Duration = Duration::from_secs(300);
const POSTGRES_BACKEND_PID_SQL: &str = "SELECT CAST(pg_backend_pid() AS TEXT)";

fn parse_postgres_backend_pid(value: &str) -> Option<i32> {
    value
        .trim()
        .parse::<i32>()
        .ok()
        .filter(|backend_pid| *backend_pid > 0)
}

/// PostgreSQL added `WITH ORDINALITY` in 9.4. Keep the boundary in one
/// testable place because catalog metadata must remain readable on 9.3.
fn postgres_supports_with_ordinality(server_version_num: i32) -> bool {
    server_version_num >= 90_400
}

/// INCLUDE columns and `pg_index.indnkeyatts` landed in PostgreSQL 11.
/// Returning a static, host-owned expression keeps older catalog queries from
/// referencing a column that their parser does not know about.
fn postgres_index_key_count_expression(server_version_num: i32) -> &'static str {
    if server_version_num >= 110_000 {
        "ix.indnkeyatts"
    } else {
        "COALESCE(array_length(ix.indkey::smallint[], 1), 0)"
    }
}

/// Keep a selected workspace schema first without discarding connection-level
/// search-path entries such as extension schemas or `$user`. PostgreSQL adds
/// `pg_catalog` implicitly when absent, but making it explicit preserves the
/// same name-resolution behavior after `set_config` replaces the path.
fn postgres_search_path_with_selected_schema(
    configured: &str,
    first_resolved_schema: Option<&str>,
    has_explicit_pg_catalog: bool,
    schema: &str,
) -> String {
    let selected_schema = DatabaseKind::Postgres.quote_identifier(schema);
    let configured = configured.trim();
    let mut path = if first_resolved_schema == Some(schema) {
        configured.to_string()
    } else if configured.is_empty() {
        selected_schema.clone()
    } else {
        format!("{selected_schema}, {configured}")
    };
    if path.is_empty() {
        path = selected_schema;
    }
    if !has_explicit_pg_catalog {
        path.push_str(", pg_catalog");
    }
    path
}

async fn configure_postgres_search_path(
    connection: &mut PoolConnection<Postgres>,
    schema: &str,
    local_to_transaction: bool,
) -> Result<()> {
    let selected_schema = DatabaseKind::Postgres.quote_identifier(schema);
    let baseline: Result<(String, Option<String>, bool)> = async {
        let row = sqlx::query(
            "SELECT current_setting('search_path'), (current_schemas(false))[1], \
             'pg_catalog' = ANY(current_schemas(false))",
        )
        .persistent(false)
        .fetch_one(&mut **connection)
        .await?;
        Ok((row.try_get(0)?, row.try_get(1)?, row.try_get(2)?))
    }
    .await;

    let search_path = match baseline {
        Ok((configured, first_resolved_schema, has_explicit_pg_catalog)) => {
            postgres_search_path_with_selected_schema(
                &configured,
                first_resolved_schema.as_deref(),
                has_explicit_pg_catalog,
                schema,
            )
        }
        Err(error) => {
            tracing::warn!(
                "Failed to read PostgreSQL search_path baseline; using selected-schema fallback: {}",
                error
            );
            selected_schema
        }
    };

    sqlx::query("SELECT set_config('search_path', $1, $2)")
        .bind(search_path)
        .bind(local_to_transaction)
        .persistent(false)
        .execute(&mut **connection)
        .await?;
    Ok(())
}

struct PostgresMetadataPool {
    database: String,
    pool: Pool<Postgres>,
}

pub struct PostgresDriver {
    pub pool: Mutex<Option<Pool<Postgres>>>,
    pub connection_string: String,
    transaction_sessions: Mutex<HashMap<String, PostgresTransactionSessionHandle>>,
    pub active_queries: StdMutex<HashMap<String, i32>>,
    /// A single cached pool for read-only Database Explorer metadata. Holding
    /// this mutex across a metadata query serializes database switches, so the
    /// driver can never create more than one additional PostgreSQL connection.
    metadata_pool: Mutex<Option<PostgresMetadataPool>>,
}

struct PostgresTrackedQueryGuard<'a> {
    active_queries: &'a StdMutex<HashMap<String, i32>>,
    query_id: Option<String>,
}

impl Drop for PostgresTrackedQueryGuard<'_> {
    fn drop(&mut self) {
        if let Some(query_id) = self.query_id.take() {
            let mut active_queries = self
                .active_queries
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            active_queries.remove(&query_id);
        }
    }
}

impl PostgresDriver {
    pub fn new(connection_string: &str) -> Self {
        Self {
            pool: Mutex::new(None),
            connection_string: connection_string.to_string(),
            transaction_sessions: Mutex::new(HashMap::new()),
            active_queries: StdMutex::new(HashMap::new()),
            metadata_pool: Mutex::new(None),
        }
    }

    async fn get_pool(&self) -> Result<Pool<Postgres>> {
        let pool = self.pool.lock().await;
        pool.clone().ok_or_else(|| anyhow!("Not connected"))
    }

    fn metadata_connect_options(&self, database: &str) -> Result<PgConnectOptions> {
        if database.is_empty() {
            return Err(anyhow!("PostgreSQL database name cannot be empty"));
        }
        if database.contains('\0') {
            return Err(anyhow!("PostgreSQL database name cannot contain NUL bytes"));
        }

        Ok(PgConnectOptions::from_str(&self.connection_string)?
            .database(database)
            .disable_statement_logging()
            .statement_cache_capacity(0)
            .to_owned())
    }

    async fn ensure_metadata_pool(
        &self,
        slot: &mut Option<PostgresMetadataPool>,
        database: &str,
    ) -> Result<Pool<Postgres>> {
        if let Some(cached) = slot.as_ref() {
            if cached.database == database && !cached.pool.is_closed() {
                return Ok(cached.pool.clone());
            }
        }

        if let Some(stale) = slot.take() {
            if timeout(POOL_CLOSE_TIMEOUT, stale.pool.close())
                .await
                .is_err()
            {
                let stale_database = stale.database.clone();
                *slot = Some(stale);
                return Err(anyhow!(
                    "Timed out closing PostgreSQL metadata connection for database '{}'; database switch was cancelled",
                    stale_database
                ));
            }
        }

        let options = self.metadata_connect_options(database)?;
        let connect = PgPoolOptions::new()
            .min_connections(0)
            .max_connections(1)
            .acquire_timeout(METADATA_CONNECT_TIMEOUT)
            .idle_timeout(Some(METADATA_POOL_IDLE_TIMEOUT))
            .max_lifetime(Some(METADATA_POOL_MAX_LIFETIME))
            .connect_with(options);
        let pool = timeout(METADATA_CONNECT_TIMEOUT, connect)
            .await
            .map_err(|_| {
                anyhow!(
                    "Timed out connecting to PostgreSQL database '{}' for metadata",
                    database
                )
            })??;

        *slot = Some(PostgresMetadataPool {
            database: database.to_string(),
            pool: pool.clone(),
        });
        Ok(pool)
    }

    async fn schemas_on_pool(pool: &Pool<Postgres>) -> Result<Vec<String>> {
        let rows = sqlx::query(
            "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast') ORDER BY schema_name",
        )
        .persistent(false)
        .fetch_all(pool)
        .await?;

        Ok(rows
            .iter()
            .map(|row| row.try_get(0).unwrap_or_default())
            .collect())
    }

    async fn tables_on_pool(pool: &Pool<Postgres>, schema: &str) -> Result<Vec<TableInfo>> {
        let rows = sqlx::query(
            r#"
            SELECT
                c.relname AS table_name,
                CASE c.relkind
                    WHEN 'r' THEN 'BASE TABLE'
                    WHEN 'p' THEN 'PARTITIONED TABLE'
                    WHEN 'v' THEN 'VIEW'
                    WHEN 'm' THEN 'MATERIALIZED VIEW'
                    WHEN 'f' THEN 'FOREIGN TABLE'
                    ELSE c.relkind::text
                END AS table_type,
                obj_description(c.oid, 'pg_class') AS comment
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = $1
              AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
            ORDER BY c.relname
            "#,
        )
        .bind(schema)
        .persistent(false)
        .fetch_all(pool)
        .await?;

        Ok(rows
            .iter()
            .map(|row| TableInfo {
                name: row.try_get("table_name").unwrap_or_default(),
                schema: Some(schema.to_string()),
                table_type: row.try_get("table_type").ok(),
                comment: row.try_get("comment").ok(),
            })
            .collect())
    }

    /// Schema-object discovery is intentionally descriptor-only. Definitions,
    /// ownership mutation and transfer behavior require their own reviewed
    /// contracts and are not derived from this Explorer list.
    async fn schema_objects_on_pool(
        pool: &Pool<Postgres>,
        schema: &str,
    ) -> Result<Vec<SchemaObjectInfo>> {
        let rows = sqlx::query(
            r#"
            SELECT
                c.relname AS object_name,
                'sequence'::text AS object_type,
                NULL::text AS parent_name,
                obj_description(c.oid, 'pg_class') AS comment
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = $1
              AND c.relkind = 'S'
            UNION ALL
            SELECT
                t.tgname AS object_name,
                'trigger'::text AS object_type,
                c.relname AS parent_name,
                obj_description(t.oid, 'pg_trigger') AS comment
            FROM pg_trigger t
            JOIN pg_class c ON c.oid = t.tgrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = $1
              AND NOT t.tgisinternal
            UNION ALL
            SELECT
                ty.typname AS object_name,
                'domain'::text AS object_type,
                NULL::text AS parent_name,
                obj_description(ty.oid, 'pg_type') AS comment
            FROM pg_type ty
            JOIN pg_namespace n ON n.oid = ty.typnamespace
            WHERE n.nspname = $1
              AND ty.typtype = 'd'
            UNION ALL
            SELECT
                ty.typname AS object_name,
                'enum type'::text AS object_type,
                NULL::text AS parent_name,
                obj_description(ty.oid, 'pg_type') AS comment
            FROM pg_type ty
            JOIN pg_namespace n ON n.oid = ty.typnamespace
            WHERE n.nspname = $1
              AND ty.typtype = 'e'
            UNION ALL
            SELECT
                ty.typname AS object_name,
                'composite type'::text AS object_type,
                NULL::text AS parent_name,
                obj_description(ty.oid, 'pg_type') AS comment
            FROM pg_type ty
            JOIN pg_namespace n ON n.oid = ty.typnamespace
            LEFT JOIN pg_class relation ON relation.oid = ty.typrelid
            WHERE n.nspname = $1
              AND ty.typtype = 'c'
              AND relation.relkind = 'c'
            UNION ALL
            SELECT
                ty.typname AS object_name,
                'range type'::text AS object_type,
                NULL::text AS parent_name,
                obj_description(ty.oid, 'pg_type') AS comment
            FROM pg_type ty
            JOIN pg_namespace n ON n.oid = ty.typnamespace
            WHERE n.nspname = $1
              AND ty.typtype = 'r'
            UNION ALL
            SELECT
                ty.typname AS object_name,
                'multirange type'::text AS object_type,
                NULL::text AS parent_name,
                obj_description(ty.oid, 'pg_type') AS comment
            FROM pg_type ty
            JOIN pg_namespace n ON n.oid = ty.typnamespace
            WHERE n.nspname = $1
              AND ty.typtype = 'm'
            UNION ALL
            SELECT
                e.extname AS object_name,
                'extension'::text AS object_type,
                NULL::text AS parent_name,
                obj_description(e.oid, 'pg_extension') AS comment
            FROM pg_extension e
            JOIN pg_namespace n ON n.oid = e.extnamespace
            WHERE n.nspname = $1
            UNION ALL
            SELECT
                child.relname AS object_name,
                'partition'::text AS object_type,
                parent.relname AS parent_name,
                obj_description(child.oid, 'pg_class') AS comment
            FROM pg_inherits i
            JOIN pg_class child ON child.oid = i.inhrelid
            JOIN pg_class parent ON parent.oid = i.inhparent
            JOIN pg_namespace n ON n.oid = child.relnamespace
            WHERE n.nspname = $1
            ORDER BY object_type, object_name
            "#,
        )
        .bind(schema)
        .persistent(false)
        .fetch_all(pool)
        .await?;

        Ok(rows
            .iter()
            .map(|row| SchemaObjectInfo {
                name: row.try_get("object_name").unwrap_or_default(),
                schema: Some(schema.to_string()),
                object_type: row.try_get("object_type").unwrap_or_default(),
                parent_name: row.try_get("parent_name").ok(),
                comment: row.try_get("comment").ok(),
                members_expandable: false,
            })
            .collect())
    }

    async fn functions_on_pool(pool: &Pool<Postgres>, schema: &str) -> Result<Vec<FunctionInfo>> {
        let current = sqlx::query(
            r#"
            SELECT
                p.proname AS function_name,
                pg_get_function_arguments(p.oid) AS arguments,
                CASE
                    WHEN p.prokind = 'p' THEN 'procedure'
                    ELSE 'function'
                END AS routine_type,
                CASE
                    WHEN p.prokind = 'p' THEN 'void'
                    ELSE pg_get_function_result(p.oid)
                END AS return_type,
                obj_description(p.oid, 'pg_proc') AS description
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = $1
              AND p.prokind IN ('f', 'p')
            ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)
            "#,
        )
        .bind(schema)
        .persistent(false)
        .fetch_all(pool)
        .await;
        let rows = match current {
            Ok(rows) => rows,
            Err(error) if Self::postgres_missing_prokind_error(&error.to_string()) => {
                sqlx::query(
                    r#"
                SELECT p.proname AS function_name, pg_get_function_arguments(p.oid) AS arguments,
                       'function' AS routine_type, pg_get_function_result(p.oid) AS return_type,
                       obj_description(p.oid, 'pg_proc') AS description
                FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = $1 AND NOT p.proisagg ORDER BY p.proname, p.oid
                "#,
                )
                .bind(schema)
                .persistent(false)
                .fetch_all(pool)
                .await?
            }
            Err(error) => return Err(error.into()),
        };

        Ok(rows
            .iter()
            .map(|row| {
                let arguments = row.try_get::<String, _>("arguments").unwrap_or_default();
                FunctionInfo {
                    name: row.try_get("function_name").unwrap_or_default(),
                    routine_type: row.try_get("routine_type").ok(),
                    parameters: parse_postgres_function_parameters(&arguments),
                    return_type: row
                        .try_get("return_type")
                        .unwrap_or_else(|_| "unknown".to_string()),
                    description: row.try_get("description").ok(),
                }
            })
            .collect())
    }

    fn postgres_missing_prokind_error(error: &str) -> bool {
        let lower = error.to_ascii_lowercase();
        (lower.contains("sqlstate 42703")
            || lower.contains("column") && lower.contains("does not exist")
            || error.contains("字段") && error.contains("不存在"))
            && (lower.contains("p.prokind")
                || lower.contains("\"prokind\"")
                || error.contains("p.prokind"))
    }

    async fn columns_on_pool(
        pool: &Pool<Postgres>,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ColumnInfo>> {
        let rows = sqlx::query(
            r#"
            SELECT
                a.attname AS column_name,
                format_type(a.atttypid, a.atttypmod) AS data_type,
                NOT a.attnotnull AS is_nullable,
                pg_get_expr(ad.adbin, ad.adrelid) AS column_default,
                (
                    a.attidentity <> ''
                    OR COALESCE(pg_get_expr(ad.adbin, ad.adrelid), '') LIKE 'nextval(%'
                ) AS is_auto_increment,
                CASE a.attidentity
                    WHEN 'a' THEN 'always'
                    WHEN 'd' THEN 'byDefault'
                    ELSE NULL
                END AS identity_generation,
                COALESCE(to_jsonb(a)->>'attgenerated', '') <> '' AS is_generated,
                d.description AS column_comment,
                EXISTS (
                    SELECT 1
                    FROM pg_constraint con
                    WHERE con.conrelid = t.oid
                      AND con.contype = 'p'
                      AND a.attnum = ANY(con.conkey)
                ) as is_primary_key,
                EXISTS (
                    SELECT 1
                    FROM pg_constraint con
                    WHERE con.conrelid = t.oid
                      AND con.contype IN ('p', 'u')
                      AND a.attnum = ANY(con.conkey)
                ) as is_unique,
                EXISTS (
                    SELECT 1
                    FROM pg_index i
                    WHERE i.indrelid = t.oid
                      AND a.attnum = ANY(i.indkey)
                ) as is_indexed
            FROM pg_class t
            JOIN pg_namespace n ON n.oid = t.relnamespace
            JOIN pg_attribute a ON a.attrelid = t.oid
            LEFT JOIN pg_attrdef ad ON ad.adrelid = t.oid AND ad.adnum = a.attnum
            LEFT JOIN pg_description d ON d.objoid = t.oid AND d.objsubid = a.attnum
            WHERE n.nspname = $1
              AND t.relname = $2
              AND t.relkind IN ('r', 'p', 'v', 'm', 'f')
              AND a.attnum > 0
              AND NOT a.attisdropped
            ORDER BY a.attnum
            "#,
        )
        .bind(schema)
        .bind(table)
        .persistent(false)
        .fetch_all(pool)
        .await?;

        Ok(rows
            .iter()
            .map(|row| {
                let is_nullable = row.try_get::<bool, _>("is_nullable").unwrap_or(true);
                let is_primary_key = row.try_get::<bool, _>("is_primary_key").unwrap_or(false);
                let is_unique = row.try_get::<bool, _>("is_unique").unwrap_or(false);
                let is_indexed = row.try_get::<bool, _>("is_indexed").unwrap_or(false);

                ColumnInfo {
                    name: row.try_get("column_name").unwrap_or_default(),
                    data_type: row.try_get("data_type").unwrap_or_default(),
                    is_nullable,
                    is_primary_key,
                    is_unique,
                    is_indexed,
                    is_auto_increment: row.try_get("is_auto_increment").unwrap_or(false),
                    identity_generation: row
                        .try_get::<Option<String>, _>("identity_generation")
                        .ok()
                        .flatten(),
                    is_generated: Some(row.try_get("is_generated").unwrap_or(false)),
                    is_hidden: Some(false),
                    default_value: row.try_get("column_default").ok(),
                    comment: row.try_get("column_comment").ok(),
                }
            })
            .collect())
    }

    async fn generated_columns_on_pool(
        pool: &Pool<Postgres>,
        schema: &str,
        table: &str,
    ) -> Result<Vec<String>> {
        let server_version_num =
            sqlx::query_scalar::<_, i32>("SELECT current_setting('server_version_num')::integer")
                .persistent(false)
                .fetch_one(pool)
                .await?;
        // PostgreSQL added stored generated columns and `attgenerated` in 12.
        // Older supported servers cannot contain such columns, and querying
        // the newer catalog field would itself fail during export.
        if server_version_num < 120_000 {
            return Ok(Vec::new());
        }

        let rows = sqlx::query(
            r#"
            SELECT a.attname
            FROM pg_class t
            JOIN pg_namespace n ON n.oid = t.relnamespace
            JOIN pg_attribute a ON a.attrelid = t.oid
            WHERE n.nspname = $1
              AND t.relname = $2
              AND t.relkind IN ('r', 'p')
              AND a.attnum > 0
              AND NOT a.attisdropped
              AND a.attgenerated <> ''
            ORDER BY a.attnum
            "#,
        )
        .bind(schema)
        .bind(table)
        .persistent(false)
        .fetch_all(pool)
        .await?;

        Ok(rows
            .iter()
            .filter_map(|row| row.try_get("attname").ok())
            .collect())
    }

    async fn requires_identity_override_on_pool(
        pool: &Pool<Postgres>,
        schema: &str,
        table: &str,
    ) -> Result<bool> {
        let server_version_num =
            sqlx::query_scalar::<_, i32>("SELECT current_setting('server_version_num')::integer")
                .persistent(false)
                .fetch_one(pool)
                .await?;
        // Identity columns and `pg_attribute.attidentity` were introduced in
        // PostgreSQL 10. Older servers require no override and cannot safely
        // parse a query referencing the newer catalog field.
        if server_version_num < 100_000 {
            return Ok(false);
        }

        sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM pg_class t
                JOIN pg_namespace n ON n.oid = t.relnamespace
                JOIN pg_attribute a ON a.attrelid = t.oid
                WHERE n.nspname = $1
                  AND t.relname = $2
                  AND t.relkind IN ('r', 'p')
                  AND a.attnum > 0
                  AND NOT a.attisdropped
                  AND a.attidentity = 'a'
            )
            "#,
        )
        .bind(schema)
        .bind(table)
        .persistent(false)
        .fetch_one(pool)
        .await
        .map_err(Into::into)
    }

    async fn indexes_on_pool(
        pool: &Pool<Postgres>,
        schema: &str,
        table: &str,
    ) -> Result<Vec<IndexInfo>> {
        let server_version_num =
            sqlx::query_scalar::<_, i32>("SELECT current_setting('server_version_num')::integer")
                .persistent(false)
                .fetch_one(pool)
                .await?;
        // INCLUDE columns and pg_index.indnkeyatts were introduced in 11.
        // Older supported servers expose every indkey entry as a key, and
        // must not parse a reference to the newer catalog field.
        let key_count_expression = postgres_index_key_count_expression(server_version_num);
        let sql = format!(
            r#"
            SELECT
                i.relname AS index_name,
                ix.indisunique,
                ix.indisprimary,
                am.amname AS index_type,
                pg_get_indexdef(ix.indexrelid) AS definition,
                pg_get_expr(ix.indpred, ix.indrelid) AS filter_expression,
                obj_description(ix.indexrelid, 'pg_class') AS index_comment,
                COALESCE(ARRAY(
                    SELECT COALESCE(
                        a.attname,
                        pg_get_indexdef(ix.indexrelid, positions.position, true)
                    )
                    FROM generate_series(
                        1,
                        COALESCE(array_length(ix.indkey::smallint[], 1), 0)
                    ) AS positions(position)
                    LEFT JOIN pg_attribute a
                      ON a.attrelid = ix.indrelid
                     AND a.attnum = (ix.indkey::smallint[])[
                         array_lower(ix.indkey::smallint[], 1) + positions.position - 1
                     ]
                     AND a.attnum > 0
                    ORDER BY positions.position
                ), ARRAY[]::text[]) AS all_columns,
                {key_count_expression} AS key_count,
                COALESCE(ARRAY(
                    SELECT (ix.indkey::smallint[])[
                        array_lower(ix.indkey::smallint[], 1) + positions.position - 1
                    ] = 0
                    FROM generate_series(
                        1,
                        COALESCE(array_length(ix.indkey::smallint[], 1), 0)
                    ) AS positions(position)
                    ORDER BY positions.position
                ), ARRAY[]::boolean[]) AS all_key_is_expression
            FROM pg_class t
            JOIN pg_namespace n ON n.oid = t.relnamespace
            JOIN pg_index ix ON ix.indrelid = t.oid
            JOIN pg_class i ON i.oid = ix.indexrelid
            JOIN pg_am am ON am.oid = i.relam
            WHERE n.nspname = $1 AND t.relname = $2
            ORDER BY ix.indisprimary DESC, ix.indisunique DESC, i.relname
            "#
        );
        let rows = sqlx::query(&sql)
            .bind(schema)
            .bind(table)
            .persistent(false)
            .fetch_all(pool)
            .await?;

        Ok(rows
            .iter()
            .map(|row| {
                let all_columns = row
                    .try_get::<Vec<String>, _>("all_columns")
                    .unwrap_or_default();
                let key_count = row
                    .try_get::<i32, _>("key_count")
                    .unwrap_or(all_columns.len() as i32)
                    .max(0) as usize;
                let split_at = key_count.min(all_columns.len());
                let all_key_is_expression = row
                    .try_get::<Vec<bool>, _>("all_key_is_expression")
                    .unwrap_or_default();
                IndexInfo {
                    name: row.try_get("index_name").unwrap_or_default(),
                    columns: all_columns[..split_at].to_vec(),
                    is_unique: row.try_get("indisunique").unwrap_or(false),
                    is_primary: row.try_get("indisprimary").unwrap_or(false),
                    filter: row
                        .try_get::<String, _>("filter_expression")
                        .ok()
                        .filter(|filter| !filter.trim().is_empty()),
                    index_type: row.try_get("index_type").ok(),
                    included_columns: (split_at < all_columns.len())
                        .then(|| all_columns[split_at..].to_vec()),
                    definition: row.try_get("definition").ok(),
                    comment: row
                        .try_get::<String, _>("index_comment")
                        .ok()
                        .filter(|comment| !comment.trim().is_empty()),
                    key_is_expression: if all_key_is_expression.len() == all_columns.len() {
                        all_key_is_expression[..split_at].to_vec()
                    } else {
                        Vec::new()
                    },
                }
            })
            .collect())
    }

    async fn constraints_on_pool(
        pool: &Pool<Postgres>,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ConstraintInfo>> {
        let supports_with_ordinality = Self::supports_with_ordinality(pool).await?;
        let sql = if supports_with_ordinality {
            r#"
            SELECT
                c.conname AS constraint_name,
                CASE c.contype
                    WHEN 'p' THEN 'PRIMARY KEY'
                    WHEN 'f' THEN 'FOREIGN KEY'
                    WHEN 'u' THEN 'UNIQUE'
                    WHEN 'c' THEN 'CHECK'
                    WHEN 'x' THEN 'EXCLUDE'
                    ELSE c.contype::text
                END AS constraint_type,
                pg_get_constraintdef(c.oid) AS definition,
                COALESCE((
                    SELECT array_agg(a.attname ORDER BY keys.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS keys(attnum, ordinality)
                    JOIN pg_attribute a
                      ON a.attrelid = c.conrelid
                     AND a.attnum = keys.attnum
                ), ARRAY[]::text[]) AS columns,
                ref_ns.nspname AS referenced_schema,
                ref_table.relname AS referenced_table,
                CASE c.confupdtype
                    WHEN 'a' THEN 'NO ACTION'
                    WHEN 'r' THEN 'RESTRICT'
                    WHEN 'c' THEN 'CASCADE'
                    WHEN 'n' THEN 'SET NULL'
                    WHEN 'd' THEN 'SET DEFAULT'
                    ELSE NULL
                END AS on_update,
                CASE c.confdeltype
                    WHEN 'a' THEN 'NO ACTION'
                    WHEN 'r' THEN 'RESTRICT'
                    WHEN 'c' THEN 'CASCADE'
                    WHEN 'n' THEN 'SET NULL'
                    WHEN 'd' THEN 'SET DEFAULT'
                    ELSE NULL
                END AS on_delete,
                COALESCE((
                    SELECT array_agg(a.attname ORDER BY keys.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS keys(attnum, ordinality)
                    JOIN pg_attribute a
                      ON a.attrelid = c.confrelid
                     AND a.attnum = keys.attnum
                ), ARRAY[]::text[]) AS referenced_columns
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            LEFT JOIN pg_class ref_table ON ref_table.oid = c.confrelid
            LEFT JOIN pg_namespace ref_ns ON ref_ns.oid = ref_table.relnamespace
            WHERE n.nspname = $1 AND t.relname = $2
            ORDER BY c.contype, c.conname
            "#
        } else {
            // PostgreSQL 9.3 and a few compatible servers do not support
            // WITH ORDINALITY. Generate array positions explicitly so an
            // otherwise read-only metadata lookup never falls back to
            // information_schema visibility rules.
            r#"
            SELECT
                c.conname AS constraint_name,
                CASE c.contype
                    WHEN 'p' THEN 'PRIMARY KEY'
                    WHEN 'f' THEN 'FOREIGN KEY'
                    WHEN 'u' THEN 'UNIQUE'
                    WHEN 'c' THEN 'CHECK'
                    WHEN 'x' THEN 'EXCLUDE'
                    ELSE c.contype::text
                END AS constraint_type,
                pg_get_constraintdef(c.oid) AS definition,
                COALESCE((
                    SELECT array_agg(a.attname ORDER BY keys.ordinality)
                    FROM generate_subscripts(c.conkey, 1) AS keys(ordinality)
                    JOIN pg_attribute a
                      ON a.attrelid = c.conrelid
                     AND a.attnum = c.conkey[keys.ordinality]
                ), ARRAY[]::text[]) AS columns,
                ref_ns.nspname AS referenced_schema,
                ref_table.relname AS referenced_table,
                CASE c.confupdtype
                    WHEN 'a' THEN 'NO ACTION'
                    WHEN 'r' THEN 'RESTRICT'
                    WHEN 'c' THEN 'CASCADE'
                    WHEN 'n' THEN 'SET NULL'
                    WHEN 'd' THEN 'SET DEFAULT'
                    ELSE NULL
                END AS on_update,
                CASE c.confdeltype
                    WHEN 'a' THEN 'NO ACTION'
                    WHEN 'r' THEN 'RESTRICT'
                    WHEN 'c' THEN 'CASCADE'
                    WHEN 'n' THEN 'SET NULL'
                    WHEN 'd' THEN 'SET DEFAULT'
                    ELSE NULL
                END AS on_delete,
                COALESCE((
                    SELECT array_agg(a.attname ORDER BY keys.ordinality)
                    FROM generate_subscripts(c.confkey, 1) AS keys(ordinality)
                    JOIN pg_attribute a
                      ON a.attrelid = c.confrelid
                     AND a.attnum = c.confkey[keys.ordinality]
                ), ARRAY[]::text[]) AS referenced_columns
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = t.relnamespace
            LEFT JOIN pg_class ref_table ON ref_table.oid = c.confrelid
            LEFT JOIN pg_namespace ref_ns ON ref_ns.oid = ref_table.relnamespace
            WHERE n.nspname = $1 AND t.relname = $2
            ORDER BY c.contype, c.conname
            "#
        };
        let rows = sqlx::query(sql)
            .bind(schema)
            .bind(table)
            .persistent(false)
            .fetch_all(pool)
            .await?;

        Ok(rows
            .iter()
            .map(|row| ConstraintInfo {
                name: row.try_get("constraint_name").unwrap_or_default(),
                constraint_type: row.try_get("constraint_type").unwrap_or_default(),
                columns: row.try_get("columns").unwrap_or_default(),
                referenced_schema: row.try_get("referenced_schema").ok(),
                referenced_table: row.try_get("referenced_table").ok(),
                referenced_columns: row.try_get("referenced_columns").unwrap_or_default(),
                definition: row.try_get("definition").ok(),
                on_update: row.try_get("on_update").ok(),
                on_delete: row.try_get("on_delete").ok(),
            })
            .collect())
    }

    async fn supports_with_ordinality(pool: &Pool<Postgres>) -> Result<bool> {
        let server_version_num =
            sqlx::query_scalar::<_, i32>("SELECT current_setting('server_version_num')::integer")
                .persistent(false)
                .fetch_one(pool)
                .await?;
        // WITH ORDINALITY landed in PostgreSQL 9.4. Keep the catalog route
        // for read-only users on 9.3 instead of depending on information_schema.
        Ok(postgres_supports_with_ordinality(server_version_num))
    }

    async fn referencing_foreign_keys_on_pool(
        pool: &Pool<Postgres>,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ForeignKeyReferenceInfo>> {
        let supports_with_ordinality = Self::supports_with_ordinality(pool).await?;
        let sql = if supports_with_ordinality {
            r#"
            SELECT
                c.conname AS constraint_name,
                owner_ns.nspname AS owner_schema,
                owner_table.relname AS owner_table,
                COALESCE((
                    SELECT array_agg(a.attname ORDER BY keys.ordinality)
                    FROM unnest(c.conkey) WITH ORDINALITY AS keys(attnum, ordinality)
                    JOIN pg_attribute a
                      ON a.attrelid = c.conrelid
                     AND a.attnum = keys.attnum
                ), ARRAY[]::text[]) AS columns,
                ref_ns.nspname AS referenced_schema,
                ref_table.relname AS referenced_table,
                COALESCE((
                    SELECT array_agg(a.attname ORDER BY keys.ordinality)
                    FROM unnest(c.confkey) WITH ORDINALITY AS keys(attnum, ordinality)
                    JOIN pg_attribute a
                      ON a.attrelid = c.confrelid
                     AND a.attnum = keys.attnum
                ), ARRAY[]::text[]) AS referenced_columns
            FROM pg_constraint c
            JOIN pg_class owner_table ON owner_table.oid = c.conrelid
            JOIN pg_namespace owner_ns ON owner_ns.oid = owner_table.relnamespace
            JOIN pg_class ref_table ON ref_table.oid = c.confrelid
            JOIN pg_namespace ref_ns ON ref_ns.oid = ref_table.relnamespace
            WHERE c.contype = 'f'
              AND ref_ns.nspname = $1
              AND ref_table.relname = $2
            ORDER BY owner_ns.nspname, owner_table.relname, c.conname
            "#
        } else {
            r#"
            SELECT
                c.conname AS constraint_name,
                owner_ns.nspname AS owner_schema,
                owner_table.relname AS owner_table,
                COALESCE((
                    SELECT array_agg(a.attname ORDER BY keys.ordinality)
                    FROM generate_subscripts(c.conkey, 1) AS keys(ordinality)
                    JOIN pg_attribute a
                      ON a.attrelid = c.conrelid
                     AND a.attnum = c.conkey[keys.ordinality]
                ), ARRAY[]::text[]) AS columns,
                ref_ns.nspname AS referenced_schema,
                ref_table.relname AS referenced_table,
                COALESCE((
                    SELECT array_agg(a.attname ORDER BY keys.ordinality)
                    FROM generate_subscripts(c.confkey, 1) AS keys(ordinality)
                    JOIN pg_attribute a
                      ON a.attrelid = c.confrelid
                     AND a.attnum = c.confkey[keys.ordinality]
                ), ARRAY[]::text[]) AS referenced_columns
            FROM pg_constraint c
            JOIN pg_class owner_table ON owner_table.oid = c.conrelid
            JOIN pg_namespace owner_ns ON owner_ns.oid = owner_table.relnamespace
            JOIN pg_class ref_table ON ref_table.oid = c.confrelid
            JOIN pg_namespace ref_ns ON ref_ns.oid = ref_table.relnamespace
            WHERE c.contype = 'f'
              AND ref_ns.nspname = $1
              AND ref_table.relname = $2
            ORDER BY owner_ns.nspname, owner_table.relname, c.conname
            "#
        };
        let rows = sqlx::query(sql)
            .bind(schema)
            .bind(table)
            .persistent(false)
            .fetch_all(pool)
            .await?;

        Ok(rows
            .iter()
            .map(|row| ForeignKeyReferenceInfo {
                name: row.try_get("constraint_name").unwrap_or_default(),
                schema: row.try_get("owner_schema").unwrap_or_default(),
                table: row.try_get("owner_table").unwrap_or_default(),
                columns: row.try_get("columns").unwrap_or_default(),
                referenced_schema: row.try_get("referenced_schema").unwrap_or_default(),
                referenced_table: row.try_get("referenced_table").unwrap_or_default(),
                referenced_columns: row.try_get("referenced_columns").unwrap_or_default(),
            })
            .collect())
    }

    fn process_rows(
        &self,
        rows: Vec<PgRow>,
        empty_columns: Vec<ColumnDef>,
    ) -> Result<Vec<QueryResult>> {
        if rows.is_empty() {
            return Ok(vec![QueryResult::rows(empty_columns, Vec::new())]);
        }

        let first_row = &rows[0];
        let columns: Vec<ColumnDef> = first_row
            .columns()
            .iter()
            .map(|c| ColumnDef {
                name: c.name().to_string(),
                data_type: c.type_info().name().to_string(),
            })
            .collect();

        let mut data_rows = Vec::new();
        for row in rows {
            let mut row_values = Vec::new();
            for (i, _) in columns.iter().enumerate() {
                let val = decode_pg_value(&row, i);
                row_values.push(val);
            }
            data_rows.push(row_values);
        }

        Ok(vec![QueryResult::rows_limited(
            columns,
            data_rows,
            DEFAULT_QUERY_RESULT_ROW_LIMIT,
        )])
    }

    async fn process_pool_rows(
        &self,
        sql: &str,
        rows: Vec<PgRow>,
        pool: &Pool<Postgres>,
    ) -> Result<Vec<QueryResult>> {
        let columns = if rows.is_empty() {
            pool.describe(sql)
                .await
                .map(|description| {
                    description
                        .columns()
                        .iter()
                        .map(|column| ColumnDef {
                            name: column.name().to_string(),
                            data_type: column.type_info().name().to_string(),
                        })
                        .collect()
                })
                .unwrap_or_default()
        } else {
            Vec::new()
        };
        self.process_rows(rows, columns)
    }

    async fn process_connection_rows(
        &self,
        sql: &str,
        rows: Vec<PgRow>,
        conn: &mut sqlx::PgConnection,
    ) -> Result<Vec<QueryResult>> {
        let columns = if rows.is_empty() {
            (&mut *conn)
                .describe(sql)
                .await
                .map(|description| {
                    description
                        .columns()
                        .iter()
                        .map(|column| ColumnDef {
                            name: column.name().to_string(),
                            data_type: column.type_info().name().to_string(),
                        })
                        .collect()
                })
                .unwrap_or_default()
        } else {
            Vec::new()
        };
        self.process_rows(rows, columns)
    }

    async fn query_single_on_pool(
        &self,
        sql: &str,
        pool: &Pool<Postgres>,
    ) -> Result<Vec<QueryResult>> {
        match execution_mode(sql) {
            QueryExecutionMode::ReturnsRows => {
                let rows = sqlx::query(sql)
                    .persistent(false)
                    .fetch(pool)
                    .take(DEFAULT_QUERY_RESULT_ROW_LIMIT + 1)
                    .try_collect::<Vec<_>>()
                    .await?;
                self.process_pool_rows(sql, rows, pool).await
            }
            QueryExecutionMode::AffectsRows => {
                let result = sqlx::query(sql).persistent(false).execute(pool).await?;
                Ok(vec![QueryResult::execution(
                    execution_statement_kind(sql).as_str(),
                    result.rows_affected(),
                )])
            }
        }
    }

    async fn query_on_pool(&self, sql: &str, pool: &Pool<Postgres>) -> Result<Vec<QueryResult>> {
        let statements = split_sql_statements(sql, StatementScanDialect::Postgres);
        if statements.is_empty() {
            return Ok(Vec::new());
        }
        if statements.len() <= 1 {
            return self.query_single_on_pool(statements[0], pool).await;
        }

        let mut connection = pool.acquire().await?;
        // A script may change session or transaction state. Never return that connection to the
        // pool if execution is cancelled between statements or the script leaves a transaction
        // open; dropping it closes the backend connection instead.
        connection.close_on_drop();
        let mut results = Vec::with_capacity(statements.len());
        for statement in statements {
            results.extend(
                self.query_single_on_connection(statement, &mut connection)
                    .await?,
            );
        }
        Ok(results)
    }

    async fn query_parameterized_on_pool(
        &self,
        sql: &str,
        params: &[QueryParameter],
        pool: &Pool<Postgres>,
    ) -> Result<Vec<QueryResult>> {
        match execution_mode(sql) {
            QueryExecutionMode::ReturnsRows => {
                let mut query = sqlx::query(sql).persistent(false);
                for param in params {
                    query = bind_pg_parameter(query, param)?;
                }
                let rows = query
                    .fetch(pool)
                    .take(DEFAULT_QUERY_RESULT_ROW_LIMIT + 1)
                    .try_collect::<Vec<_>>()
                    .await?;
                self.process_pool_rows(sql, rows, pool).await
            }
            QueryExecutionMode::AffectsRows => {
                let mut query = sqlx::query(sql).persistent(false);
                for param in params {
                    query = bind_pg_parameter(query, param)?;
                }
                let result = query.execute(pool).await?;
                Ok(vec![QueryResult::execution(
                    execution_statement_kind(sql).as_str(),
                    result.rows_affected(),
                )])
            }
        }
    }

    async fn query_single_on_connection(
        &self,
        sql: &str,
        conn: &mut sqlx::PgConnection,
    ) -> Result<Vec<QueryResult>> {
        match execution_mode(sql) {
            QueryExecutionMode::ReturnsRows => {
                let rows = {
                    let stream = sqlx::query(sql).persistent(false).fetch(&mut *conn);
                    stream
                        .take(DEFAULT_QUERY_RESULT_ROW_LIMIT + 1)
                        .try_collect::<Vec<_>>()
                        .await?
                };
                self.process_connection_rows(sql, rows, conn).await
            }
            QueryExecutionMode::AffectsRows => {
                let result = sqlx::query(sql)
                    .persistent(false)
                    .execute(&mut *conn)
                    .await?;
                Ok(vec![QueryResult::execution(
                    execution_statement_kind(sql).as_str(),
                    result.rows_affected(),
                )])
            }
        }
    }

    async fn query_on_connection(
        &self,
        sql: &str,
        conn: &mut sqlx::PgConnection,
    ) -> Result<Vec<QueryResult>> {
        let statements = split_sql_statements(sql, StatementScanDialect::Postgres);
        if statements.is_empty() {
            return Ok(Vec::new());
        }
        if statements.len() <= 1 {
            return self.query_single_on_connection(statements[0], conn).await;
        }

        let mut results = Vec::with_capacity(statements.len());
        for statement in statements {
            results.extend(self.query_single_on_connection(statement, conn).await?);
        }
        Ok(results)
    }

    async fn track_query_on_connection<'a>(
        &'a self,
        query_id: Option<&str>,
        conn: &mut sqlx::PgConnection,
    ) -> Result<PostgresTrackedQueryGuard<'a>> {
        let tracked_query_id = if let Some(query_id) = query_id {
            let backend_pid = sqlx::query_scalar::<_, String>(POSTGRES_BACKEND_PID_SQL)
                .persistent(false)
                .fetch_one(&mut *conn)
                .await
                .ok()
                .and_then(|value| parse_postgres_backend_pid(&value));

            if let Some(backend_pid) = backend_pid {
                let mut active_queries = self
                    .active_queries
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                active_queries.insert(query_id.to_string(), backend_pid);
                Some(query_id.to_string())
            } else {
                // PostgreSQL-compatible servers do not always expose the native
                // int4 backend PID. Query execution must still work; only
                // server-side cancellation is unavailable for this request.
                tracing::debug!(
                    "PostgreSQL-compatible server did not expose a cancellable backend PID"
                );
                None
            }
        } else {
            None
        };

        Ok(PostgresTrackedQueryGuard {
            active_queries: &self.active_queries,
            query_id: tracked_query_id,
        })
    }

    fn drain_active_query_backends(&self) -> Vec<(String, i32)> {
        self.active_queries
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .drain()
            .collect()
    }

    fn active_query_backend(&self, query_id: &str) -> Option<i32> {
        self.active_queries
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(query_id)
            .copied()
    }

    fn remove_active_query_backend_if_matches(&self, query_id: &str, backend_pid: i32) {
        let mut active_queries = self
            .active_queries
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if active_queries.get(query_id) == Some(&backend_pid) {
            active_queries.remove(query_id);
        }
    }

    async fn cancel_tracked_queries_on_pool(
        &self,
        pool: &Pool<Postgres>,
        active_queries: Vec<(String, i32)>,
    ) {
        for (query_id, backend_pid) in active_queries {
            let cancel_result: std::result::Result<bool, sqlx::Error> =
                sqlx::query_scalar("SELECT pg_cancel_backend($1)")
                    .bind(backend_pid)
                    .persistent(false)
                    .fetch_one(pool)
                    .await;

            match cancel_result {
                Ok(false) => {
                    tracing::warn!(
                        "PostgreSQL did not accept cancellation for active query {} on backend {} during disconnect",
                        query_id,
                        backend_pid
                    );
                }
                Ok(true) => {}
                Err(error) => {
                    tracing::warn!(
                        "Failed to cancel active PostgreSQL query {} during disconnect: {}",
                        query_id,
                        error
                    );
                }
            }
        }
    }

    async fn close_pool_with_timeout(pool: Pool<Postgres>) {
        if timeout(POOL_CLOSE_TIMEOUT, pool.close()).await.is_err() {
            tracing::warn!(
                "Timed out waiting for PostgreSQL pool to close after {:?}",
                POOL_CLOSE_TIMEOUT
            );
        }
    }

    async fn get_transaction_session(
        &self,
        session_id: &str,
    ) -> Result<PostgresTransactionSessionHandle> {
        self.transaction_sessions
            .lock()
            .await
            .get(session_id)
            .cloned()
            .ok_or_else(|| anyhow!("Transaction not found: {}", session_id))
    }
}

fn split_postgres_arguments(arguments: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut depth = 0i32;
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let chars: Vec<char> = arguments.chars().collect();
    let mut index = 0;

    while index < chars.len() {
        let ch = chars[index];
        if ch == '\'' && !in_double_quote {
            in_single_quote = !in_single_quote;
        } else if ch == '"' && !in_single_quote {
            in_double_quote = !in_double_quote;
        } else if !in_single_quote && !in_double_quote {
            if ch == '(' {
                depth += 1;
            } else if ch == ')' {
                depth -= 1;
            } else if ch == ',' && depth == 0 {
                let part = current.trim();
                if !part.is_empty() {
                    parts.push(part.to_string());
                }
                current.clear();
                index += 1;
                continue;
            }
        }

        current.push(ch);
        index += 1;
    }

    let part = current.trim();
    if !part.is_empty() {
        parts.push(part.to_string());
    }

    parts
}

fn strip_default_expression(argument: &str) -> (&str, bool) {
    let upper = argument.to_ascii_uppercase();
    if let Some(index) = upper.find(" DEFAULT ") {
        return (argument[..index].trim(), true);
    }
    if let Some(index) = argument.find(" = ") {
        return (argument[..index].trim(), true);
    }
    (argument.trim(), false)
}

fn parse_postgres_function_parameters(arguments: &str) -> Vec<FunctionParameterInfo> {
    split_postgres_arguments(arguments)
        .into_iter()
        .enumerate()
        .filter_map(|(index, argument)| {
            let (argument, optional) = strip_default_expression(&argument);
            let mut tokens = argument.split_whitespace().collect::<Vec<_>>();
            if tokens.is_empty() {
                return None;
            }

            if matches!(
                tokens[0].to_ascii_uppercase().as_str(),
                "IN" | "OUT" | "INOUT" | "VARIADIC"
            ) {
                tokens.remove(0);
            }

            if tokens.is_empty() {
                return None;
            }

            let (name, data_type) = if tokens.len() == 1 {
                (format!("arg{}", index + 1), tokens[0].to_string())
            } else {
                (tokens[0].to_string(), tokens[1..].join(" "))
            };

            Some(FunctionParameterInfo {
                name,
                data_type,
                optional,
            })
        })
        .collect()
}

#[async_trait]
impl DatabaseDriver for PostgresDriver {
    fn statement_scan_dialect(&self) -> Option<StatementScanDialect> {
        Some(StatementScanDialect::Postgres)
    }

    async fn connect(&mut self) -> Result<()> {
        let options = PgConnectOptions::from_str(&self.connection_string)?
            .disable_statement_logging()
            .statement_cache_capacity(0)
            .to_owned();

        let pool = PgPoolOptions::new()
            .max_connections(5)
            .acquire_timeout(Duration::from_secs(30))
            .connect_with(options)
            .await?;

        let old_pool = self.pool.get_mut().replace(pool);
        let old_metadata_pool = self.metadata_pool.get_mut().take();
        if let Some(old_pool) = old_pool {
            Self::close_pool_with_timeout(old_pool).await;
        }
        if let Some(old_metadata_pool) = old_metadata_pool {
            Self::close_pool_with_timeout(old_metadata_pool.pool).await;
        }

        Ok(())
    }

    async fn disconnect(&self) -> Result<()> {
        // Database-scoped metadata calls take this lock before checking the
        // primary pool. Taking it first here prevents a new auxiliary pool
        // from being created while disconnect is in progress.
        let mut metadata_pool = self.metadata_pool.lock().await;
        let pool = {
            let mut pool = self.pool.lock().await;
            pool.take()
        };
        let metadata_pool_to_close = metadata_pool.take();
        drop(metadata_pool);

        let active_queries = self.drain_active_query_backends();
        if !active_queries.is_empty() {
            if let Some(pool) = &pool {
                self.cancel_tracked_queries_on_pool(pool, active_queries)
                    .await;
            } else {
                tracing::warn!(
                    "Unable to cancel active PostgreSQL queries during disconnect because no pool is available"
                );
            }
        }

        let mut sessions = self.transaction_sessions.lock().await;
        let drained_sessions: Vec<_> = sessions.drain().map(|(_, conn)| conn).collect();
        drop(sessions);

        for session in drained_sessions {
            let mut conn = session.connection.lock().await;
            if let Err(error) = sqlx::query("ROLLBACK").execute(&mut **conn).await {
                tracing::warn!(
                    "Failed to rollback PostgreSQL transaction on disconnect: {}",
                    error
                );
            }
        }

        if let Some(pool) = pool {
            Self::close_pool_with_timeout(pool).await;
        }
        if let Some(metadata_pool) = metadata_pool_to_close {
            Self::close_pool_with_timeout(metadata_pool.pool).await;
        }
        Ok(())
    }

    async fn ping(&self) -> Result<()> {
        let pool = self.get_pool().await?;
        sqlx::query("SELECT 1")
            .persistent(false)
            .execute(&pool)
            .await?;
        Ok(())
    }

    async fn query(&self, sql: &str) -> Result<Vec<QueryResult>> {
        let pool = self.get_pool().await?;
        self.query_on_pool(sql, &pool).await
    }

    async fn query_database(&self, database: &str, sql: &str) -> Result<Vec<QueryResult>> {
        let mut metadata_pool = self.metadata_pool.lock().await;
        self.get_pool().await?;
        let pool = self
            .ensure_metadata_pool(&mut metadata_pool, database)
            .await?;

        timeout(METADATA_QUERY_TIMEOUT, self.query_on_pool(sql, &pool))
            .await
            .map_err(|_| anyhow!("Timed out querying PostgreSQL database '{}'", database))?
    }

    async fn query_database_with_context_tracked(
        &self,
        query_id: Option<&str>,
        database: &str,
        sql: &str,
        schema: Option<&str>,
    ) -> Result<Vec<QueryResult>> {
        let mut metadata_pool = self.metadata_pool.lock().await;
        self.get_pool().await?;
        let pool = self
            .ensure_metadata_pool(&mut metadata_pool, database)
            .await?;
        let mut conn = pool.acquire().await?;
        if split_sql_statements(sql, StatementScanDialect::Postgres).len() > 1 {
            conn.close_on_drop();
        }

        if let Some(schema) = schema.filter(|value| !value.trim().is_empty()) {
            configure_postgres_search_path(&mut conn, schema, false).await?;
        }

        let tracked_query = self.track_query_on_connection(query_id, &mut conn).await?;
        let query_result = self.query_on_connection(sql, &mut conn).await;
        drop(tracked_query);

        let reset_result = if schema.is_some() {
            Some(
                sqlx::query("RESET search_path")
                    .persistent(false)
                    .execute(&mut *conn)
                    .await,
            )
        } else {
            None
        };

        match query_result {
            Ok(rows) => {
                if let Some(reset_result) = reset_result {
                    reset_result?;
                }
                Ok(rows)
            }
            Err(query_error) => {
                if let Some(Err(reset_error)) = reset_result {
                    tracing::warn!(
                        "Failed to reset PostgreSQL search_path for database '{}': {}",
                        database,
                        reset_error
                    );
                }
                Err(query_error)
            }
        }
    }

    async fn execute_parameterized(&self, sql: &str, params: &[QueryParameter]) -> Result<u64> {
        let pool = self.get_pool().await?;
        let mut query = sqlx::query(sql).persistent(false);
        for param in params {
            query = bind_pg_parameter(query, param)?;
        }
        let result = query.execute(&pool).await?;
        Ok(result.rows_affected())
    }

    async fn query_parameterized(
        &self,
        sql: &str,
        params: &[QueryParameter],
    ) -> Result<Vec<QueryResult>> {
        let pool = self.get_pool().await?;
        self.query_parameterized_on_pool(sql, params, &pool).await
    }

    async fn query_database_parameterized(
        &self,
        database: &str,
        sql: &str,
        params: &[QueryParameter],
    ) -> Result<Vec<QueryResult>> {
        let mut metadata_pool = self.metadata_pool.lock().await;
        self.get_pool().await?;
        let pool = self
            .ensure_metadata_pool(&mut metadata_pool, database)
            .await?;

        timeout(
            METADATA_QUERY_TIMEOUT,
            self.query_parameterized_on_pool(sql, params, &pool),
        )
        .await
        .map_err(|_| {
            anyhow!(
                "Timed out running a parameterized query on PostgreSQL database '{}'",
                database
            )
        })?
    }

    async fn execute_parameterized_batch(
        &self,
        statements: &[ParameterizedStatement],
    ) -> Result<Vec<u64>> {
        if statements.is_empty() {
            return Ok(Vec::new());
        }

        let pool = self.get_pool().await?;
        let mut conn = pool.acquire().await?;
        sqlx::query("BEGIN")
            .persistent(false)
            .execute(&mut *conn)
            .await?;

        let mut rows_affected = Vec::with_capacity(statements.len());
        for statement in statements {
            let mut query = sqlx::query(&statement.sql).persistent(false);
            for param in &statement.params {
                query = bind_pg_parameter(query, param)?;
            }

            match query.execute(&mut *conn).await {
                Ok(result) => rows_affected.push(result.rows_affected()),
                Err(error) => {
                    if let Err(rollback_error) = sqlx::query("ROLLBACK")
                        .persistent(false)
                        .execute(&mut *conn)
                        .await
                    {
                        tracing::warn!(
                            "Failed to rollback PostgreSQL mutation batch: {}",
                            rollback_error
                        );
                    }
                    return Err(error.into());
                }
            }
        }

        sqlx::query("COMMIT")
            .persistent(false)
            .execute(&mut *conn)
            .await?;
        Ok(rows_affected)
    }

    async fn execute_database_parameterized_batch(
        &self,
        database: &str,
        statements: &[ParameterizedStatement],
    ) -> Result<Vec<u64>> {
        if statements.is_empty() {
            return Ok(Vec::new());
        }

        let mut metadata_pool = self.metadata_pool.lock().await;
        self.get_pool().await?;
        let pool = self
            .ensure_metadata_pool(&mut metadata_pool, database)
            .await?;
        let mut conn = pool.acquire().await?;
        sqlx::query("BEGIN")
            .persistent(false)
            .execute(&mut *conn)
            .await?;

        let mut rows_affected = Vec::with_capacity(statements.len());
        for statement in statements {
            let mut query = sqlx::query(&statement.sql).persistent(false);
            for param in &statement.params {
                query = bind_pg_parameter(query, param)?;
            }

            match query.execute(&mut *conn).await {
                Ok(result) => rows_affected.push(result.rows_affected()),
                Err(error) => {
                    if let Err(rollback_error) = sqlx::query("ROLLBACK")
                        .persistent(false)
                        .execute(&mut *conn)
                        .await
                    {
                        tracing::warn!(
                            "Failed to rollback PostgreSQL mutation batch on database '{}': {}",
                            database,
                            rollback_error
                        );
                    }
                    return Err(error.into());
                }
            }
        }

        sqlx::query("COMMIT")
            .persistent(false)
            .execute(&mut *conn)
            .await?;
        Ok(rows_affected)
    }

    async fn query_tracked(&self, query_id: Option<&str>, sql: &str) -> Result<Vec<QueryResult>> {
        if query_id.is_none() {
            return self.query(sql).await;
        }

        let pool = self.get_pool().await?;
        let mut conn = pool.acquire().await?;
        if split_sql_statements(sql, StatementScanDialect::Postgres).len() > 1 {
            conn.close_on_drop();
        }
        let tracked_query = self.track_query_on_connection(query_id, &mut conn).await?;
        let result = self.query_on_connection(sql, &mut conn).await;
        drop(tracked_query);
        result
    }

    async fn query_with_context(&self, sql: &str, schema: &str) -> Result<Vec<QueryResult>> {
        let pool = self.get_pool().await?;
        let mut conn = pool.acquire().await?;
        if split_sql_statements(sql, StatementScanDialect::Postgres).len() > 1 {
            conn.close_on_drop();
        }
        configure_postgres_search_path(&mut conn, schema, false).await?;

        let query_result = self.query_on_connection(sql, &mut conn).await;

        let reset_result = sqlx::query("RESET search_path")
            .persistent(false)
            .execute(&mut *conn)
            .await;

        match query_result {
            Ok(rows) => {
                reset_result?;
                Ok(rows)
            }
            Err(query_error) => {
                if let Err(reset_error) = reset_result {
                    tracing::warn!("Failed to reset PostgreSQL search_path: {}", reset_error);
                }
                Err(query_error)
            }
        }
    }

    async fn query_with_context_tracked(
        &self,
        query_id: Option<&str>,
        sql: &str,
        schema: &str,
    ) -> Result<Vec<QueryResult>> {
        if query_id.is_none() {
            return self.query_with_context(sql, schema).await;
        }

        let pool = self.get_pool().await?;
        let mut conn = pool.acquire().await?;
        if split_sql_statements(sql, StatementScanDialect::Postgres).len() > 1 {
            conn.close_on_drop();
        }
        configure_postgres_search_path(&mut conn, schema, false).await?;

        let tracked_query = self.track_query_on_connection(query_id, &mut conn).await?;
        let query_result = self.query_on_connection(sql, &mut conn).await;
        drop(tracked_query);

        let reset_result = sqlx::query("RESET search_path")
            .persistent(false)
            .execute(&mut *conn)
            .await;

        match query_result {
            Ok(rows) => {
                reset_result?;
                Ok(rows)
            }
            Err(query_error) => {
                if let Err(reset_error) = reset_result {
                    tracing::warn!("Failed to reset PostgreSQL search_path: {}", reset_error);
                }
                Err(query_error)
            }
        }
    }

    async fn begin_transaction(&self, session_id: &str, schema: Option<&str>) -> Result<()> {
        {
            let sessions = self.transaction_sessions.lock().await;
            if sessions.contains_key(session_id) {
                return Err(anyhow!("Transaction already active: {}", session_id));
            }
        }

        let pool = self.get_pool().await?;
        let mut conn = pool.acquire().await?;

        sqlx::query("BEGIN")
            .persistent(false)
            .execute(&mut *conn)
            .await?;

        if let Some(schema) = schema.filter(|schema| !schema.trim().is_empty()) {
            if let Err(error) = configure_postgres_search_path(&mut conn, schema, true).await {
                if let Err(rollback_error) = sqlx::query("ROLLBACK")
                    .persistent(false)
                    .execute(&mut *conn)
                    .await
                {
                    tracing::warn!(
                        "Failed to rollback PostgreSQL transaction after search_path setup failed: {}",
                        rollback_error
                    );
                }
                return Err(error);
            }
        }

        let mut sessions = self.transaction_sessions.lock().await;
        if sessions.contains_key(session_id) {
            drop(sessions);
            sqlx::query("ROLLBACK")
                .persistent(false)
                .execute(&mut *conn)
                .await?;
            return Err(anyhow!("Transaction already active: {}", session_id));
        }

        sessions.insert(
            session_id.to_string(),
            Arc::new(PostgresTransactionSession {
                connection: Mutex::new(conn),
                _database_pool: None,
            }),
        );
        Ok(())
    }

    async fn begin_database_transaction(
        &self,
        session_id: &str,
        database: &str,
        schema: Option<&str>,
    ) -> Result<()> {
        if database.trim().is_empty() {
            return Err(anyhow!("PostgreSQL database name cannot be empty"));
        }
        {
            let sessions = self.transaction_sessions.lock().await;
            if sessions.contains_key(session_id) {
                return Err(anyhow!("Transaction already active: {}", session_id));
            }
        }

        let options = self.metadata_connect_options(database)?;
        let pool = PgPoolOptions::new()
            .min_connections(0)
            .max_connections(1)
            .acquire_timeout(METADATA_CONNECT_TIMEOUT)
            .idle_timeout(Some(METADATA_POOL_IDLE_TIMEOUT))
            .max_lifetime(Some(METADATA_POOL_MAX_LIFETIME))
            .connect_with(options)
            .await?;
        let mut conn = pool.acquire().await?;
        sqlx::query("BEGIN")
            .persistent(false)
            .execute(&mut *conn)
            .await?;

        if let Some(schema) = schema.filter(|schema| !schema.trim().is_empty()) {
            if let Err(error) = configure_postgres_search_path(&mut conn, schema, true).await {
                let _ = sqlx::query("ROLLBACK")
                    .persistent(false)
                    .execute(&mut *conn)
                    .await;
                return Err(error);
            }
        }

        let mut sessions = self.transaction_sessions.lock().await;
        if sessions.contains_key(session_id) {
            drop(sessions);
            let _ = sqlx::query("ROLLBACK")
                .persistent(false)
                .execute(&mut *conn)
                .await;
            return Err(anyhow!("Transaction already active: {}", session_id));
        }
        sessions.insert(
            session_id.to_string(),
            Arc::new(PostgresTransactionSession {
                connection: Mutex::new(conn),
                _database_pool: Some(pool),
            }),
        );
        Ok(())
    }

    async fn query_transaction(&self, session_id: &str, sql: &str) -> Result<Vec<QueryResult>> {
        let session = self.get_transaction_session(session_id).await?;
        let mut conn = session.connection.lock().await;

        self.query_on_connection(sql, &mut conn).await
    }

    async fn query_transaction_tracked(
        &self,
        query_id: Option<&str>,
        session_id: &str,
        sql: &str,
    ) -> Result<Vec<QueryResult>> {
        if query_id.is_none() {
            return self.query_transaction(session_id, sql).await;
        }

        let session = self.get_transaction_session(session_id).await?;
        let mut conn = session.connection.lock().await;

        let tracked_query = self.track_query_on_connection(query_id, &mut conn).await?;
        let result = self.query_on_connection(sql, &mut conn).await;
        drop(tracked_query);
        result
    }

    async fn execute_parameterized_transaction(
        &self,
        session_id: &str,
        statements: &[ParameterizedStatement],
    ) -> Result<Vec<u64>> {
        let session = self.get_transaction_session(session_id).await?;
        let mut conn = session.connection.lock().await;
        let mut rows_affected = Vec::with_capacity(statements.len());
        for statement in statements {
            let mut query = sqlx::query(&statement.sql).persistent(false);
            for param in &statement.params {
                query = bind_pg_parameter(query, param)?;
            }
            rows_affected.push(query.execute(&mut **conn).await?.rows_affected());
        }
        Ok(rows_affected)
    }

    async fn cancel_query(&self, query_id: &str) -> Result<bool> {
        if let Some(backend_pid) = self.active_query_backend(query_id) {
            let pool = self.get_pool().await?;
            let cancelled: bool = sqlx::query_scalar("SELECT pg_cancel_backend($1)")
                .bind(backend_pid)
                .persistent(false)
                .fetch_one(&pool)
                .await?;
            if cancelled {
                self.remove_active_query_backend_if_matches(query_id, backend_pid);
            }
            Ok(cancelled)
        } else {
            Ok(false)
        }
    }

    async fn commit_transaction(&self, session_id: &str) -> Result<()> {
        let session = {
            let mut sessions = self.transaction_sessions.lock().await;
            sessions
                .remove(session_id)
                .ok_or_else(|| anyhow!("Transaction not found: {}", session_id))?
        };
        let mut conn = session.connection.lock().await;

        sqlx::query("COMMIT")
            .persistent(false)
            .execute(&mut **conn)
            .await?;
        Ok(())
    }

    async fn rollback_transaction(&self, session_id: &str) -> Result<()> {
        let session = {
            let mut sessions = self.transaction_sessions.lock().await;
            sessions
                .remove(session_id)
                .ok_or_else(|| anyhow!("Transaction not found: {}", session_id))?
        };
        let mut conn = session.connection.lock().await;

        sqlx::query("ROLLBACK")
            .persistent(false)
            .execute(&mut **conn)
            .await?;
        Ok(())
    }

    async fn get_databases(&self) -> Result<Vec<String>> {
        let pool = self.get_pool().await?;
        let databases = sqlx::query_scalar::<_, String>(
            r#"
            SELECT datname
            FROM pg_catalog.pg_database
            WHERE datallowconn
              AND NOT datistemplate
            ORDER BY datname
            "#,
        )
        .persistent(false)
        .fetch_all(&pool)
        .await?;

        Ok(databases)
    }

    async fn get_database_metadata(&self) -> Result<Vec<DatabaseInfo>> {
        let pool = self.get_pool().await?;
        let metadata = sqlx::query(
            r#"
            SELECT d.datname,
                   CASE
                     WHEN has_database_privilege(d.datname, 'CONNECT')
                       OR COALESCE((
                         SELECT pg_has_role(current_user, r.oid, 'MEMBER')
                         FROM pg_catalog.pg_roles r
                         WHERE r.rolname = 'pg_read_all_stats'
                       ), false)
                     THEN pg_database_size(d.oid)
                     ELSE NULL
                   END AS size_bytes,
                   pg_catalog.shobj_description(d.oid, 'pg_database') AS comment,
                   pg_catalog.pg_encoding_to_char(d.encoding) AS default_charset,
                   d.datcollate AS default_collation
            FROM pg_catalog.pg_database d
            WHERE d.datallowconn AND NOT d.datistemplate
            ORDER BY d.datname
            "#,
        )
        .persistent(false)
        .fetch_all(&pool)
        .await;

        match metadata {
            Ok(rows) => Ok(rows
                .iter()
                .map(|row| DatabaseInfo {
                    name: row.try_get::<String, _>(0).unwrap_or_default(),
                    size_bytes: row.try_get::<Option<i64>, _>(1).ok().flatten(),
                    comment: row
                        .try_get::<Option<String>, _>(2)
                        .ok()
                        .flatten()
                        .filter(|value| !value.trim().is_empty()),
                    default_charset: row
                        .try_get::<Option<String>, _>(3)
                        .ok()
                        .flatten()
                        .filter(|value| !value.trim().is_empty()),
                    default_collation: row
                        .try_get::<Option<String>, _>(4)
                        .ok()
                        .flatten()
                        .filter(|value| !value.trim().is_empty()),
                    ..DatabaseInfo::default()
                })
                .collect()),
            Err(error) => {
                tracing::debug!("Falling back to PostgreSQL database names after metadata query failed: {error}");
                Ok(self
                    .get_databases()
                    .await?
                    .into_iter()
                    .map(|name| DatabaseInfo {
                        name,
                        ..DatabaseInfo::default()
                    })
                    .collect())
            }
        }
    }

    async fn get_schemas(&self) -> Result<Vec<String>> {
        let pool = self.get_pool().await?;
        Self::schemas_on_pool(&pool).await
    }

    async fn get_database_schemas(&self, database: &str) -> Result<Vec<String>> {
        let mut metadata_pool = self.metadata_pool.lock().await;
        self.get_pool().await?;
        let pool = self
            .ensure_metadata_pool(&mut metadata_pool, database)
            .await?;
        drop(metadata_pool);

        timeout(METADATA_QUERY_TIMEOUT, Self::schemas_on_pool(&pool))
            .await
            .map_err(|_| {
                anyhow!(
                    "Timed out loading schemas from PostgreSQL database '{}'",
                    database
                )
            })?
    }

    async fn get_tables(&self, schema: &str) -> Result<Vec<TableInfo>> {
        let pool = self.get_pool().await?;
        Self::tables_on_pool(&pool, schema).await
    }

    async fn get_database_tables(&self, database: &str, schema: &str) -> Result<Vec<TableInfo>> {
        let mut metadata_pool = self.metadata_pool.lock().await;
        self.get_pool().await?;
        let pool = self
            .ensure_metadata_pool(&mut metadata_pool, database)
            .await?;
        drop(metadata_pool);

        timeout(METADATA_QUERY_TIMEOUT, Self::tables_on_pool(&pool, schema))
            .await
            .map_err(|_| {
                anyhow!(
                    "Timed out loading tables from PostgreSQL database '{}', schema '{}'",
                    database,
                    schema
                )
            })?
    }

    async fn get_database_schema_objects(
        &self,
        database: &str,
        schema: &str,
    ) -> Result<Vec<SchemaObjectInfo>> {
        let mut metadata_pool = self.metadata_pool.lock().await;
        self.get_pool().await?;
        let pool = self
            .ensure_metadata_pool(&mut metadata_pool, database)
            .await?;
        drop(metadata_pool);

        timeout(
            METADATA_QUERY_TIMEOUT,
            Self::schema_objects_on_pool(&pool, schema),
        )
        .await
        .map_err(|_| {
            anyhow!(
                "Timed out loading schema objects from PostgreSQL database '{}', schema '{}'",
                database,
                schema
            )
        })?
    }

    async fn get_schema_objects(&self, schema: &str) -> Result<Vec<SchemaObjectInfo>> {
        let pool = self.get_pool().await?;
        Self::schema_objects_on_pool(&pool, schema).await
    }

    async fn get_columns(&self, schema: &str, table: &str) -> Result<Vec<ColumnInfo>> {
        let pool = self.get_pool().await?;
        Self::columns_on_pool(&pool, schema, table).await
    }

    async fn get_generated_columns(&self, schema: &str, table: &str) -> Result<Vec<String>> {
        let pool = self.get_pool().await?;
        Self::generated_columns_on_pool(&pool, schema, table).await
    }

    async fn sql_export_requires_identity_override(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<bool> {
        let pool = self.get_pool().await?;
        Self::requires_identity_override_on_pool(&pool, schema, table).await
    }

    async fn get_database_columns(
        &self,
        database: &str,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ColumnInfo>> {
        let mut metadata_pool = self.metadata_pool.lock().await;
        self.get_pool().await?;
        let pool = self
            .ensure_metadata_pool(&mut metadata_pool, database)
            .await?;
        drop(metadata_pool);

        timeout(
            METADATA_QUERY_TIMEOUT,
            Self::columns_on_pool(&pool, schema, table),
        )
        .await
        .map_err(|_| {
            anyhow!(
                "Timed out loading columns from PostgreSQL database '{}', table '{}.{}'",
                database,
                schema,
                table
            )
        })?
    }

    async fn get_database_generated_columns(
        &self,
        database: &str,
        schema: &str,
        table: &str,
    ) -> Result<Vec<String>> {
        let mut metadata_pool = self.metadata_pool.lock().await;
        self.get_pool().await?;
        let pool = self
            .ensure_metadata_pool(&mut metadata_pool, database)
            .await?;
        drop(metadata_pool);

        timeout(
            METADATA_QUERY_TIMEOUT,
            Self::generated_columns_on_pool(&pool, schema, table),
        )
        .await
        .map_err(|_| {
            anyhow!(
                "Timed out loading generated columns from PostgreSQL database '{}', table '{}.{}'",
                database,
                schema,
                table
            )
        })?
    }

    async fn get_indexes(&self, schema: &str, table: &str) -> Result<Vec<IndexInfo>> {
        let pool = self.get_pool().await?;
        Self::indexes_on_pool(&pool, schema, table).await
    }

    async fn get_database_indexes(
        &self,
        database: &str,
        schema: &str,
        table: &str,
    ) -> Result<Vec<IndexInfo>> {
        let mut metadata_pool = self.metadata_pool.lock().await;
        self.get_pool().await?;
        let pool = self
            .ensure_metadata_pool(&mut metadata_pool, database)
            .await?;
        drop(metadata_pool);

        timeout(
            METADATA_QUERY_TIMEOUT,
            Self::indexes_on_pool(&pool, schema, table),
        )
        .await
        .map_err(|_| {
            anyhow!(
                "Timed out loading indexes from PostgreSQL database '{}', table '{}.{}'",
                database,
                schema,
                table
            )
        })?
    }

    async fn get_constraints(&self, schema: &str, table: &str) -> Result<Vec<ConstraintInfo>> {
        let pool = self.get_pool().await?;
        Self::constraints_on_pool(&pool, schema, table).await
    }

    async fn get_database_constraints(
        &self,
        database: &str,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ConstraintInfo>> {
        let mut metadata_pool = self.metadata_pool.lock().await;
        self.get_pool().await?;
        let pool = self
            .ensure_metadata_pool(&mut metadata_pool, database)
            .await?;
        drop(metadata_pool);

        timeout(
            METADATA_QUERY_TIMEOUT,
            Self::constraints_on_pool(&pool, schema, table),
        )
        .await
        .map_err(|_| {
            anyhow!(
                "Timed out loading constraints from PostgreSQL database '{}', table '{}.{}'",
                database,
                schema,
                table
            )
        })?
    }

    async fn get_referencing_foreign_keys(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ForeignKeyReferenceInfo>> {
        let pool = self.get_pool().await?;
        Self::referencing_foreign_keys_on_pool(&pool, schema, table).await
    }

    async fn get_database_referencing_foreign_keys(
        &self,
        database: &str,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ForeignKeyReferenceInfo>> {
        let mut metadata_pool = self.metadata_pool.lock().await;
        self.get_pool().await?;
        let pool = self
            .ensure_metadata_pool(&mut metadata_pool, database)
            .await?;
        drop(metadata_pool);

        timeout(
            METADATA_QUERY_TIMEOUT,
            Self::referencing_foreign_keys_on_pool(&pool, schema, table),
        )
        .await
        .map_err(|_| {
            anyhow!(
                "Timed out loading referencing foreign keys from PostgreSQL database '{}', table '{}.{}'",
                database,
                schema,
                table
            )
        })?
    }

    async fn get_functions(&self, schema: &str) -> Result<Vec<FunctionInfo>> {
        let pool = self.get_pool().await?;
        Self::functions_on_pool(&pool, schema).await
    }

    async fn get_database_functions(
        &self,
        database: &str,
        schema: &str,
    ) -> Result<Vec<FunctionInfo>> {
        let mut metadata_pool = self.metadata_pool.lock().await;
        self.get_pool().await?;
        let pool = self
            .ensure_metadata_pool(&mut metadata_pool, database)
            .await?;
        drop(metadata_pool);

        timeout(
            METADATA_QUERY_TIMEOUT,
            Self::functions_on_pool(&pool, schema),
        )
        .await
        .map_err(|_| {
            anyhow!(
                "Timed out loading routines from PostgreSQL database '{}', schema '{}'",
                database,
                schema
            )
        })?
    }

    async fn set_current_schema(&self, schema: &str) -> Result<()> {
        let pool = self.get_pool().await?;
        let exists: Option<(i32,)> =
            sqlx::query_as("SELECT 1 FROM information_schema.schemata WHERE schema_name = $1")
                .bind(schema)
                .persistent(false)
                .fetch_optional(&pool)
                .await?;

        exists
            .map(|_| ())
            .ok_or_else(|| anyhow!("Schema not found: {}", schema))
    }
}

const JS_SAFE_INTEGER_MAX: i64 = 9_007_199_254_740_991;

fn json_i64(value: i64) -> serde_json::Value {
    if (-JS_SAFE_INTEGER_MAX..=JS_SAFE_INTEGER_MAX).contains(&value) {
        serde_json::Value::Number(value.into())
    } else {
        serde_json::Value::String(value.to_string())
    }
}

fn json_u64(value: u64) -> serde_json::Value {
    if value <= JS_SAFE_INTEGER_MAX as u64 {
        serde_json::Value::Number(value.into())
    } else {
        serde_json::Value::String(value.to_string())
    }
}

fn non_finite_float_text(value: f64) -> &'static str {
    if value.is_nan() {
        "NaN"
    } else if value.is_sign_positive() {
        "Infinity"
    } else {
        "-Infinity"
    }
}

fn json_f32(value: f32) -> serde_json::Value {
    if value.is_finite() {
        value
            .to_string()
            .parse::<serde_json::Number>()
            .map(serde_json::Value::Number)
            .expect("finite f32 values always have a valid JSON representation")
    } else {
        serde_json::Value::String(non_finite_float_text(f64::from(value)).into())
    }
}

fn json_f64(value: f64) -> serde_json::Value {
    serde_json::Number::from_f64(value)
        .map(serde_json::Value::Number)
        .unwrap_or_else(|| serde_json::Value::String(non_finite_float_text(value).into()))
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    encoded
}

fn hex_decode(value: &str) -> Result<Vec<u8>> {
    let value = value
        .strip_prefix("\\x")
        .or_else(|| value.strip_prefix("0x"))
        .unwrap_or(value);
    if !value.len().is_multiple_of(2) {
        return Err(anyhow!(
            "Hex-encoded binary values must contain an even number of digits"
        ));
    }

    value
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let pair = std::str::from_utf8(pair).expect("hex pairs are always UTF-8");
            u8::from_str_radix(pair, 16)
                .map_err(|_| anyhow!("Invalid hex byte in binary value: {pair}"))
        })
        .collect()
}

fn binary_json(bytes: &[u8]) -> serde_json::Value {
    serde_json::Value::String(format!("\\x{}", hex_encode(bytes)))
}

fn pg_effective_type_name(type_info: &PgTypeInfo) -> String {
    match type_info.kind() {
        PgTypeKind::Domain(base) => pg_effective_type_name(base),
        PgTypeKind::Array(element) => format!("{}[]", pg_effective_type_name(element)),
        _ => type_info.name().to_ascii_uppercase(),
    }
}

fn pg_type_is_enum(type_info: &PgTypeInfo) -> bool {
    match type_info.kind() {
        PgTypeKind::Enum(_) => true,
        PgTypeKind::Domain(base) => pg_type_is_enum(base),
        _ => false,
    }
}

fn pg_array_element_is_enum(type_info: &PgTypeInfo) -> bool {
    match type_info.kind() {
        PgTypeKind::Array(element) => pg_type_is_enum(element),
        PgTypeKind::Domain(base) => pg_array_element_is_enum(base),
        _ => false,
    }
}

fn pg_interval_text(value: PgInterval) -> String {
    format!(
        "{} mons {} days {} microseconds",
        value.months, value.days, value.microseconds
    )
}

fn pg_timetz_text(value: PgTimeTz) -> String {
    format!("{}{}", value.time, value.offset)
}

fn optional_values_to_json<T>(
    values: Vec<Option<T>>,
    map: impl Fn(T) -> serde_json::Value,
) -> serde_json::Value {
    serde_json::Value::Array(
        values
            .into_iter()
            .map(|value| value.map(&map).unwrap_or(serde_json::Value::Null))
            .collect(),
    )
}

fn pg_numeric_scale(bytes: &[u8]) -> Option<i64> {
    let scale = u16::from_be_bytes([*bytes.get(6)?, *bytes.get(7)?]);
    Some(i64::from(scale))
}

fn pg_numeric_array_scales(row: &PgRow, index: usize) -> Vec<Option<i64>> {
    let Ok(raw) = row.try_get_raw(index) else {
        return Vec::new();
    };
    if raw.format() != PgValueFormat::Binary {
        return Vec::new();
    }
    let Ok(bytes) = raw.as_bytes() else {
        return Vec::new();
    };
    let Some(ndim_bytes) = bytes.get(0..4) else {
        return Vec::new();
    };
    let ndim = i32::from_be_bytes(ndim_bytes.try_into().expect("four-byte slice"));
    let Ok(ndim) = usize::try_from(ndim) else {
        return Vec::new();
    };
    let Some(mut offset) = 12usize.checked_add(ndim.saturating_mul(8)) else {
        return Vec::new();
    };
    if offset > bytes.len() {
        return Vec::new();
    }

    let mut scales = Vec::new();
    while let Some(length_bytes) = bytes.get(offset..offset + 4) {
        let length = i32::from_be_bytes(length_bytes.try_into().expect("four-byte slice"));
        offset += 4;
        if length == -1 {
            scales.push(None);
            continue;
        }
        let Ok(length) = usize::try_from(length) else {
            return Vec::new();
        };
        let Some(end) = offset.checked_add(length) else {
            return Vec::new();
        };
        let Some(value) = bytes.get(offset..end) else {
            return Vec::new();
        };
        scales.push(pg_numeric_scale(value));
        offset = end;
    }
    scales
}

fn pg_numeric_text(value: BigDecimal, scale: Option<i64>) -> serde_json::Value {
    let value = scale.map_or(value.clone(), |scale| value.with_scale(scale));
    serde_json::Value::String(value.to_plain_string())
}

fn pg_fallback_value(row: &PgRow, index: usize, type_info: &PgTypeInfo) -> serde_json::Value {
    let Ok(raw) = row.try_get_raw(index) else {
        return serde_json::Value::String(format!(
            "<unreadable PostgreSQL {} value>",
            type_info.name()
        ));
    };
    if raw.is_null() {
        return serde_json::Value::Null;
    }

    if raw.format() == PgValueFormat::Text || pg_type_is_enum(type_info) {
        if let Ok(value) = raw.as_str() {
            return serde_json::Value::String(value.to_string());
        }
    }

    raw.as_bytes().map(binary_json).unwrap_or_else(|_| {
        serde_json::Value::String(format!(
            "<unreadable PostgreSQL {} value>",
            type_info.name()
        ))
    })
}

fn decode_pg_value(row: &PgRow, index: usize) -> serde_json::Value {
    let col = row.column(index);
    let type_info = col.type_info();
    if row
        .try_get_raw(index)
        .map(|value| value.is_null())
        .unwrap_or(false)
    {
        return serde_json::Value::Null;
    }

    macro_rules! decode {
        ($ty:ty, $map:expr) => {
            row.try_get_unchecked::<$ty, _>(index)
                .map($map)
                .unwrap_or_else(|_| pg_fallback_value(row, index, type_info))
        };
    }

    macro_rules! decode_array {
        ($ty:ty, $map:expr) => {
            row.try_get_unchecked::<Vec<Option<$ty>>, _>(index)
                .map(|values| optional_values_to_json(values, $map))
                .unwrap_or_else(|_| pg_fallback_value(row, index, type_info))
        };
    }

    match pg_effective_type_name(type_info).as_str() {
        "BOOL" => decode!(bool, serde_json::Value::Bool),
        "CHAR" => decode!(i8, |value| json_i64(i64::from(value))),
        "INT2" => decode!(i16, |value| json_i64(i64::from(value))),
        "INT4" => decode!(i32, |value| json_i64(i64::from(value))),
        "INT8" => decode!(i64, json_i64),
        "OID" => decode!(Oid, |value| json_u64(u64::from(value.0))),
        "XID" | "CID" => decode!(i32, |value| json_u64(u64::from(value as u32))),
        "FLOAT4" => decode!(f32, json_f32),
        "FLOAT8" => decode!(f64, json_f64),
        "NUMERIC" => {
            let scale = row
                .try_get_raw(index)
                .ok()
                .filter(|raw| raw.format() == PgValueFormat::Binary)
                .and_then(|raw| raw.as_bytes().ok())
                .and_then(pg_numeric_scale);
            decode!(BigDecimal, |value| pg_numeric_text(value, scale))
        }
        "TEXT" | "VARCHAR" | "BPCHAR" | "NAME" | "UNKNOWN" | "CITEXT" | "XML" => {
            decode!(String, serde_json::Value::String)
        }
        "JSON" | "JSONB" => decode!(serde_json::Value, |value| value),
        "UUID" => decode!(Uuid, |value| serde_json::Value::String(value.to_string())),
        "DATE" => decode!(NaiveDate, |value| serde_json::Value::String(
            value.to_string()
        )),
        "TIME" => decode!(NaiveTime, |value| serde_json::Value::String(
            value.to_string()
        )),
        "TIMESTAMP" => decode!(NaiveDateTime, |value| serde_json::Value::String(
            value.to_string()
        )),
        "TIMESTAMPTZ" => decode!(DateTime<Utc>, |value| serde_json::Value::String(
            value.to_rfc3339()
        )),
        "TIMETZ" => decode!(PgTimeTz, |value| serde_json::Value::String(pg_timetz_text(
            value
        ))),
        "INTERVAL" => decode!(PgInterval, |value| serde_json::Value::String(
            pg_interval_text(value)
        )),
        "BYTEA" => decode!(Vec<u8>, |value| binary_json(&value)),
        "BOOL[]" => decode_array!(bool, serde_json::Value::Bool),
        "CHAR[]" => decode_array!(i8, |value| json_i64(i64::from(value))),
        "INT2[]" => decode_array!(i16, |value| json_i64(i64::from(value))),
        "INT4[]" => decode_array!(i32, |value| json_i64(i64::from(value))),
        "INT8[]" => decode_array!(i64, json_i64),
        "OID[]" => decode_array!(Oid, |value| json_u64(u64::from(value.0))),
        "XID[]" | "CID[]" => {
            decode_array!(i32, |value| json_u64(u64::from(value as u32)))
        }
        "FLOAT4[]" => decode_array!(f32, json_f32),
        "FLOAT8[]" => decode_array!(f64, json_f64),
        "NUMERIC[]" => row
            .try_get_unchecked::<Vec<Option<BigDecimal>>, _>(index)
            .map(|values| {
                let scales = pg_numeric_array_scales(row, index);
                serde_json::Value::Array(
                    values
                        .into_iter()
                        .enumerate()
                        .map(|(index, value)| {
                            value
                                .map(|value| {
                                    pg_numeric_text(value, scales.get(index).copied().flatten())
                                })
                                .unwrap_or(serde_json::Value::Null)
                        })
                        .collect(),
                )
            })
            .unwrap_or_else(|_| pg_fallback_value(row, index, type_info)),
        "TEXT[]" | "VARCHAR[]" | "BPCHAR[]" | "NAME[]" | "CITEXT[]" | "XML[]" => {
            decode_array!(String, serde_json::Value::String)
        }
        "JSON[]" | "JSONB[]" => decode_array!(serde_json::Value, |value| value),
        "UUID[]" => decode_array!(Uuid, |value| serde_json::Value::String(value.to_string())),
        "DATE[]" => decode_array!(NaiveDate, |value| serde_json::Value::String(
            value.to_string()
        )),
        "TIME[]" => decode_array!(NaiveTime, |value| serde_json::Value::String(
            value.to_string()
        )),
        "TIMESTAMP[]" => decode_array!(NaiveDateTime, |value| serde_json::Value::String(
            value.to_string()
        )),
        "TIMESTAMPTZ[]" => decode_array!(DateTime<Utc>, |value| serde_json::Value::String(
            value.to_rfc3339()
        )),
        "TIMETZ[]" => decode_array!(PgTimeTz, |value| serde_json::Value::String(pg_timetz_text(
            value
        ))),
        "INTERVAL[]" => decode_array!(PgInterval, |value| serde_json::Value::String(
            pg_interval_text(value)
        )),
        "BYTEA[]" => decode_array!(Vec<u8>, |value| binary_json(&value)),
        _ if pg_type_is_enum(type_info) => {
            decode!(String, serde_json::Value::String)
        }
        _ if pg_array_element_is_enum(type_info) => {
            decode_array!(String, serde_json::Value::String)
        }
        _ => pg_fallback_value(row, index, type_info),
    }
}

fn pg_array_element_literal(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "NULL".to_string(),
        serde_json::Value::Array(values) => format!(
            "{{{}}}",
            values
                .iter()
                .map(pg_array_element_literal)
                .collect::<Vec<_>>()
                .join(",")
        ),
        serde_json::Value::String(value) => {
            format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
        }
        serde_json::Value::Bool(value) => value.to_string(),
        serde_json::Value::Number(value) => value.to_string(),
        serde_json::Value::Object(_) => {
            let value = serde_json::to_string(value).unwrap_or_default();
            format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
        }
    }
}

fn pg_array_literal(value: &serde_json::Value) -> Result<String> {
    let parsed;
    let values = match value {
        serde_json::Value::Array(values) => values,
        serde_json::Value::String(value) if value.trim_start().starts_with('[') => {
            parsed = serde_json::from_str::<serde_json::Value>(value)
                .map_err(|error| anyhow!("Invalid JSON array value: {error}"))?;
            parsed
                .as_array()
                .ok_or_else(|| anyhow!("Expected a JSON array value"))?
        }
        serde_json::Value::String(value) if value.trim_start().starts_with('{') => {
            return Ok(value.clone());
        }
        _ => return Err(anyhow!("PostgreSQL array values must be JSON arrays")),
    };

    Ok(format!(
        "{{{}}}",
        values
            .iter()
            .map(pg_array_element_literal)
            .collect::<Vec<_>>()
            .join(",")
    ))
}

fn is_pg_array_type(data_type: Option<&str>) -> bool {
    data_type
        .map(str::trim)
        .is_some_and(|data_type| data_type.ends_with("[]"))
}

fn is_pg_binary_type(data_type: Option<&str>) -> bool {
    data_type.is_some_and(|data_type| {
        data_type
            .trim()
            .split('(')
            .next()
            .unwrap_or("")
            .eq_ignore_ascii_case("bytea")
    })
}

fn binary_parameter_bytes(value: &serde_json::Value) -> Result<Vec<u8>> {
    match value {
        serde_json::Value::String(value) if value.starts_with("\\x") || value.starts_with("0x") => {
            hex_decode(value)
        }
        serde_json::Value::String(value) => Ok(value.as_bytes().to_vec()),
        serde_json::Value::Array(values) => values
            .iter()
            .map(|value| {
                value
                    .as_u64()
                    .and_then(|value| u8::try_from(value).ok())
                    .ok_or_else(|| anyhow!("Binary byte arrays may only contain integers 0..255"))
            })
            .collect(),
        _ => Err(anyhow!(
            "Binary parameters must be hex strings, text, or byte arrays"
        )),
    }
}

fn bind_pg_parameter<'q>(
    query: Query<'q, Postgres, PgArguments>,
    param: &QueryParameter,
) -> Result<Query<'q, Postgres, PgArguments>> {
    if param.value.is_null() {
        return Ok(query.bind(Option::<String>::None));
    }
    if is_pg_array_type(param.data_type.as_deref()) {
        return Ok(query.bind(pg_array_literal(&param.value)?));
    }
    if is_pg_binary_type(param.data_type.as_deref()) {
        return Ok(query.bind(binary_parameter_bytes(&param.value)?));
    }

    Ok(match &param.value {
        serde_json::Value::Null => unreachable!("NULL parameters return above"),
        serde_json::Value::Bool(value) => query.bind(*value),
        serde_json::Value::Number(value) => {
            if is_integral_type(param.data_type.as_deref()) {
                if let Some(value) = value.as_i64() {
                    query.bind(value)
                } else if let Some(value) =
                    value.as_u64().and_then(|value| i64::try_from(value).ok())
                {
                    query.bind(value)
                } else {
                    query.bind(value.to_string())
                }
            } else if let Some(value) = value.as_f64() {
                query.bind(value)
            } else {
                query.bind(value.to_string())
            }
        }
        serde_json::Value::String(value) => query.bind(value.clone()),
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
            query.bind(serde_json::to_string(&param.value)?)
        }
    })
}

fn is_integral_type(data_type: Option<&str>) -> bool {
    let Some(data_type) = data_type else {
        return false;
    };
    let normalized = data_type.to_ascii_lowercase();
    let base_type = normalized.split('(').next().unwrap_or("").trim();
    matches!(
        base_type,
        "smallint"
            | "integer"
            | "int"
            | "int2"
            | "int4"
            | "bigint"
            | "int8"
            | "serial"
            | "bigserial"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::statement::has_multiple_statements;
    use dotenvy::dotenv;
    use std::env;

    #[test]
    fn postgres_search_path_keeps_configured_entries_when_schema_changes() {
        assert_eq!(
            postgres_search_path_with_selected_schema(
                "\"$user\", extensions, public",
                Some("public"),
                false,
                "application",
            ),
            "\"application\", \"$user\", extensions, public, pg_catalog",
        );
    }

    #[test]
    fn postgres_search_path_keeps_existing_path_when_selected_schema_is_first() {
        assert_eq!(
            postgres_search_path_with_selected_schema(
                "application, extensions, public",
                Some("application"),
                false,
                "application",
            ),
            "application, extensions, public, pg_catalog",
        );
        assert_eq!(
            postgres_search_path_with_selected_schema(
                "extensions, pg_catalog, public",
                Some("extensions"),
                true,
                "application",
            ),
            "\"application\", extensions, pg_catalog, public",
        );
    }

    #[test]
    fn postgres_search_path_quotes_selected_schema_and_handles_an_empty_baseline() {
        assert_eq!(
            postgres_search_path_with_selected_schema("", None, false, "tenant\"name"),
            "\"tenant\"\"name\", pg_catalog",
        );
    }

    #[test]
    fn empty_postgres_rows_preserve_described_columns() {
        let driver = PostgresDriver::new("postgres://user:pass@localhost/db");
        let results = driver
            .process_rows(
                Vec::new(),
                vec![
                    ColumnDef {
                        name: "id".to_string(),
                        data_type: "INT8".to_string(),
                    },
                    ColumnDef {
                        name: "email".to_string(),
                        data_type: "TEXT".to_string(),
                    },
                ],
            )
            .expect("empty rows should produce a query result");

        assert_eq!(results.len(), 1);
        assert!(results[0].rows.is_empty());
        assert_eq!(results[0].columns.len(), 2);
        assert_eq!(results[0].columns[0].name, "id");
        assert_eq!(results[0].columns[0].data_type, "INT8");
        assert_eq!(results[0].columns[1].name, "email");
        assert_eq!(results[0].columns[1].data_type, "TEXT");
    }

    #[test]
    fn postgres_json_integers_only_use_numbers_inside_javascript_safe_range() {
        assert_eq!(
            json_i64(JS_SAFE_INTEGER_MAX),
            serde_json::json!(9_007_199_254_740_991_i64)
        );
        assert_eq!(
            json_i64(JS_SAFE_INTEGER_MAX + 1),
            serde_json::json!("9007199254740992")
        );
        assert_eq!(
            json_i64(i64::MIN),
            serde_json::json!("-9223372036854775808")
        );
        assert_eq!(
            json_u64(u64::MAX),
            serde_json::json!("18446744073709551615")
        );
    }

    #[test]
    fn postgres_binary_hex_representation_is_reversible() {
        let bytes = vec![0x00, 0x7f, 0x80, 0xff];
        assert_eq!(binary_json(&bytes), serde_json::json!("\\x007f80ff"));
        assert_eq!(hex_decode("\\x007f80ff").unwrap(), bytes);
        assert!(hex_decode("\\x0").is_err());
        assert!(hex_decode("\\xzz").is_err());
    }

    #[test]
    fn postgres_float_representation_keeps_f32_shape_and_special_values() {
        assert_eq!(json_f32(0.1), serde_json::json!(0.1));
        assert_eq!(json_f32(f32::NAN), serde_json::json!("NaN"));
        assert_eq!(json_f64(f64::INFINITY), serde_json::json!("Infinity"));
        assert_eq!(json_f64(f64::NEG_INFINITY), serde_json::json!("-Infinity"));
    }

    #[test]
    fn postgres_numeric_text_preserves_arbitrary_precision_and_declared_scale() {
        let integer = "9".repeat(10_000);
        let fractional = format!("{}12300", "0".repeat(300));
        let source = format!("{integer}.{fractional}");
        let value = BigDecimal::from_str(&source).unwrap();

        assert_eq!(
            pg_numeric_text(value, Some(fractional.len() as i64)),
            serde_json::Value::String(source)
        );

        let scaled_zero = BigDecimal::from_str("0").unwrap();
        assert_eq!(
            pg_numeric_text(scaled_zero, Some(4)),
            serde_json::json!("0.0000")
        );
    }

    #[test]
    fn postgres_array_json_is_converted_to_native_literal_for_round_trip() {
        assert_eq!(
            pg_array_literal(&serde_json::json!([1, "two", null, "a\\\"b", {"x": 1}])).unwrap(),
            r#"{1,"two",NULL,"a\\\"b","{\"x\":1}"}"#
        );
        assert_eq!(
            pg_array_literal(&serde_json::json!("{1,2,NULL}")).unwrap(),
            "{1,2,NULL}"
        );
        assert!(pg_array_literal(&serde_json::json!("not an array")).is_err());
    }

    #[test]
    fn postgres_interval_representation_keeps_all_wire_components() {
        assert_eq!(
            pg_interval_text(PgInterval {
                months: 14,
                days: -3,
                microseconds: 1_234_567,
            }),
            "14 mons -3 days 1234567 microseconds"
        );
    }

    #[test]
    fn parses_postgres_function_arguments() {
        let params = parse_postgres_function_parameters(
            "IN account_id integer, amount numeric(10, 2) DEFAULT 0, VARIADIC tags text[]",
        );

        assert_eq!(params.len(), 3);
        assert_eq!(params[0].name, "account_id");
        assert_eq!(params[0].data_type, "integer");
        assert!(!params[0].optional);
        assert_eq!(params[1].name, "amount");
        assert_eq!(params[1].data_type, "numeric(10, 2)");
        assert!(params[1].optional);
        assert_eq!(params[2].name, "tags");
        assert_eq!(params[2].data_type, "text[]");
    }

    #[test]
    fn parses_postgres_backend_pid_from_compatible_text_value() {
        assert_eq!(parse_postgres_backend_pid(" 4242 "), Some(4242));
        assert_eq!(parse_postgres_backend_pid("0"), None);
        assert_eq!(parse_postgres_backend_pid("-1"), None);
        assert_eq!(parse_postgres_backend_pid("2147483648"), None);
        assert_eq!(parse_postgres_backend_pid("not-a-pid"), None);
    }

    #[test]
    fn postgres_backend_pid_query_normalizes_compatible_numeric_types() {
        assert_eq!(
            POSTGRES_BACKEND_PID_SQL,
            "SELECT CAST(pg_backend_pid() AS TEXT)"
        );
    }

    #[test]
    fn postgres_catalog_metadata_uses_legacy_ordinality_route_before_94() {
        assert!(!postgres_supports_with_ordinality(90_300));
        assert!(postgres_supports_with_ordinality(90_400));
        assert!(postgres_supports_with_ordinality(160_000));
    }

    #[test]
    fn postgres_index_metadata_avoids_include_catalog_fields_before_11() {
        assert!(!postgres_index_key_count_expression(90_300).contains("indnkeyatts"));
        assert!(!postgres_index_key_count_expression(100_000).contains("indnkeyatts"));
        assert_eq!(
            postgres_index_key_count_expression(110_000),
            "ix.indnkeyatts"
        );
    }

    #[test]
    fn tracked_query_guard_removes_active_query_on_drop() {
        let active_queries = StdMutex::new(HashMap::from([("q1".to_string(), 42)]));

        {
            let _guard = PostgresTrackedQueryGuard {
                active_queries: &active_queries,
                query_id: Some("q1".to_string()),
            };
        }

        assert!(!active_queries
            .lock()
            .expect("active query map mutex poisoned")
            .contains_key("q1"));
    }

    #[test]
    fn drain_active_query_backends_clears_tracked_queries() {
        let driver = PostgresDriver::new("postgres://user:pass@localhost/db");
        driver
            .active_queries
            .lock()
            .expect("active query map mutex poisoned")
            .extend([("q1".to_string(), 41), ("q2".to_string(), 42)]);

        let mut drained = driver.drain_active_query_backends();
        drained.sort_by(|left, right| left.0.cmp(&right.0));

        assert_eq!(
            drained,
            vec![("q1".to_string(), 41), ("q2".to_string(), 42)]
        );
        assert!(driver
            .active_queries
            .lock()
            .expect("active query map mutex poisoned")
            .is_empty());
    }

    #[test]
    fn remove_active_query_backend_only_removes_matching_backend() {
        let driver = PostgresDriver::new("postgres://user:pass@localhost/db");
        driver
            .active_queries
            .lock()
            .expect("active query map mutex poisoned")
            .insert("q1".to_string(), 41);

        driver.remove_active_query_backend_if_matches("q1", 42);
        assert_eq!(driver.active_query_backend("q1"), Some(41));

        driver.remove_active_query_backend_if_matches("q1", 41);
        assert_eq!(driver.active_query_backend("q1"), None);
    }

    #[tokio::test]
    async fn cancel_query_retains_tracking_when_postgres_pool_is_unavailable() {
        let driver = PostgresDriver::new("postgres://user:pass@localhost/db");
        driver
            .active_queries
            .lock()
            .expect("active query map mutex poisoned")
            .insert("q1".to_string(), 42);

        let error = driver
            .cancel_query("q1")
            .await
            .expect_err("missing pool should fail cancellation");

        assert!(error.to_string().contains("Not connected"));
        assert_eq!(driver.active_query_backend("q1"), Some(42));
    }

    #[test]
    fn metadata_options_select_database_without_rewriting_connection_url() {
        let driver = PostgresDriver::new(
            "postgres://user:pass@db.internal:5432/source?sslmode=require&application_name=oxide",
        );

        let options = driver
            .metadata_connect_options("customer data")
            .expect("metadata options should preserve the base connection settings");

        assert_eq!(options.get_database(), Some("customer data"));
        assert_eq!(options.get_host(), "db.internal");
        assert_eq!(options.get_port(), 5432);
        assert!(driver.metadata_connect_options("").is_err());
        assert!(driver.metadata_connect_options("bad\0name").is_err());
    }

    #[tokio::test]
    async fn disconnect_clears_and_closes_postgres_pool() {
        let driver = PostgresDriver::new("postgres://user:pass@localhost/db");
        let options = PgConnectOptions::from_str("postgres://user:pass@localhost/db")
            .expect("test connection options should parse")
            .disable_statement_logging()
            .statement_cache_capacity(0)
            .to_owned();
        let pool = PgPoolOptions::new()
            .max_connections(1)
            .connect_lazy_with(options);
        let metadata_options = driver
            .metadata_connect_options("analytics")
            .expect("metadata connection options should parse");
        let metadata_pool = PgPoolOptions::new()
            .max_connections(1)
            .connect_lazy_with(metadata_options);

        {
            let mut current_pool = driver.pool.lock().await;
            *current_pool = Some(pool.clone());
        }
        {
            let mut current_metadata_pool = driver.metadata_pool.lock().await;
            *current_metadata_pool = Some(PostgresMetadataPool {
                database: "analytics".to_string(),
                pool: metadata_pool.clone(),
            });
        }

        driver
            .disconnect()
            .await
            .expect("disconnect should close a lazy pool");

        assert!(driver.pool.lock().await.is_none());
        assert!(pool.is_closed());
        assert!(driver.metadata_pool.lock().await.is_none());
        assert!(metadata_pool.is_closed());
    }

    #[test]
    fn postgres_multi_statement_detection_ignores_comments_and_literals() {
        assert!(has_multiple_statements(
            "SELECT 1; CREATE TEMP TABLE oxide_pg_multi(id integer)",
            StatementScanDialect::Postgres
        ));
        assert!(has_multiple_statements(
            "CREATE FUNCTION f() RETURNS integer LANGUAGE SQL AS $$ SELECT 1; $$; SELECT f();",
            StatementScanDialect::Postgres
        ));
        assert!(!has_multiple_statements(
            "SELECT ';' AS semicolon;",
            StatementScanDialect::Postgres
        ));
        assert!(!has_multiple_statements(
            "SELECT 1 /* ; */ -- ;\n;",
            StatementScanDialect::Postgres
        ));
        assert!(!has_multiple_statements(
            "CREATE FUNCTION f() RETURNS integer LANGUAGE SQL AS $$ SELECT 1; $$;",
            StatementScanDialect::Postgres
        ));
    }

    #[tokio::test]
    #[ignore = "requires a live TEST_POSTGRES_URL database"]
    async fn test_get_schemas() {
        dotenv().ok();
        let database_url = env::var("TEST_POSTGRES_URL").expect("TEST_POSTGRES_URL must be set");

        let mut driver = PostgresDriver::new(&database_url);
        driver.connect().await.expect("Failed to connect");

        let schemas = driver.get_schemas().await.expect("Failed to get schemas");
        println!("Schemas: {:?}", schemas);
        assert!(!schemas.is_empty());

        driver.disconnect().await.expect("Failed to disconnect");
    }
}
