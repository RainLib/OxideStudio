use super::capture::capture_schema_snapshot_inner;
use super::execution_model::{ActiveMigrationJournal, SchemaMigrationStatus};
use super::journal_model::{
    SchemaMigrationJournalEntry, SchemaMigrationPreflightResult, SchemaMigrationPreflightStatus,
    SchemaMigrationVerification, SchemaRollbackArtifact,
};
use super::rollback::persist_journal_or_warn;
use super::session::ExternalSchemaMigrationSessionState;
use super::timestamp::current_timestamp_millis;
use crate::core::manager::ConnectionManager;
use crate::core::protocol::Response;
use crate::core::schema_diff::{SchemaDiffSummary, SchemaSnapshot};
use crate::core::store::MetaStore;
use oxide_driver_protocol::{
    SchemaMigrationApplyRequest as DriverMigrationApplyRequest,
    SchemaMigrationApplyStatus as DriverMigrationApplyStatus, SchemaMigrationMode,
    SchemaMigrationPreflightRequest as DriverMigrationPreflightRequest,
    SchemaMigrationVerifyRequest as DriverMigrationVerifyRequest,
};

pub(super) fn external_preflight_results(
    result: &oxide_driver_protocol::SchemaMigrationPreflightResult,
) -> Vec<SchemaMigrationPreflightResult> {
    result
        .checks
        .iter()
        .map(|check| {
            let status = if check.blocks_execution {
                SchemaMigrationPreflightStatus::Blocked
            } else {
                match check.status.trim().to_ascii_lowercase().as_str() {
                    "passed" | "pass" | "ok" => SchemaMigrationPreflightStatus::Passed,
                    "error" | "failed" => SchemaMigrationPreflightStatus::Error,
                    _ => SchemaMigrationPreflightStatus::Warning,
                }
            };
            SchemaMigrationPreflightResult {
                check_id: check.id.clone(),
                change_id: String::new(),
                label: check.label.clone(),
                expectation: "Target driver semantic preflight".to_string(),
                status,
                observed: if check.blocks_execution {
                    "Target driver reported a blocking condition".to_string()
                } else {
                    "Target driver completed this semantic check".to_string()
                },
                blocks_execution: check.blocks_execution,
                error: None,
            }
        })
        .collect()
}

pub(super) async fn attach_host_recapture_after_external_failure(
    manager: &ConnectionManager,
    source: &SchemaSnapshot,
    target: &SchemaSnapshot,
    plan_id: &str,
    journal: &mut SchemaMigrationJournalEntry,
) {
    journal.warnings.push(
        "The target-owned apply/verify exchange did not complete cleanly. The database may still be changing; capture a fresh snapshot before another migration."
            .to_string(),
    );
    match capture_schema_snapshot_inner(
        manager,
        source.project_id.clone(),
        target.connection_id.clone(),
        target.connection_name.clone(),
        target.driver.clone(),
        target.database_name.clone(),
        target.schema_name.clone(),
        false,
    )
    .await
    {
        Ok(snapshot) => {
            let matches_source = snapshot.fingerprint == source.fingerprint;
            let remaining = usize::from(!matches_source);
            journal.verification = Some(SchemaMigrationVerification {
                matches_source,
                target_fingerprint_after: snapshot.fingerprint,
                remaining_plan_id: plan_id.to_string(),
                remaining_summary: SchemaDiffSummary {
                    total: remaining,
                    safe: 0,
                    review: remaining,
                    destructive: 0,
                    blocked: remaining,
                },
                warnings: vec![
                    "Only the Host recapture completed; target-driver verification was unavailable."
                        .to_string(),
                ],
            });
        }
        Err(error) => journal.warnings.push(format!(
            "Host schema recapture also failed after the target-owned operation: {error}"
        )),
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn execute_external_schema_migration(
    manager: &ConnectionManager,
    meta_store: &MetaStore,
    sessions: &ExternalSchemaMigrationSessionState,
    source: SchemaSnapshot,
    expected_target: SchemaSnapshot,
    expected_plan_id: String,
    expected_target_fingerprint: String,
    allow_review: bool,
    allow_destructive: bool,
    allow_non_transactional: bool,
    context: serde_json::Value,
) -> Result<Response<SchemaMigrationJournalEntry>, String> {
    let session = match sessions.get(&expected_plan_id) {
        Ok(session) => session,
        Err(error) => {
            return Ok(Response::err_with_details(
                "SCHEMA_MIGRATION_SESSION_EXPIRED",
                &error,
                true,
                Some(context),
            ));
        }
    };
    if session.connection_id != expected_target.connection_id
        || session.source_fingerprint != source.fingerprint
        || session.target_fingerprint != expected_target_fingerprint
        || session.host_plan_id != expected_plan_id
    {
        return Ok(Response::err_with_details(
            "SCHEMA_MIGRATION_SESSION_MISMATCH",
            "The target-owned migration session does not match these snapshots",
            true,
            Some(context),
        ));
    }
    if session.change_count == 0 {
        return Ok(Response::err_with_details(
            "SCHEMA_MIGRATION_EMPTY_PLAN",
            "There are no schema changes to apply",
            false,
            Some(context),
        ));
    }
    if session.blocked_change_count > 0 {
        return Ok(Response::err_with_details(
            "SCHEMA_MIGRATION_BLOCKED_PLAN",
            "The target driver blocked one or more planned changes",
            false,
            Some(context),
        ));
    }
    if session.requires_review && !allow_review {
        return Ok(Response::err_with_details(
            "SCHEMA_MIGRATION_REVIEW_APPROVAL_REQUIRED",
            "The target-owned plan requires explicit manual-review approval",
            false,
            Some(context),
        ));
    }
    if session.requires_destructive && !allow_destructive {
        return Ok(Response::err_with_details(
            "SCHEMA_MIGRATION_DESTRUCTIVE_APPROVAL_REQUIRED",
            "The target-owned plan requires explicit destructive-change approval",
            false,
            Some(context),
        ));
    }
    if session.mode == SchemaMigrationMode::NonTransactional && !allow_non_transactional {
        return Ok(Response::err_with_details(
            "SCHEMA_MIGRATION_NON_TRANSACTIONAL_APPROVAL_REQUIRED",
            "This target-owned migration can partially commit and requires explicit non-transactional approval",
            false,
            Some(context),
        ));
    }

    let capability = manager
        .capability_snapshot(&expected_target.connection_id)
        .await
        .map_err(|error| error.to_string())?;
    let runtime_process_id = manager
        .external_runtime_process_id(&expected_target.connection_id)
        .await
        .map_err(|error| error.to_string())?;
    if capability.external_driver_id.is_none()
        || !capability.has_exact_semantic_schema_migration_evidence
        || capability.semantic_schema_migration_mode != Some(session.mode)
        || runtime_process_id != Some(session.runtime_process_id)
    {
        let _ = sessions.consume(&expected_plan_id);
        return Ok(Response::err_with_details(
            "SCHEMA_MIGRATION_RUNTIME_CHANGED",
            "The external driver process or its verified capability evidence changed; compare the snapshots again",
            true,
            Some(context),
        ));
    }

    let fresh_target = match capture_schema_snapshot_inner(
        manager,
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
    if fresh_target.fingerprint != expected_target_fingerprint {
        let _ = sessions.consume(&expected_plan_id);
        return Ok(Response::err_with_details(
            "SCHEMA_MIGRATION_STALE_TARGET",
            "The live target changed after this target-owned plan was created; compare fresh snapshots again",
            true,
            Some(context),
        ));
    }
    let session = sessions.consume(&expected_plan_id)?;
    let started_at = current_timestamp_millis();
    let mut journal = SchemaMigrationJournalEntry {
        id: format!("schema-migration-{started_at}-{}", uuid::Uuid::new_v4()),
        project_id: fresh_target.project_id.clone(),
        connection_id: fresh_target.connection_id.clone(),
        connection_name: fresh_target.connection_name.clone(),
        database_name: fresh_target.database_name.clone(),
        schema_name: fresh_target.schema_name.clone(),
        plan_id: expected_plan_id.clone(),
        source_fingerprint: source.fingerprint.clone(),
        target_fingerprint_before: fresh_target.fingerprint.clone(),
        status: SchemaMigrationStatus::Running,
        started_at,
        finished_at: None,
        statement_count: session.change_count as usize,
        committed_statements: 0,
        preflight_results: Vec::new(),
        rollback: SchemaRollbackArtifact {
            available: false,
            reason: Some(
                "Rollback is target-owned and was not returned as an executable Host artifact"
                    .to_string(),
            ),
            plan_id: None,
            change_count: 0,
            requires_manual_review: true,
            sql: None,
            backup_path: None,
            backup_byte_len: None,
            backup_integrity_check: None,
        },
        verification: None,
        error: None,
        warnings: vec![
            "Executed through the target-owned semantic migration protocol; no sidecar token or generated DDL was persisted."
                .to_string(),
        ],
    };
    if session.mode == SchemaMigrationMode::NonTransactional {
        journal.warnings.push(
            "The target driver declared non-transactional migration; partial apply is possible and post-apply verification is mandatory."
                .to_string(),
        );
    }
    let _active_journal = ActiveMigrationJournal::register(&journal.id);
    persist_journal_or_warn(meta_store, &mut journal).await;

    let preflight = match manager
        .preflight_schema_migration(
            &session.connection_id,
            DriverMigrationPreflightRequest {
                plan_token: session.plan_token.clone(),
                target_fingerprint: session.target_fingerprint.clone(),
            },
        )
        .await
    {
        Ok(result) if result.plan_id == session.sidecar_plan_id => result,
        Ok(_) => {
            journal.status = SchemaMigrationStatus::Failed;
            journal.error = Some("Target driver returned a mismatched preflight plan".to_string());
            journal.finished_at = Some(current_timestamp_millis());
            persist_journal_or_warn(meta_store, &mut journal).await;
            return Ok(Response::ok(journal));
        }
        Err(error) => {
            journal.status = SchemaMigrationStatus::Failed;
            journal.error = Some(format!("Target driver preflight failed: {error}"));
            journal.finished_at = Some(current_timestamp_millis());
            persist_journal_or_warn(meta_store, &mut journal).await;
            return Ok(Response::ok(journal));
        }
    };
    journal.preflight_results = external_preflight_results(&preflight);
    if !preflight.ready
        || journal
            .preflight_results
            .iter()
            .any(|check| check.blocks_execution)
    {
        journal.status = SchemaMigrationStatus::Blocked;
        journal.error = Some("Target driver preflight blocked migration execution".to_string());
        journal.finished_at = Some(current_timestamp_millis());
        persist_journal_or_warn(meta_store, &mut journal).await;
        return Ok(Response::ok(journal));
    }
    persist_journal_or_warn(meta_store, &mut journal).await;

    let applied = match manager
        .apply_schema_migration(
            &session.connection_id,
            DriverMigrationApplyRequest {
                plan_token: session.plan_token.clone(),
                preflight_token: preflight.preflight_token,
                target_fingerprint: session.target_fingerprint.clone(),
                allow_review,
                allow_destructive,
                allow_non_transactional,
            },
        )
        .await
    {
        Ok(result) if result.plan_id == session.sidecar_plan_id => result,
        Ok(_) => {
            journal.status = SchemaMigrationStatus::Failed;
            journal.error = Some("Target driver returned a mismatched apply plan".to_string());
            attach_host_recapture_after_external_failure(
                manager,
                &source,
                &expected_target,
                &expected_plan_id,
                &mut journal,
            )
            .await;
            journal.finished_at = Some(current_timestamp_millis());
            persist_journal_or_warn(meta_store, &mut journal).await;
            return Ok(Response::ok(journal));
        }
        Err(error) => {
            journal.status = SchemaMigrationStatus::Failed;
            journal.error = Some(format!("Target driver migration apply failed: {error}"));
            attach_host_recapture_after_external_failure(
                manager,
                &source,
                &expected_target,
                &expected_plan_id,
                &mut journal,
            )
            .await;
            journal.finished_at = Some(current_timestamp_millis());
            persist_journal_or_warn(meta_store, &mut journal).await;
            return Ok(Response::ok(journal));
        }
    };
    journal.committed_statements = applied.committed_change_count as usize;
    journal.warnings.extend(applied.warnings.clone());
    let incomplete_apply = applied.status == DriverMigrationApplyStatus::PartiallyApplied
        || applied.committed_change_count != session.change_count;
    if incomplete_apply {
        journal.warnings.push(
            "The target driver reported a partial or count-mismatched apply; verification failure is forced even if the remaining snapshot appears equal."
                .to_string(),
        );
    }
    persist_journal_or_warn(meta_store, &mut journal).await;

    let verified = match manager
        .verify_schema_migration(
            &session.connection_id,
            DriverMigrationVerifyRequest {
                plan_token: session.plan_token,
                apply_token: applied.apply_token,
                expected_source_fingerprint: source.fingerprint.clone(),
            },
        )
        .await
    {
        Ok(result) if result.plan_id == session.sidecar_plan_id => result,
        Ok(_) => {
            journal.status = SchemaMigrationStatus::VerificationFailed;
            journal.error =
                Some("Target driver returned a mismatched verification plan".to_string());
            attach_host_recapture_after_external_failure(
                manager,
                &source,
                &expected_target,
                &expected_plan_id,
                &mut journal,
            )
            .await;
            journal.finished_at = Some(current_timestamp_millis());
            persist_journal_or_warn(meta_store, &mut journal).await;
            return Ok(Response::ok(journal));
        }
        Err(error) => {
            journal.status = SchemaMigrationStatus::VerificationFailed;
            journal.error = Some(format!("Target driver verification failed: {error}"));
            attach_host_recapture_after_external_failure(
                manager,
                &source,
                &expected_target,
                &expected_plan_id,
                &mut journal,
            )
            .await;
            journal.finished_at = Some(current_timestamp_millis());
            persist_journal_or_warn(meta_store, &mut journal).await;
            return Ok(Response::ok(journal));
        }
    };
    journal.warnings.extend(verified.warnings.clone());
    let after = capture_schema_snapshot_inner(
        manager,
        source.project_id.clone(),
        expected_target.connection_id.clone(),
        expected_target.connection_name.clone(),
        expected_target.driver.clone(),
        expected_target.database_name.clone(),
        expected_target.schema_name.clone(),
        false,
    )
    .await;
    let host_matches_source = after
        .as_ref()
        .is_ok_and(|snapshot| snapshot.fingerprint == source.fingerprint);
    let matches_source = !incomplete_apply
        && verified.matches_source
        && verified.remaining_change_count == 0
        && verified.target_fingerprint_after == source.fingerprint
        && host_matches_source;
    if let Err(error) = &after {
        journal.warnings.push(format!(
            "Host schema recapture failed after target-owned apply: {error}"
        ));
    }
    let verification_total =
        (verified.remaining_change_count as usize).max(usize::from(!matches_source));
    journal.verification = Some(SchemaMigrationVerification {
        matches_source,
        target_fingerprint_after: after
            .as_ref()
            .map(|snapshot| snapshot.fingerprint.clone())
            .unwrap_or_else(|_| verified.target_fingerprint_after.clone()),
        remaining_plan_id: expected_plan_id,
        remaining_summary: SchemaDiffSummary {
            total: verification_total,
            safe: 0,
            review: verification_total,
            destructive: 0,
            blocked: usize::from(!matches_source),
        },
        warnings: verified.warnings,
    });
    journal.finished_at = Some(current_timestamp_millis());
    if matches_source {
        journal.status = SchemaMigrationStatus::Succeeded;
    } else {
        journal.status = SchemaMigrationStatus::VerificationFailed;
        journal.error = Some(
            "Post-apply verification did not match the approved source snapshot; capture and review the live schema before another migration"
                .to_string(),
        );
    }
    persist_journal_or_warn(meta_store, &mut journal).await;
    Ok(Response::ok(journal))
}
