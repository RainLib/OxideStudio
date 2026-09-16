use super::constants::{
    MIGRATION_JOURNAL_KIND, MIGRATION_JOURNAL_PARENT_ID, OFFLINE_REVIEW_WARNINGS,
};
use super::execution_model::{migration_is_active, SchemaMigrationStatus};
use super::journal_model::SchemaMigrationJournalEntry;
use super::rollback::persist_journal_or_warn;
use super::timestamp::current_timestamp_millis;
use crate::core::protocol::Response;
use crate::core::schema_diff::{finalize_schema_snapshot, SchemaSnapshot};
use crate::core::store::MetaStore;
use tauri::State;

#[tauri::command]
pub async fn list_schema_migration_journal(
    meta_store: State<'_, MetaStore>,
    project_id: String,
    connection_id: String,
    limit: Option<usize>,
) -> Result<Response<Vec<SchemaMigrationJournalEntry>>, String> {
    let resources = match meta_store
        .get_children(
            &project_id,
            Some(MIGRATION_JOURNAL_PARENT_ID),
            &connection_id,
        )
        .await
    {
        Ok(resources) => resources,
        Err(error) => {
            return Ok(Response::err_with_details(
                "SCHEMA_MIGRATION_JOURNAL_LOAD_FAILED",
                &error.to_string(),
                true,
                Some(serde_json::json!({
                    "projectId": project_id,
                    "connectionId": connection_id,
                })),
            ));
        }
    };
    let mut entries = resources
        .into_iter()
        .filter(|resource| resource.kind == MIGRATION_JOURNAL_KIND)
        .filter_map(|resource| {
            serde_json::from_value::<SchemaMigrationJournalEntry>(resource.metadata).ok()
        })
        .collect::<Vec<_>>();
    for entry in &mut entries {
        if interrupt_stale_migration_journal(entry) {
            persist_journal_or_warn(meta_store.inner(), entry).await;
        }
    }
    entries.sort_by_key(|entry| std::cmp::Reverse(entry.started_at));
    entries.truncate(limit.unwrap_or(20).clamp(1, 100));
    Ok(Response::ok(entries))
}

pub(super) fn verify_snapshot_integrity(
    snapshot: SchemaSnapshot,
) -> Result<SchemaSnapshot, String> {
    let supplied_fingerprint = snapshot.fingerprint.clone();
    if supplied_fingerprint.trim().is_empty() {
        return Err("Snapshot fingerprint is missing".to_string());
    }
    let finalized = finalize_schema_snapshot(snapshot).map_err(|error| error.to_string())?;
    if finalized.fingerprint != supplied_fingerprint {
        return Err("Snapshot contents do not match its fingerprint".to_string());
    }
    Ok(finalized)
}

/// Offline baselines are intentionally review-only descriptions. Check every
/// registered marker before fingerprint verification so a frontend guard or a
/// future source format cannot accidentally expose migration execution.
pub(super) fn ensure_snapshot_is_executable_source(
    snapshot: SchemaSnapshot,
) -> Result<SchemaSnapshot, String> {
    if snapshot
        .warnings
        .iter()
        .any(|warning| OFFLINE_REVIEW_WARNINGS.contains(&warning.as_str()))
    {
        return Err(
            "Offline schema baselines are review-only. Capture a live schema snapshot before applying a migration."
                .to_string(),
        );
    }
    verify_snapshot_integrity(snapshot)
}

pub(super) fn interrupt_stale_migration_journal(journal: &mut SchemaMigrationJournalEntry) -> bool {
    if journal.status != SchemaMigrationStatus::Running || migration_is_active(&journal.id) {
        return false;
    }
    journal.status = SchemaMigrationStatus::Interrupted;
    journal.finished_at = Some(current_timestamp_millis());
    journal.error = Some(
        "Migration did not reach a terminal journal entry in this application session. The live target may be partially changed; capture a fresh snapshot and review a new plan before any further migration."
            .to_string(),
    );
    journal.warnings.push(
        "Interrupted migrations cannot be resumed automatically because the database state must be revalidated."
            .to_string(),
    );
    true
}

pub(super) fn migration_confirmation_target(snapshot: &SchemaSnapshot) -> String {
    match snapshot.database_name.as_deref() {
        Some(database) => format!(
            "{} / {} / {}",
            snapshot.connection_name, database, snapshot.schema_name
        ),
        None => format!("{} / {}", snapshot.connection_name, snapshot.schema_name),
    }
}
