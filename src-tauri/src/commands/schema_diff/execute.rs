use super::capture::capture_schema_snapshot_inner;
use super::execution_model::{
    ensure_host_schema_migration_allowed, schema_migration_execution_mode,
    sqlite_migration_backup_path, ActiveMigrationJournal, ExecuteSchemaMigrationRequest,
    SchemaMigrationExecutionMode, SchemaMigrationStatus,
};
use super::external_execute::execute_external_schema_migration;
use super::journal::{
    ensure_snapshot_is_executable_source, migration_confirmation_target, verify_snapshot_integrity,
};
use super::journal_model::{SchemaMigrationJournalEntry, SchemaMigrationVerification};
use super::preflight::run_preflight_check;
use super::rollback::{build_rollback_artifact, persist_journal_or_warn};
use super::session::ExternalSchemaMigrationSessionState;
use super::timestamp::current_timestamp_millis;
use crate::core::manager::ConnectionManager;
use crate::core::protocol::{ParameterizedStatement, Response};
use crate::core::schema_diff::compare_schema_snapshots as build_schema_diff;
use crate::core::schema_diff::SchemaChangeRisk;
use crate::core::store::MetaStore;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn execute_schema_migration(
    app: AppHandle,
    manager: State<'_, ConnectionManager>,
    meta_store: State<'_, MetaStore>,
    sessions: State<'_, ExternalSchemaMigrationSessionState>,
    request: ExecuteSchemaMigrationRequest,
) -> Result<Response<SchemaMigrationJournalEntry>, String> {
    let context = serde_json::json!({
        "projectId": request.expected_target.project_id,
        "connectionId": request.expected_target.connection_id,
        "database": request.expected_target.database_name,
        "schema": request.expected_target.schema_name,
        "expectedPlanId": request.expected_plan_id,
    });

    let source = match ensure_snapshot_is_executable_source(request.source) {
        Ok(snapshot) => snapshot,
        Err(error) => {
            return Ok(Response::err_with_details(
                "SCHEMA_MIGRATION_INVALID_SOURCE",
                &error,
                false,
                Some(context),
            ));
        }
    };
    let expected_target = match verify_snapshot_integrity(request.expected_target) {
        Ok(snapshot) => snapshot,
        Err(error) => {
            return Ok(Response::err_with_details(
                "SCHEMA_MIGRATION_INVALID_TARGET",
                &error,
                false,
                Some(context),
            ));
        }
    };
    if source.project_id != expected_target.project_id {
        return Ok(Response::err_with_details(
            "SCHEMA_MIGRATION_PROJECT_MISMATCH",
            "Source and target snapshots belong to different projects",
            false,
            Some(context),
        ));
    }
    let capability = manager
        .capability_snapshot(&expected_target.connection_id)
        .await
        .map_err(|error| error.to_string())?;
    let is_external = capability.external_driver_id.is_some();
    let confirmation_target = migration_confirmation_target(&expected_target);
    if request.confirmation_target.trim() != confirmation_target {
        return Ok(Response::err_with_details(
            "SCHEMA_MIGRATION_CONFIRMATION_REQUIRED",
            "Type the exact connection / database / schema target before applying this migration",
            false,
            Some(serde_json::json!({
                "connectionId": expected_target.connection_id,
                "database": expected_target.database_name,
                "schema": expected_target.schema_name,
                "confirmationTarget": confirmation_target,
            })),
        ));
    }
    if request.expected_target_fingerprint != expected_target.fingerprint {
        return Ok(Response::err_with_details(
            "SCHEMA_MIGRATION_TARGET_FINGERPRINT_MISMATCH",
            "The approved target fingerprint does not match the supplied snapshot",
            false,
            Some(context),
        ));
    }

    if is_external {
        return execute_external_schema_migration(
            manager.inner(),
            meta_store.inner(),
            sessions.inner(),
            source,
            expected_target,
            request.expected_plan_id,
            request.expected_target_fingerprint,
            request.allow_review,
            request.allow_destructive,
            request.allow_non_transactional,
            context,
        )
        .await;
    }

    if let Err(error) =
        ensure_host_schema_migration_allowed(manager.inner(), &expected_target.connection_id).await
    {
        return Ok(Response::err_with_details(
            "SCHEMA_MIGRATION_UNSAFE_DRIVER",
            &error,
            false,
            Some(context),
        ));
    }

    let approved_plan =
        match build_schema_diff(&source, &expected_target, current_timestamp_millis()) {
            Ok(plan) => plan,
            Err(error) => {
                return Ok(Response::err_with_details(
                    "SCHEMA_MIGRATION_PLAN_INVALID",
                    &error.to_string(),
                    false,
                    Some(context),
                ));
            }
        };
    if approved_plan.id != request.expected_plan_id {
        return Ok(Response::err_with_details(
            "SCHEMA_MIGRATION_PLAN_MISMATCH",
            "The approved plan id does not match the supplied snapshots",
            false,
            Some(context),
        ));
    }
    let Some(execution_mode) = schema_migration_execution_mode(&approved_plan.driver) else {
        return Ok(Response::err_with_details(
            "SCHEMA_MIGRATION_UNSAFE_DRIVER",
            "Automatic migration apply is available only for PostgreSQL transactional plans, explicitly acknowledged MySQL non-transactional plans, and complete catalog-backed SQLite migration plans; open the reviewed SQL in a console for other drivers",
            false,
            Some(context),
        ));
    };
    if execution_mode == SchemaMigrationExecutionMode::NonTransactional
        && !request.allow_non_transactional
    {
        return Ok(Response::err_with_details(
            "SCHEMA_MIGRATION_NON_TRANSACTIONAL_APPROVAL_REQUIRED",
            "This driver can auto-commit DDL. Explicitly acknowledge non-transactional execution before applying the reviewed plan",
            false,
            Some(context),
        ));
    }
    if approved_plan.changes.is_empty() {
        return Ok(Response::err_with_details(
            "SCHEMA_MIGRATION_EMPTY_PLAN",
            "There are no schema changes to apply",
            false,
            Some(context),
        ));
    }
    if approved_plan.summary.blocked > 0
        || approved_plan
            .changes
            .iter()
            .any(|change| change.sql.is_empty())
    {
        return Ok(Response::err_with_details(
            "SCHEMA_MIGRATION_BLOCKED_PLAN",
            "The plan contains blocked changes or changes without executable SQL",
            false,
            Some(context),
        ));
    }
    let requires_review = approved_plan
        .changes
        .iter()
        .any(|change| change.manual_review || change.risk == SchemaChangeRisk::Review);
    if requires_review && !request.allow_review {
        return Ok(Response::err_with_details(
            "SCHEMA_MIGRATION_REVIEW_APPROVAL_REQUIRED",
            "The plan contains changes that require explicit manual-review approval",
            false,
            Some(context),
        ));
    }
    let requires_destructive = approved_plan
        .changes
        .iter()
        .any(|change| change.risk == SchemaChangeRisk::Destructive || !change.reversible);
    if requires_destructive && !request.allow_destructive {
        return Ok(Response::err_with_details(
            "SCHEMA_MIGRATION_DESTRUCTIVE_APPROVAL_REQUIRED",
            "The plan contains destructive or non-reversible changes that require explicit approval",
            false,
            Some(context),
        ));
    }

    let fresh_target = match capture_schema_snapshot_inner(
        manager.inner(),
        expected_target.project_id.clone(),
        expected_target.connection_id.clone(),
        expected_target.connection_name.clone(),
        expected_target.driver.clone(),
        expected_target.database_name.clone(),
        expected_target.schema_name.clone(),
        false,
    )
    .await
    {
        Ok(snapshot) => snapshot,
        Err(error) => {
            return Ok(Response::err_with_details(
                "SCHEMA_MIGRATION_REFRESH_FAILED",
                &format!("Could not refresh the live target before execution: {error}"),
                true,
                Some(context),
            ));
        }
    };
    if fresh_target.fingerprint != request.expected_target_fingerprint {
        return Ok(Response::err_with_details(
            "SCHEMA_MIGRATION_STALE_TARGET",
            "The live target changed after this plan was created. Capture a fresh snapshot and review a new plan",
            true,
            Some(serde_json::json!({
                "connectionId": fresh_target.connection_id,
                "database": fresh_target.database_name,
                "schema": fresh_target.schema_name,
                "expectedFingerprint": request.expected_target_fingerprint,
                "actualFingerprint": fresh_target.fingerprint,
            })),
        ));
    }
    let plan = match build_schema_diff(&source, &fresh_target, current_timestamp_millis()) {
        Ok(plan) if plan.id == request.expected_plan_id => plan,
        Ok(_) => {
            return Ok(Response::err_with_details(
                "SCHEMA_MIGRATION_RECOMPUTE_MISMATCH",
                "The backend recomputed a different migration plan; review a fresh plan before applying",
                true,
                Some(context),
            ));
        }
        Err(error) => {
            return Ok(Response::err_with_details(
                "SCHEMA_MIGRATION_RECOMPUTE_FAILED",
                &error.to_string(),
                true,
                Some(context),
            ));
        }
    };

    let statements = plan
        .changes
        .iter()
        .flat_map(|change| change.sql.iter())
        .filter(|sql| !sql.trim().is_empty())
        .map(|sql| ParameterizedStatement {
            sql: sql.clone(),
            params: Vec::new(),
        })
        .collect::<Vec<_>>();
    let started_at = current_timestamp_millis();
    let mut journal = SchemaMigrationJournalEntry {
        id: format!(
            "schema-migration-{}-{}",
            started_at,
            plan.id.trim_start_matches("schema-diff-")
        ),
        project_id: fresh_target.project_id.clone(),
        connection_id: fresh_target.connection_id.clone(),
        connection_name: fresh_target.connection_name.clone(),
        database_name: fresh_target.database_name.clone(),
        schema_name: fresh_target.schema_name.clone(),
        plan_id: plan.id.clone(),
        source_fingerprint: source.fingerprint.clone(),
        target_fingerprint_before: fresh_target.fingerprint.clone(),
        status: SchemaMigrationStatus::Running,
        started_at,
        finished_at: None,
        statement_count: statements.len(),
        committed_statements: 0,
        preflight_results: Vec::new(),
        rollback: build_rollback_artifact(&plan, &fresh_target, &source),
        verification: None,
        error: None,
        warnings: Vec::new(),
    };
    if execution_mode == SchemaMigrationExecutionMode::NonTransactional {
        journal.warnings.push(
            "This migration runs statement by statement because MySQL DDL can auto-commit. A failure can leave already recorded statements committed; use the journal and post-verification to recover."
                .to_string(),
        );
    }
    // Register before persistence. A journal that is visible as `running` in
    // this process must never be mistaken for a stale process-crash record.
    let _active_journal = ActiveMigrationJournal::register(&journal.id);
    persist_journal_or_warn(meta_store.inner(), &mut journal).await;

    for check in &plan.preflight_checks {
        journal
            .preflight_results
            .push(run_preflight_check(manager.inner(), &fresh_target, check).await);
    }
    persist_journal_or_warn(meta_store.inner(), &mut journal).await;
    if journal
        .preflight_results
        .iter()
        .any(|result| result.blocks_execution)
    {
        journal.status = SchemaMigrationStatus::Blocked;
        journal.finished_at = Some(current_timestamp_millis());
        journal.error = Some(
            "Migration was not applied because one or more preflight checks did not pass"
                .to_string(),
        );
        persist_journal_or_warn(meta_store.inner(), &mut journal).await;
        return Ok(Response::ok(journal));
    }

    match execution_mode {
        SchemaMigrationExecutionMode::Transactional => {
            let apply_result = match fresh_target.database_name.as_deref() {
                Some(database) => {
                    manager
                        .execute_database_parameterized_batch(
                            &fresh_target.connection_id,
                            database,
                            &statements,
                        )
                        .await
                }
                None => {
                    manager
                        .execute_parameterized_batch(&fresh_target.connection_id, &statements)
                        .await
                }
            };
            if let Err(error) = apply_result {
                journal.status = SchemaMigrationStatus::Failed;
                journal.finished_at = Some(current_timestamp_millis());
                journal.error = Some(format!(
                    "PostgreSQL rejected the migration; the transaction was rolled back: {error}"
                ));
                persist_journal_or_warn(meta_store.inner(), &mut journal).await;
                return Ok(Response::ok(journal));
            }
            journal.committed_statements = statements.len();
        }
        SchemaMigrationExecutionMode::NonTransactional => {
            for statement in &statements {
                if let Err(error) = manager
                    .execute_parameterized(
                        &fresh_target.connection_id,
                        &statement.sql,
                        &statement.params,
                    )
                    .await
                {
                    journal.status = SchemaMigrationStatus::Failed;
                    journal.finished_at = Some(current_timestamp_millis());
                    journal.error = Some(format!(
                        "MySQL rejected migration statement {} of {}; {} statement(s) may already be committed: {error}",
                        journal.committed_statements + 1,
                        statements.len(),
                        journal.committed_statements,
                    ));
                    persist_journal_or_warn(meta_store.inner(), &mut journal).await;
                    return Ok(Response::ok(journal));
                }
                journal.committed_statements += 1;
                persist_journal_or_warn(meta_store.inner(), &mut journal).await;
            }
        }
        SchemaMigrationExecutionMode::SqliteRebuild => {
            let backup_path = match sqlite_migration_backup_path(&app, &journal.id) {
                Ok(path) => path,
                Err(error) => {
                    journal.status = SchemaMigrationStatus::Failed;
                    journal.finished_at = Some(current_timestamp_millis());
                    journal.error = Some(error);
                    persist_journal_or_warn(meta_store.inner(), &mut journal).await;
                    return Ok(Response::ok(journal));
                }
            };
            journal.rollback.backup_path = Some(backup_path.to_string_lossy().into_owned());
            persist_journal_or_warn(meta_store.inner(), &mut journal).await;
            match manager
                .execute_sqlite_rebuild_batch(
                    &fresh_target.connection_id,
                    &statements,
                    &backup_path,
                )
                .await
            {
                Ok(receipt) => {
                    journal.committed_statements = receipt.statements_applied;
                    journal.rollback.available = true;
                    journal.rollback.reason = Some(
                        "Restore the verified SQLite recovery backup to roll back this rebuild."
                            .to_string(),
                    );
                    journal.rollback.change_count = 1;
                    journal.rollback.requires_manual_review = true;
                    journal.rollback.backup_byte_len = Some(receipt.backup.byte_len);
                    journal.rollback.backup_integrity_check = Some(receipt.backup.integrity_check);
                }
                Err(error) => {
                    if backup_path.is_file() {
                        journal.rollback.available = true;
                        journal.rollback.reason = Some(
                            "The rebuild did not complete cleanly. A verified pre-change SQLite backup was retained; recapture the live target before deciding whether to restore it."
                                .to_string(),
                        );
                        journal.rollback.change_count = 1;
                        journal.rollback.requires_manual_review = true;
                        journal.rollback.backup_byte_len = std::fs::metadata(&backup_path)
                            .ok()
                            .map(|metadata| metadata.len());
                        journal.rollback.backup_integrity_check = Some("ok".to_string());
                        // The driver requests rollback for every pre-commit
                        // failure, but an I/O failure can also occur after the
                        // commit or while restoring connection pragmas. Never
                        // claim a rollback without recapturing the live schema.
                        journal.status = SchemaMigrationStatus::VerificationFailed;
                    } else {
                        journal.rollback.backup_path = None;
                        journal.status = SchemaMigrationStatus::Failed;
                    }
                    journal.finished_at = Some(current_timestamp_millis());
                    journal.error = Some(format!(
                        "SQLite did not complete the rebuild cleanly. The transaction rollback was requested, but the live target must be recaptured before retrying: {error}"
                    ));
                    persist_journal_or_warn(meta_store.inner(), &mut journal).await;
                    return Ok(Response::ok(journal));
                }
            }
        }
    }

    let post_target = match capture_schema_snapshot_inner(
        manager.inner(),
        fresh_target.project_id.clone(),
        fresh_target.connection_id.clone(),
        fresh_target.connection_name.clone(),
        fresh_target.driver.clone(),
        fresh_target.database_name.clone(),
        fresh_target.schema_name.clone(),
        false,
    )
    .await
    {
        Ok(snapshot) => snapshot,
        Err(error) => {
            journal.status = SchemaMigrationStatus::VerificationFailed;
            journal.finished_at = Some(current_timestamp_millis());
            journal.error = Some(format!(
                "Migration committed, but the live target could not be captured for verification: {error}"
            ));
            persist_journal_or_warn(meta_store.inner(), &mut journal).await;
            return Ok(Response::ok(journal));
        }
    };
    match build_schema_diff(&source, &post_target, current_timestamp_millis()) {
        Ok(remaining) => {
            let matches_source = remaining.summary.total == 0;
            journal.status = if matches_source {
                SchemaMigrationStatus::Succeeded
            } else {
                SchemaMigrationStatus::VerificationFailed
            };
            if !matches_source {
                journal.error = Some(format!(
                    "Migration committed, but post-verification found {} remaining schema changes",
                    remaining.summary.total
                ));
            }
            journal.verification = Some(SchemaMigrationVerification {
                matches_source,
                target_fingerprint_after: post_target.fingerprint,
                remaining_plan_id: remaining.id,
                remaining_summary: remaining.summary,
                warnings: remaining.warnings,
            });
        }
        Err(error) => {
            journal.status = SchemaMigrationStatus::VerificationFailed;
            journal.error = Some(format!(
                "Migration committed, but post-verification could not compare the live target: {error}"
            ));
        }
    }
    journal.finished_at = Some(current_timestamp_millis());
    persist_journal_or_warn(meta_store.inner(), &mut journal).await;
    Ok(Response::ok(journal))
}
