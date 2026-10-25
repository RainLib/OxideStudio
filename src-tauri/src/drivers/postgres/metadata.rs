use super::models::{
    postgres_index_key_count_expression, postgres_supports_with_ordinality, PostgresDriver,
    PostgresMetadataPool, METADATA_CONNECT_TIMEOUT, METADATA_POOL_IDLE_TIMEOUT,
    METADATA_POOL_MAX_LIFETIME, POOL_CLOSE_TIMEOUT,
};
use super::parameters::parse_postgres_function_parameters;
use crate::core::protocol::{
    ColumnInfo, ConstraintInfo, ForeignKeyReferenceInfo, FunctionInfo, IndexInfo, SchemaObjectInfo,
    TableInfo,
};
use anyhow::{anyhow, Result};
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::{ConnectOptions, Pool, Postgres, Row};
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Mutex as StdMutex;
use tokio::sync::Mutex;
use tokio::time::timeout;

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

    pub(super) async fn get_pool(&self) -> Result<Pool<Postgres>> {
        let pool = self.pool.lock().await;
        pool.clone().ok_or_else(|| anyhow!("Not connected"))
    }

    pub(super) fn metadata_connect_options(&self, database: &str) -> Result<PgConnectOptions> {
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

    pub(super) async fn ensure_metadata_pool(
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

    pub(super) async fn schemas_on_pool(pool: &Pool<Postgres>) -> Result<Vec<String>> {
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

    pub(super) async fn tables_on_pool(
        pool: &Pool<Postgres>,
        schema: &str,
    ) -> Result<Vec<TableInfo>> {
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
    pub(super) async fn schema_objects_on_pool(
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

    pub(super) async fn functions_on_pool(
        pool: &Pool<Postgres>,
        schema: &str,
    ) -> Result<Vec<FunctionInfo>> {
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

    pub(super) fn postgres_missing_prokind_error(error: &str) -> bool {
        let lower = error.to_ascii_lowercase();
        (lower.contains("sqlstate 42703")
            || lower.contains("column") && lower.contains("does not exist")
            || error.contains("字段") && error.contains("不存在"))
            && (lower.contains("p.prokind")
                || lower.contains("\"prokind\"")
                || error.contains("p.prokind"))
    }

    pub(super) async fn columns_on_pool(
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
                    FROM pg_index i
                    WHERE i.indrelid = t.oid
                      AND i.indisunique AND i.indisvalid AND i.indisready
                      AND i.indpred IS NULL AND i.indexprs IS NULL
                      AND COALESCE((to_jsonb(i)->>'indnkeyatts')::integer, i.indnatts::integer) = 1
                      AND i.indkey[0] = a.attnum
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
                    character_set: None,
                    collation: None,
                    default_value: row.try_get("column_default").ok(),
                    comment: row.try_get("column_comment").ok(),
                }
            })
            .collect())
    }

    pub(super) async fn generated_columns_on_pool(
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

    pub(super) async fn requires_identity_override_on_pool(
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

    pub(super) async fn indexes_on_pool(
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

    pub(super) async fn constraints_on_pool(
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

    pub(super) async fn supports_with_ordinality(pool: &Pool<Postgres>) -> Result<bool> {
        let server_version_num =
            sqlx::query_scalar::<_, i32>("SELECT current_setting('server_version_num')::integer")
                .persistent(false)
                .fetch_one(pool)
                .await?;
        // WITH ORDINALITY landed in PostgreSQL 9.4. Keep the catalog route
        // for read-only users on 9.3 instead of depending on information_schema.
        Ok(postgres_supports_with_ordinality(server_version_num))
    }

    pub(super) async fn referencing_foreign_keys_on_pool(
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
}
