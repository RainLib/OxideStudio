use super::constants::{MIGRATION_JOURNAL_KIND, MIGRATION_JOURNAL_PARENT_ID};
use super::journal_model::{SchemaMigrationJournalEntry, SchemaRollbackArtifact};
use super::timestamp::current_timestamp_millis;
use crate::core::schema_diff::compare_schema_snapshots as build_schema_diff;
use crate::core::schema_diff::{
    finalize_schema_snapshot, SchemaChangeRisk, SchemaDiffPlan, SchemaSnapshot,
};
use crate::core::store::{MetaStore, Resource};

pub(super) fn build_rollback_artifact(
    forward_plan: &SchemaDiffPlan,
    target_before: &SchemaSnapshot,
    desired_source: &SchemaSnapshot,
) -> SchemaRollbackArtifact {
    if forward_plan.changes.iter().any(|change| !change.reversible) {
        return SchemaRollbackArtifact {
            available: false,
            reason: Some(
                "At least one forward change is marked non-reversible; no automatic rollback SQL was published"
                    .to_string(),
            ),
            plan_id: None,
            change_count: 0,
            requires_manual_review: true,
            sql: None,
            backup_path: None,
            backup_byte_len: None,
            backup_integrity_check: None,
        };
    }

    let mut expected_after = desired_source.clone();
    expected_after.id.clear();
    expected_after.fingerprint.clear();
    expected_after.project_id = target_before.project_id.clone();
    expected_after.connection_id = target_before.connection_id.clone();
    expected_after.connection_name = target_before.connection_name.clone();
    expected_after.database_name = target_before.database_name.clone();
    expected_after.schema_name = target_before.schema_name.clone();
    expected_after.driver = target_before.driver.clone();
    expected_after.captured_at = current_timestamp_millis();
    let expected_after = match finalize_schema_snapshot(expected_after) {
        Ok(snapshot) => snapshot,
        Err(error) => {
            return SchemaRollbackArtifact {
                available: false,
                reason: Some(format!("Could not prepare rollback comparison: {error}")),
                plan_id: None,
                change_count: 0,
                requires_manual_review: true,
                sql: None,
                backup_path: None,
                backup_byte_len: None,
                backup_integrity_check: None,
            };
        }
    };
    let reverse =
        match build_schema_diff(target_before, &expected_after, current_timestamp_millis()) {
            Ok(plan) => plan,
            Err(error) => {
                return SchemaRollbackArtifact {
                    available: false,
                    reason: Some(format!("Could not generate rollback comparison: {error}")),
                    plan_id: None,
                    change_count: 0,
                    requires_manual_review: true,
                    sql: None,
                    backup_path: None,
                    backup_byte_len: None,
                    backup_integrity_check: None,
                };
            }
        };
    let blocked =
        reverse.summary.blocked > 0 || reverse.changes.iter().any(|change| change.sql.is_empty());
    SchemaRollbackArtifact {
        available: !blocked,
        reason: blocked.then(|| {
            "The reverse plan contains blocked changes and cannot be offered as runnable rollback SQL"
                .to_string()
        }),
        plan_id: Some(reverse.id),
        change_count: reverse.summary.total,
        requires_manual_review: reverse
            .changes
            .iter()
            .any(|change| change.manual_review || change.risk != SchemaChangeRisk::Safe),
        sql: (!blocked).then_some(reverse.migration_sql),
        backup_path: None,
        backup_byte_len: None,
        backup_integrity_check: None,
    }
}

pub(super) async fn persist_journal_or_warn(
    meta_store: &MetaStore,
    journal: &mut SchemaMigrationJournalEntry,
) {
    let metadata = match serde_json::to_value(&*journal) {
        Ok(metadata) => metadata,
        Err(error) => {
            journal.warnings.push(format!(
                "Could not serialize the migration journal: {error}"
            ));
            return;
        }
    };
    let resource = Resource {
        id: journal.id.clone(),
        project_id: journal.project_id.clone(),
        connection_id: journal.connection_id.clone(),
        parent_id: Some(MIGRATION_JOURNAL_PARENT_ID.to_string()),
        kind: MIGRATION_JOURNAL_KIND.to_string(),
        name: format!("{}:{}", journal.started_at, journal.schema_name),
        metadata,
        last_updated: current_timestamp_millis(),
    };
    if let Err(error) = meta_store
        .save_resources(&journal.project_id, &[resource])
        .await
    {
        let warning = format!("Could not persist the migration journal: {error}");
        if !journal.warnings.contains(&warning) {
            journal.warnings.push(warning);
        }
    }
}
