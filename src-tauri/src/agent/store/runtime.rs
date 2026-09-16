use anyhow::{Context, Result};
use sqlx::sqlite::SqlitePoolOptions;
#[cfg(test)]
use std::path::PathBuf;
use std::{collections::HashMap, sync::Arc};
use tauri::{AppHandle, Manager};
use tokio::sync::{OnceCell, RwLock};
use zeroize::Zeroizing;

use super::crypto::{random_key, resolve_persistent_key};
use super::models::{AgentStore, Backend, PersistentBackend, SessionBackend, AGENT_STORE_KEY_FILE};
use super::persistence::{cleanup_backend, init_schema, now_millis};

impl AgentStore {
    pub fn new(app: &AppHandle) -> Self {
        let config_dir = app
            .path()
            .app_config_dir()
            .unwrap_or_else(|_| std::env::temp_dir().join("oxide-studio"));
        Self {
            db_path: config_dir.join("agent-state-v2.db"),
            key_path: config_dir.join("credentials").join(AGENT_STORE_KEY_FILE),
            backend: Arc::new(OnceCell::new()),
        }
    }

    pub async fn storage_mode(&self) -> Result<&'static str> {
        Ok(match self.backend().await?.as_ref() {
            Backend::Persistent(_) => "encrypted-persistent",
            Backend::Session(_) => "encrypted-session",
        })
    }

    /// Reports an already initialized backend without touching disk.
    pub fn initialized_storage_mode(&self) -> Option<&'static str> {
        self.backend.get().map(|backend| match backend.as_ref() {
            Backend::Persistent(_) => "encrypted-persistent",
            Backend::Session(_) => "encrypted-session",
        })
    }
}

impl AgentStore {
    pub(super) async fn backend(&self) -> Result<&Arc<Backend>> {
        self.backend
            .get_or_try_init(|| async {
                let key_path = self.key_path.clone();
                let key = tokio::task::spawn_blocking(move || resolve_persistent_key(&key_path))
                    .await
                    .context("agent key file task failed")?;
                let backend = match key {
                    Some(key) => {
                        let parent = self
                            .db_path
                            .parent()
                            .context("agent state database has no parent directory")?;
                        tokio::fs::create_dir_all(parent)
                            .await
                            .context("failed to create agent state directory")?;
                        let url = format!("sqlite://{}?mode=rwc", self.db_path.to_string_lossy());
                        let pool = SqlitePoolOptions::new()
                            .max_connections(3)
                            .connect(&url)
                            .await
                            .context("failed to open encrypted agent state database")?;
                        init_schema(&pool).await?;
                        Backend::Persistent(PersistentBackend {
                            pool,
                            key: Zeroizing::new(key),
                        })
                    }
                    None => Backend::Session(Box::new(SessionBackend {
                        key: Zeroizing::new(random_key()),
                        records: RwLock::new(HashMap::new()),
                        graph_checkpoints: RwLock::new(HashMap::new()),
                        graph_writes: RwLock::new(HashMap::new()),
                    })),
                };
                cleanup_backend(&backend, now_millis()).await?;
                Ok(Arc::new(backend))
            })
            .await
    }
}

impl AgentStore {
    #[cfg(test)]
    pub(super) fn session_for_test(db_path: PathBuf, key: [u8; 32]) -> Self {
        let backend = OnceCell::new();
        let _ = backend.set(Arc::new(Backend::Session(Box::new(SessionBackend {
            key: Zeroizing::new(key),
            records: RwLock::new(HashMap::new()),
            graph_checkpoints: RwLock::new(HashMap::new()),
            graph_writes: RwLock::new(HashMap::new()),
        }))));
        Self {
            db_path,
            key_path: PathBuf::from("unused"),
            backend: Arc::new(backend),
        }
    }

    #[cfg(test)]
    pub(super) async fn persistent_for_test(db_path: PathBuf, key: [u8; 32]) -> Result<Self> {
        if let Some(parent) = db_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let url = format!("sqlite://{}?mode=rwc", db_path.to_string_lossy());
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect(&url)
            .await?;
        init_schema(&pool).await?;
        let backend = OnceCell::new();
        let _ = backend.set(Arc::new(Backend::Persistent(PersistentBackend {
            pool,
            key: Zeroizing::new(key),
        })));
        Ok(Self {
            db_path,
            key_path: PathBuf::from("unused"),
            backend: Arc::new(backend),
        })
    }
}
