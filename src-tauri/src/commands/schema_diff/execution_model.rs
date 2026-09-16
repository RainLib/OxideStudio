use super::constants::ACTIVE_MIGRATION_JOURNALS;
use crate::core::dialect::canonical_driver_name;
use crate::core::manager::ConnectionManager;
use crate::core::schema_diff::SchemaSnapshot;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::AppHandle;
use tauri::Manager;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteSchemaMigrationRequest {
    pub source: SchemaSnapshot,
    pub expected_target: SchemaSnapshot,
    pub expected_plan_id: String,
    pub expected_target_fingerprint: String,
    pub confirmation_target: String,
    #[serde(default)]
    pub allow_review: bool,
    #[serde(default)]
    pub allow_destructive: bool,
    /// MySQL and similar engines can auto-commit DDL. This acknowledgement is
    /// deliberately separate from review/destructive approval so a caller
    /// cannot mistake sequential, partially committed execution for a
    /// transactional migration.
    #[serde(default)]
    pub allow_non_transactional: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SchemaMigrationStatus {
    Running,
    /// A journal that was left running by a previous application process.
    /// Its live target must be recaptured; it is never safe to resume it.
    Interrupted,
    Blocked,
    Failed,
    VerificationFailed,
    Succeeded,
}

pub(super) struct ActiveMigrationJournal {
    id: String,
}

impl ActiveMigrationJournal {
    pub(super) fn register(id: &str) -> Self {
        let journals = ACTIVE_MIGRATION_JOURNALS.get_or_init(|| Mutex::new(HashSet::new()));
        if let Ok(mut journals) = journals.lock() {
            journals.insert(id.to_string());
        }
        Self { id: id.to_string() }
    }
}

impl Drop for ActiveMigrationJournal {
    fn drop(&mut self) {
        if let Some(journals) = ACTIVE_MIGRATION_JOURNALS.get() {
            if let Ok(mut journals) = journals.lock() {
                journals.remove(&self.id);
            }
        }
    }
}

pub(super) fn migration_is_active(id: &str) -> bool {
    ACTIVE_MIGRATION_JOURNALS
        .get()
        .and_then(|journals| journals.lock().ok().map(|journals| journals.contains(id)))
        .unwrap_or(false)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SchemaMigrationExecutionMode {
    Transactional,
    NonTransactional,
    SqliteRebuild,
}

pub(super) fn schema_migration_execution_mode(
    driver: &str,
) -> Option<SchemaMigrationExecutionMode> {
    // Resolve aliases through the same dialect registry that generated the
    // migration plan. This keeps MariaDB and future PostgreSQL/MySQL family
    // aliases from silently losing their explicit transaction semantics.
    match canonical_driver_name(driver)? {
        "postgres" => Some(SchemaMigrationExecutionMode::Transactional),
        // MySQL DDL may commit implicitly. It is still useful to apply a
        // reviewed plan, but it must run in an explicit statement-by-statement
        // mode with a persistent progress journal.
        "mysql" => Some(SchemaMigrationExecutionMode::NonTransactional),
        "sqlite" => Some(SchemaMigrationExecutionMode::SqliteRebuild),
        _ => None,
    }
}

pub(super) fn sqlite_migration_backup_path(
    app: &AppHandle,
    journal_id: &str,
) -> Result<PathBuf, String> {
    let safe_id = journal_id
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .take(120)
        .collect::<String>();
    if safe_id.is_empty() {
        return Err("SQLite migration journal identity is invalid".to_string());
    }
    let directory = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Cannot resolve SQLite migration backup directory: {error}"))?
        .join("schema-migration-backups");
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("Cannot create SQLite migration backup directory: {error}"))?;
    Ok(directory.join(format!("{safe_id}.sqlite")))
}

pub(super) fn ensure_host_schema_migration_capability(
    capabilities: Option<&crate::core::dialect::DatabaseCapabilities>,
) -> Result<(), String> {
    if let Some(capabilities) = capabilities {
        return Err(format!(
            "{} does not provide a verified semantic schema migration protocol",
            capabilities.display_name
        ));
    }
    Ok(())
}

pub(super) async fn ensure_host_schema_migration_allowed(
    manager: &ConnectionManager,
    connection_id: &str,
) -> Result<(), String> {
    let capabilities = manager
        .package_capabilities(connection_id)
        .await
        .map_err(|error| error.to_string())?;
    ensure_host_schema_migration_capability(capabilities.as_ref())
}
