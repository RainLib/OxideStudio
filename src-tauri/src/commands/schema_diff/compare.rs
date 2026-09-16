use super::constants::EXTERNAL_MIGRATION_SESSION_TTL;
use super::external_plan::{external_driver_plan, external_review_only_plan};
use super::journal::verify_snapshot_integrity;
use super::semantic::semantic_schema_snapshot;
use super::session::{ExternalSchemaMigrationSession, ExternalSchemaMigrationSessionState};
use super::timestamp::current_timestamp_millis;
use crate::core::manager::ConnectionManager;
use crate::core::protocol::Response;
use crate::core::schema_diff::compare_schema_snapshots as build_schema_diff;
use crate::core::schema_diff::{SchemaDiffPlan, SchemaSnapshot};
use oxide_driver_protocol::SchemaMigrationPlanRequest as DriverMigrationPlanRequest;
use std::time::Instant;
use tauri::State;

#[tauri::command]
pub async fn compare_schema_snapshots(
    manager: State<'_, ConnectionManager>,
    sessions: State<'_, ExternalSchemaMigrationSessionState>,
    source: SchemaSnapshot,
    target: SchemaSnapshot,
) -> Result<Response<SchemaDiffPlan>, String> {
    let context = serde_json::json!({
        "sourceSnapshotId": source.id,
        "targetSnapshotId": target.id,
        "targetConnectionId": target.connection_id,
        "targetDatabase": target.database_name,
        "targetSchema": target.schema_name,
    });
    let generated_at = current_timestamp_millis();
    let capability = manager
        .capability_snapshot(&target.connection_id)
        .await
        .ok();
    let is_external = capability
        .as_ref()
        .is_some_and(|capability| capability.external_driver_id.is_some());
    if is_external {
        let capability = capability.expect("external capability snapshot exists");
        let Some(mode) = capability.semantic_schema_migration_mode else {
            return match build_schema_diff(&source, &target, generated_at) {
                Ok(plan) => Ok(Response::ok(external_review_only_plan(plan))),
                Err(error) => Ok(Response::err_with_details(
                    "SCHEMA_SNAPSHOT_COMPARE_FAILED",
                    &error.to_string(),
                    false,
                    Some(context),
                )),
            };
        };
        if !capability.has_exact_semantic_schema_migration_evidence {
            return match build_schema_diff(&source, &target, generated_at) {
                Ok(plan) => Ok(Response::ok(external_review_only_plan(plan))),
                Err(error) => Ok(Response::err_with_details(
                    "SCHEMA_SNAPSHOT_COMPARE_FAILED",
                    &error.to_string(),
                    false,
                    Some(context),
                )),
            };
        }
        let source = match verify_snapshot_integrity(source) {
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
        let target = match verify_snapshot_integrity(target) {
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
        let result = match manager
            .plan_schema_migration(
                &target.connection_id,
                DriverMigrationPlanRequest {
                    source: semantic_schema_snapshot(&source),
                    target: semantic_schema_snapshot(&target),
                },
            )
            .await
        {
            Ok(result) => result,
            Err(error) => {
                return Ok(Response::err_with_details(
                    "SCHEMA_MIGRATION_EXTERNAL_PLAN_FAILED",
                    &error.to_string(),
                    true,
                    Some(context),
                ));
            }
        };
        let host_plan_id = format!("schema-driver-plan-{}", uuid::Uuid::new_v4());
        let runtime_process_id = manager
            .external_runtime_process_id(&target.connection_id)
            .await
            .ok()
            .flatten();
        let Some(runtime_process_id) = runtime_process_id else {
            return Ok(Response::err_with_details(
                "SCHEMA_MIGRATION_RUNTIME_UNAVAILABLE",
                "The external driver process identity is unavailable; reconnect before planning a migration",
                true,
                Some(context),
            ));
        };
        if let Err(error) = sessions.insert(ExternalSchemaMigrationSession {
            host_plan_id: host_plan_id.clone(),
            sidecar_plan_id: result.plan_id.clone(),
            plan_token: result.plan_token.clone(),
            connection_id: target.connection_id.clone(),
            runtime_process_id,
            source_fingerprint: source.fingerprint.clone(),
            target_fingerprint: target.fingerprint.clone(),
            mode,
            change_count: result.change_count,
            blocked_change_count: result.blocked_change_count,
            requires_review: result.requires_review,
            requires_destructive: result.requires_destructive,
            expires_at: Instant::now() + EXTERNAL_MIGRATION_SESSION_TTL,
        }) {
            return Ok(Response::err_with_details(
                "SCHEMA_MIGRATION_SESSION_FAILED",
                &error,
                true,
                Some(context),
            ));
        }
        return Ok(Response::ok(external_driver_plan(
            &source,
            &target,
            host_plan_id,
            generated_at,
            &result,
        )));
    }

    match build_schema_diff(&source, &target, generated_at) {
        Ok(plan) => Ok(Response::ok(plan)),
        Err(error) => Ok(Response::err_with_details(
            "SCHEMA_SNAPSHOT_COMPARE_FAILED",
            &error.to_string(),
            false,
            Some(context),
        )),
    }
}
