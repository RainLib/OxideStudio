use anyhow::{anyhow, Result};
use sqlx::{Pool, Sqlite};
use std::collections::HashMap;
use std::sync::Arc;

use super::values::normalize_sqlite_url;
use tokio::sync::Mutex;

pub(super) type SqliteTransactionSession = Arc<Mutex<sqlx::pool::PoolConnection<Sqlite>>>;

pub(super) fn sqlite_column_ownership(hidden_code: i64) -> (bool, bool) {
    (hidden_code >= 2, hidden_code == 1)
}

/// SQLite is intentionally implemented as a local, file-based driver. It has
/// no server/database switching, but exposes the same bounded query and
/// Explorer metadata contract as the network relational drivers.
pub struct SqliteDriver {
    pub(super) connection_string: String,
    pub(super) read_only: bool,
    pub(super) pool: Mutex<Option<Pool<Sqlite>>>,
    pub(super) transaction_sessions: Mutex<HashMap<String, SqliteTransactionSession>>,
    pub(super) file_operation: Mutex<()>,
}

impl SqliteDriver {
    pub fn new(connection_string: &str) -> Self {
        Self {
            connection_string: normalize_sqlite_url(connection_string),
            read_only: false,
            pool: Mutex::new(None),
            transaction_sessions: Mutex::new(HashMap::new()),
            file_operation: Mutex::new(()),
        }
    }

    /// Agent read-only connections are protected by SQLite itself, rather than
    /// relying only on a SQL lexer or a transaction wrapper. In-memory SQLite
    /// cannot be reopened as read-only, so it is intentionally not an Agent
    /// target.
    pub fn new_read_only(connection_string: &str) -> Result<Self> {
        let connection_string = normalize_sqlite_url(connection_string);
        if connection_string == "sqlite::memory:" {
            return Err(anyhow!(
                "Agent read-only access is unavailable for in-memory SQLite databases"
            ));
        }
        Ok(Self {
            connection_string,
            read_only: true,
            pool: Mutex::new(None),
            transaction_sessions: Mutex::new(HashMap::new()),
            file_operation: Mutex::new(()),
        })
    }
}
