use crate::core::schema_diff::{
    SchemaChange, SchemaChangeKind, SchemaChangePhase, SchemaChangeRisk, SchemaDiffExecutionOwner,
    SchemaDiffPlan, SchemaDiffSummary, SchemaSnapshot,
};
use oxide_driver_protocol::{
    SchemaMigrationMode, SchemaMigrationPlanResult as DriverMigrationPlanResult,
};

pub(super) fn external_review_only_plan(mut plan: SchemaDiffPlan) -> SchemaDiffPlan {
    plan.execution_owner = SchemaDiffExecutionOwner::ReviewOnly;
    plan.requires_review_approval = true;
    plan.transactional = false;
    plan.migration_sql =
        "-- External driver migration is review-only without exact package, platform, and server-version evidence.\n"
            .to_string();
    plan.preflight_checks.clear();
    plan.preflight_sql.clear();
    for change in &mut plan.changes {
        change.sql.clear();
        change.manual_review = true;
        change.blocked_reason = Some(
            "The live external driver does not have exact semantic migration evidence".to_string(),
        );
    }
    plan.summary.blocked = plan.changes.len();
    plan.warnings.push(
        "Automatic apply is disabled because this exact external package, platform, and server version has no verified migration evidence."
            .to_string(),
    );
    plan
}

pub(super) fn external_driver_plan(
    source: &SchemaSnapshot,
    target: &SchemaSnapshot,
    host_plan_id: String,
    generated_at: i64,
    result: &DriverMigrationPlanResult,
) -> SchemaDiffPlan {
    let mut preview_safe = 0usize;
    let mut preview_review = 0usize;
    let mut preview_destructive = 0usize;
    let mut changes = result
        .preview
        .iter()
        .enumerate()
        .map(|(index, change)| {
            let risk = match change.risk.as_str() {
                "safe" => {
                    preview_safe += 1;
                    SchemaChangeRisk::Safe
                }
                "destructive" => {
                    preview_destructive += 1;
                    SchemaChangeRisk::Destructive
                }
                _ => {
                    preview_review += 1;
                    SchemaChangeRisk::Review
                }
            };
            SchemaChange {
                id: format!("{host_plan_id}-change-{:05}", index + 1),
                kind: SchemaChangeKind::SchemaObjectModify,
                risk,
                schema_name: target.schema_name.clone(),
                relation_name: change.label.clone(),
                object_type: Some(change.kind.clone()),
                child_name: None,
                summary: change.summary.clone(),
                sql: Vec::new(),
                reversible: change.reversible,
                manual_review: risk != SchemaChangeRisk::Safe,
                phase: SchemaChangePhase::ManualReview,
                order: index + 1,
                depends_on: Vec::new(),
                blocked_reason: None,
            }
        })
        .collect::<Vec<_>>();
    if result.blocked_change_count > 0 {
        if let Some(first) = changes.first_mut() {
            first.blocked_reason = Some(format!(
                "The target driver blocked {} planned change(s)",
                result.blocked_change_count
            ));
        }
    }
    let unpreviewed = result.change_count as usize - changes.len();
    let (safe, review, destructive) = if result.requires_destructive {
        (
            preview_safe,
            preview_review,
            preview_destructive + unpreviewed,
        )
    } else if result.requires_review {
        (
            preview_safe,
            preview_review + unpreviewed,
            preview_destructive,
        )
    } else {
        (
            preview_safe + unpreviewed,
            preview_review,
            preview_destructive,
        )
    };
    let mut warnings = result.warnings.clone();
    warnings.push(
        "This is a target-owned semantic plan. OxideStudio will never execute the preview text as SQL."
            .to_string(),
    );
    if unpreviewed > 0 {
        warnings.push(format!(
            "The driver returned a bounded preview for {} of {} changes.",
            changes.len(),
            result.change_count
        ));
    }
    SchemaDiffPlan {
        id: host_plan_id,
        source_snapshot_id: source.id.clone(),
        target_snapshot_id: target.id.clone(),
        driver: target.driver.clone(),
        target_connection_id: target.connection_id.clone(),
        target_database_name: target.database_name.clone(),
        target_schema_name: target.schema_name.clone(),
        generated_at,
        transactional: result.mode == SchemaMigrationMode::Transactional,
        execution_owner: SchemaDiffExecutionOwner::ExternalDriver,
        requires_review_approval: result.requires_review,
        requires_destructive_approval: result.requires_destructive,
        summary: SchemaDiffSummary {
            total: result.change_count as usize,
            safe,
            review,
            destructive,
            blocked: result.blocked_change_count as usize,
        },
        changes,
        migration_sql: String::new(),
        preflight_checks: Vec::new(),
        preflight_sql: String::new(),
        conversion_issues: Vec::new(),
        warnings,
    }
}
