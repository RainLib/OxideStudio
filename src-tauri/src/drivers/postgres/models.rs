use crate::core::dialect::DatabaseKind;
use anyhow::Result;
use sqlx::pool::PoolConnection;
use sqlx::{Pool, Postgres, Row};
use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;
use tokio::sync::Mutex;

pub(super) struct PostgresTransactionSession {
    pub(super) connection: Mutex<PoolConnection<Postgres>>,
    /// A database-scoped session owns a dedicated one-connection pool. Keeping
    /// it beside the checked-out connection prevents a selected database from
    /// sharing (or being replaced by) the Explorer metadata pool.
    pub(super) _database_pool: Option<Pool<Postgres>>,
}

pub(super) type PostgresTransactionSessionHandle = Arc<PostgresTransactionSession>;
pub(super) const POOL_CLOSE_TIMEOUT: Duration = Duration::from_secs(5);
pub(super) const METADATA_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
pub(super) const METADATA_QUERY_TIMEOUT: Duration = Duration::from_secs(20);
pub(super) const METADATA_POOL_IDLE_TIMEOUT: Duration = Duration::from_secs(60);
pub(super) const METADATA_POOL_MAX_LIFETIME: Duration = Duration::from_secs(300);
pub(super) const POSTGRES_BACKEND_PID_SQL: &str = "SELECT CAST(pg_backend_pid() AS TEXT)";

pub(super) fn parse_postgres_backend_pid(value: &str) -> Option<i32> {
    value
        .trim()
        .parse::<i32>()
        .ok()
        .filter(|backend_pid| *backend_pid > 0)
}

/// PostgreSQL added `WITH ORDINALITY` in 9.4. Keep the boundary in one
/// testable place because catalog metadata must remain readable on 9.3.
pub(super) fn postgres_supports_with_ordinality(server_version_num: i32) -> bool {
    server_version_num >= 90_400
}

/// INCLUDE columns and `pg_index.indnkeyatts` landed in PostgreSQL 11.
/// Returning a static, host-owned expression keeps older catalog queries from
/// referencing a column that their parser does not know about.
pub(super) fn postgres_index_key_count_expression(server_version_num: i32) -> &'static str {
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
pub(super) fn postgres_search_path_with_selected_schema(
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

pub(super) async fn configure_postgres_search_path(
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

pub(super) struct PostgresMetadataPool {
    pub(super) database: String,
    pub(super) pool: Pool<Postgres>,
}

pub struct PostgresDriver {
    pub pool: Mutex<Option<Pool<Postgres>>>,
    pub connection_string: String,
    pub(super) transaction_sessions: Mutex<HashMap<String, PostgresTransactionSessionHandle>>,
    pub active_queries: StdMutex<HashMap<String, i32>>,
    /// A single cached pool for read-only Database Explorer metadata. Holding
    /// this mutex across a metadata query serializes database switches, so the
    /// driver can never create more than one additional PostgreSQL connection.
    pub(super) metadata_pool: Mutex<Option<PostgresMetadataPool>>,
}

pub(super) struct PostgresTrackedQueryGuard<'a> {
    pub(super) active_queries: &'a StdMutex<HashMap<String, i32>>,
    pub(super) query_id: Option<String>,
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
