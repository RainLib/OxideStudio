use crate::core::{
    dialect::DatabaseKind,
    manager::ConnectionManager,
    protocol::{ParameterizedStatement, QueryResult, Response},
    schema_diff::{
        compare_schema_snapshots as build_schema_diff, finalize_schema_snapshot, SchemaChangeRisk,
        SchemaDiffPlan, SchemaDiffSummary, SchemaPreflightAssertion, SchemaPreflightCheck,
        SchemaRelationSnapshot, SchemaSnapshot, SCHEMA_SNAPSHOT_VERSION,
    },
    store::{MetaStore, Resource},
};
use serde::{Deserialize, Serialize};
use std::{str::FromStr, sync::Arc, time::SystemTime};
use tauri::State;
use tokio::{sync::Semaphore, task::JoinSet};

const SNAPSHOT_METADATA_CONCURRENCY: usize = 6;
const MIGRATION_JOURNAL_PARENT_ID: &str = "schema-migration-journal-v1";
const MIGRATION_JOURNAL_KIND: &str = "SCHEMA_MIGRATION_JOURNAL";

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
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SchemaMigrationStatus {
    Running,
    Blocked,
    Failed,
    VerificationFailed,
    Succeeded,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SchemaMigrationPreflightStatus {
    Passed,
    Warning,
    Blocked,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaMigrationPreflightResult {
    pub check_id: String,
    pub change_id: String,
    pub label: String,
    pub expectation: String,
    pub status: SchemaMigrationPreflightStatus,
    pub observed: String,
    pub blocks_execution: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaRollbackArtifact {
    pub available: bool,
    pub reason: Option<String>,
    pub plan_id: Option<String>,
    pub change_count: usize,
    pub requires_manual_review: bool,
    pub sql: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaMigrationVerification {
    pub matches_source: bool,
    pub target_fingerprint_after: String,
    pub remaining_plan_id: String,
    pub remaining_summary: SchemaDiffSummary,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaMigrationJournalEntry {
    pub id: String,
    pub project_id: String,
    pub connection_id: String,
    pub connection_name: String,
    pub database_name: Option<String>,
    pub schema_name: String,
    pub plan_id: String,
    pub source_fingerprint: String,
    pub target_fingerprint_before: String,
    pub status: SchemaMigrationStatus,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub statement_count: usize,
    pub committed_statements: usize,
    pub preflight_results: Vec<SchemaMigrationPreflightResult>,
    pub rollback: SchemaRollbackArtifact,
    pub verification: Option<SchemaMigrationVerification>,
    pub error: Option<String>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn capture_schema_snapshot(
    manager: State<'_, ConnectionManager>,
    project_id: String,
    connection_id: String,
    connection_name: String,
    driver: String,
    database: Option<String>,
    schema: String,
) -> Result<Response<SchemaSnapshot>, String> {
    let context = serde_json::json!({
        "projectId": project_id,
        "connectionId": connection_id,
        "driver": driver,
        "database": database,
        "schema": schema,
    });
    let result = capture_schema_snapshot_inner(
        manager.inner(),
        project_id,
        connection_id,
        connection_name,
        driver,
        database,
        schema,
    )
    .await;

    match result {
        Ok(snapshot) => Ok(Response::ok(snapshot)),
        Err(error) => Ok(Response::err_with_details(
            "SCHEMA_SNAPSHOT_CAPTURE_FAILED",
            &error,
            true,
            Some(context),
        )),
    }
}

#[allow(clippy::too_many_arguments)]
async fn capture_schema_snapshot_inner(
    manager: &ConnectionManager,
    project_id: String,
    connection_id: String,
    connection_name: String,
    driver: String,
    database: Option<String>,
    schema: String,
) -> Result<SchemaSnapshot, String> {
    let kind = DatabaseKind::from_str(&driver).map_err(|error| error.to_string())?;
    if !kind.capabilities().supports_table_browsing {
        return Err(format!(
            "{} does not expose relational schema snapshots",
            kind.display_name()
        ));
    }
    let schema = schema.trim();
    if schema.is_empty() {
        return Err("Schema name is required".to_string());
    }
    let database = database.as_deref();
    let tables = match database {
        Some(database) => {
            manager
                .get_database_tables(&connection_id, database, schema)
                .await
        }
        None => manager.get_tables(&connection_id, schema).await,
    }
    .map_err(|error| error.to_string())?;

    let manager = manager.clone();
    let concurrency = Arc::new(Semaphore::new(SNAPSHOT_METADATA_CONCURRENCY));
    let mut captures = JoinSet::new();
    for table in tables {
        let manager = manager.clone();
        let concurrency = Arc::clone(&concurrency);
        let connection_id = connection_id.clone();
        let database = database.map(ToString::to_string);
        let schema = schema.to_string();
        let relation_name = table.name;
        let object_type = table.table_type;
        captures.spawn(async move {
            let _permit = concurrency
                .acquire_owned()
                .await
                .map_err(|_| "Schema snapshot concurrency gate closed".to_string())?;
            let metadata = match database.as_deref() {
                Some(database) => tokio::try_join!(
                    manager.get_database_columns(&connection_id, database, &schema, &relation_name),
                    manager.get_database_indexes(&connection_id, database, &schema, &relation_name),
                    manager.get_database_constraints(
                        &connection_id,
                        database,
                        &schema,
                        &relation_name
                    ),
                ),
                None => tokio::try_join!(
                    manager.get_columns(&connection_id, &schema, &relation_name),
                    manager.get_indexes(&connection_id, &schema, &relation_name),
                    manager.get_constraints(&connection_id, &schema, &relation_name),
                ),
            }
            .map_err(|error| {
                format!("Failed to capture metadata for {schema}.{relation_name}: {error}")
            })?;

            Ok::<_, String>(SchemaRelationSnapshot {
                name: relation_name,
                object_type,
                columns: metadata.0,
                indexes: metadata.1,
                constraints: metadata.2,
            })
        });
    }

    let mut relations = Vec::with_capacity(captures.len());
    while let Some(capture) = captures.join_next().await {
        match capture {
            Ok(Ok(relation)) => relations.push(relation),
            Ok(Err(error)) => {
                captures.abort_all();
                return Err(error);
            }
            Err(error) => {
                captures.abort_all();
                return Err(format!("Schema snapshot task failed: {error}"));
            }
        }
    }

    finalize_schema_snapshot(SchemaSnapshot {
        version: SCHEMA_SNAPSHOT_VERSION,
        id: String::new(),
        fingerprint: String::new(),
        project_id,
        connection_id,
        connection_name,
        driver: kind.as_str().to_string(),
        database_name: database.map(ToString::to_string),
        schema_name: schema.to_string(),
        captured_at: current_timestamp_millis(),
        relations,
        warnings: Vec::new(),
    })
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn compare_schema_snapshots(
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
    match build_schema_diff(&source, &target, current_timestamp_millis()) {
        Ok(plan) => Ok(Response::ok(plan)),
        Err(error) => Ok(Response::err_with_details(
            "SCHEMA_SNAPSHOT_COMPARE_FAILED",
            &error.to_string(),
            false,
            Some(context),
        )),
    }
}

#[tauri::command]
pub async fn execute_schema_migration(
    manager: State<'_, ConnectionManager>,
    meta_store: State<'_, MetaStore>,
    request: ExecuteSchemaMigrationRequest,
) -> Result<Response<SchemaMigrationJournalEntry>, String> {
    let context = serde_json::json!({
        "projectId": request.expected_target.project_id,
        "connectionId": request.expected_target.connection_id,
        "database": request.expected_target.database_name,
        "schema": request.expected_target.schema_name,
        "expectedPlanId": request.expected_plan_id,
    });

    let source = match verify_snapshot_integrity(request.source) {
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
    if approved_plan.driver != DatabaseKind::Postgres.as_str() {
        return Ok(Response::err_with_details(
            "SCHEMA_MIGRATION_UNSAFE_DRIVER",
            "Automatic migration apply is limited to PostgreSQL because MySQL DDL can auto-commit; open the reviewed SQL in a console instead",
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

    let post_target = match capture_schema_snapshot_inner(
        manager.inner(),
        fresh_target.project_id.clone(),
        fresh_target.connection_id.clone(),
        fresh_target.connection_name.clone(),
        fresh_target.driver.clone(),
        fresh_target.database_name.clone(),
        fresh_target.schema_name.clone(),
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
    entries.sort_by(|left, right| right.started_at.cmp(&left.started_at));
    entries.truncate(limit.unwrap_or(20).clamp(1, 100));
    Ok(Response::ok(entries))
}

fn verify_snapshot_integrity(snapshot: SchemaSnapshot) -> Result<SchemaSnapshot, String> {
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

fn migration_confirmation_target(snapshot: &SchemaSnapshot) -> String {
    match snapshot.database_name.as_deref() {
        Some(database) => format!(
            "{} / {} / {}",
            snapshot.connection_name, database, snapshot.schema_name
        ),
        None => format!("{} / {}", snapshot.connection_name, snapshot.schema_name),
    }
}

async fn run_preflight_check(
    manager: &ConnectionManager,
    target: &SchemaSnapshot,
    check: &SchemaPreflightCheck,
) -> SchemaMigrationPreflightResult {
    let query_result = match target.database_name.as_deref() {
        Some(database) => {
            manager
                .query_database_with_context(
                    &target.connection_id,
                    database,
                    &check.sql,
                    Some(&target.schema_name),
                    None,
                )
                .await
        }
        None => {
            manager
                .query(
                    &target.connection_id,
                    &check.sql,
                    Some(target.schema_name.clone()),
                    None,
                    None,
                )
                .await
        }
    };
    match query_result {
        Ok(results) => evaluate_preflight_result(check, &results),
        Err(error) => SchemaMigrationPreflightResult {
            check_id: check.id.clone(),
            change_id: check.change_id.clone(),
            label: check.label.clone(),
            expectation: check.expectation.clone(),
            status: SchemaMigrationPreflightStatus::Error,
            observed: "Query failed".to_string(),
            blocks_execution: true,
            error: Some(error.to_string()),
        },
    }
}

fn evaluate_preflight_result(
    check: &SchemaPreflightCheck,
    results: &[QueryResult],
) -> SchemaMigrationPreflightResult {
    let result = results.first();
    let evaluation = match check.assertion {
        SchemaPreflightAssertion::EmptyRows => result
            .map(|result| {
                let row_count = result.rows.len();
                (
                    if row_count == 0 {
                        SchemaMigrationPreflightStatus::Passed
                    } else {
                        SchemaMigrationPreflightStatus::Blocked
                    },
                    format!("{row_count} blocking row(s) returned"),
                    row_count > 0,
                )
            })
            .ok_or_else(|| "Preflight returned no result set".to_string()),
        SchemaPreflightAssertion::ZeroValue | SchemaPreflightAssertion::Advisory => {
            preflight_numeric_observation(check, result).map(|value| {
                let non_zero = value != 0.0;
                let status = match check.assertion {
                    SchemaPreflightAssertion::ZeroValue if non_zero => {
                        SchemaMigrationPreflightStatus::Blocked
                    }
                    SchemaPreflightAssertion::Advisory if non_zero => {
                        SchemaMigrationPreflightStatus::Warning
                    }
                    _ => SchemaMigrationPreflightStatus::Passed,
                };
                (
                    status,
                    format_number_observation(value, check.result_column.as_deref()),
                    check.assertion == SchemaPreflightAssertion::ZeroValue && non_zero,
                )
            })
        }
    };

    match evaluation {
        Ok((status, observed, blocks_execution)) => SchemaMigrationPreflightResult {
            check_id: check.id.clone(),
            change_id: check.change_id.clone(),
            label: check.label.clone(),
            expectation: check.expectation.clone(),
            status,
            observed,
            blocks_execution,
            error: None,
        },
        Err(error) => SchemaMigrationPreflightResult {
            check_id: check.id.clone(),
            change_id: check.change_id.clone(),
            label: check.label.clone(),
            expectation: check.expectation.clone(),
            status: SchemaMigrationPreflightStatus::Error,
            observed: "Unexpected result shape".to_string(),
            blocks_execution: true,
            error: Some(error),
        },
    }
}

fn preflight_numeric_observation(
    check: &SchemaPreflightCheck,
    result: Option<&QueryResult>,
) -> Result<f64, String> {
    let result = result.ok_or_else(|| "Preflight returned no result set".to_string())?;
    let column_name = check
        .result_column
        .as_deref()
        .ok_or_else(|| "Preflight numeric result column is not declared".to_string())?;
    let column_index = result
        .columns
        .iter()
        .position(|column| column.name.eq_ignore_ascii_case(column_name))
        .ok_or_else(|| format!("Preflight result did not include {column_name}"))?;
    let value = result
        .rows
        .first()
        .and_then(|row| row.get(column_index))
        .ok_or_else(|| format!("Preflight result did not return a value for {column_name}"))?;
    json_number(value).ok_or_else(|| format!("Preflight result {column_name} was not numeric"))
}

fn json_number(value: &serde_json::Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|value| value.parse::<f64>().ok()))
}

fn format_number_observation(value: f64, column: Option<&str>) -> String {
    let value = if value.fract() == 0.0 {
        format!("{value:.0}")
    } else {
        value.to_string()
    };
    match column {
        Some(column) => format!("{column} = {value}"),
        None => value,
    }
}

fn build_rollback_artifact(
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
    }
}

async fn persist_journal_or_warn(
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

fn current_timestamp_millis() -> i64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::protocol::ColumnDef;

    fn check(assertion: SchemaPreflightAssertion, column: Option<&str>) -> SchemaPreflightCheck {
        SchemaPreflightCheck {
            id: "check-1".to_string(),
            change_id: "change-1".to_string(),
            label: "Check live rows".to_string(),
            sql: "SELECT 0 AS blocking_rows".to_string(),
            expectation: "No blocking rows".to_string(),
            assertion,
            result_column: column.map(ToString::to_string),
        }
    }

    fn numeric_result(value: serde_json::Value) -> QueryResult {
        QueryResult::rows(
            vec![ColumnDef {
                name: "blocking_rows".to_string(),
                data_type: "int8".to_string(),
            }],
            vec![vec![value]],
        )
    }

    #[test]
    fn zero_value_preflight_passes_zero_and_blocks_non_zero() {
        let check = check(SchemaPreflightAssertion::ZeroValue, Some("blocking_rows"));

        let passed = evaluate_preflight_result(&check, &[numeric_result(0.into())]);
        let blocked = evaluate_preflight_result(&check, &[numeric_result("3".into())]);

        assert_eq!(passed.status, SchemaMigrationPreflightStatus::Passed);
        assert!(!passed.blocks_execution);
        assert_eq!(blocked.status, SchemaMigrationPreflightStatus::Blocked);
        assert!(blocked.blocks_execution);
        assert_eq!(blocked.observed, "blocking_rows = 3");
    }

    #[test]
    fn empty_rows_preflight_never_persists_returned_values() {
        let check = check(SchemaPreflightAssertion::EmptyRows, None);
        let result = QueryResult::rows(
            vec![ColumnDef {
                name: "email".to_string(),
                data_type: "text".to_string(),
            }],
            vec![vec!["private@example.com".into()]],
        );

        let evaluated = evaluate_preflight_result(&check, &[result]);

        assert_eq!(evaluated.status, SchemaMigrationPreflightStatus::Blocked);
        assert!(evaluated.blocks_execution);
        assert_eq!(evaluated.observed, "1 blocking row(s) returned");
        assert!(!evaluated.observed.contains("private@example.com"));
    }

    #[test]
    fn unexpected_preflight_shape_fails_closed() {
        let check = check(SchemaPreflightAssertion::ZeroValue, Some("blocking_rows"));
        let result = QueryResult::rows(Vec::new(), vec![Vec::new()]);

        let evaluated = evaluate_preflight_result(&check, &[result]);

        assert_eq!(evaluated.status, SchemaMigrationPreflightStatus::Error);
        assert!(evaluated.blocks_execution);
        assert!(evaluated.error.is_some());
    }

    #[test]
    fn confirmation_phrase_binds_connection_database_and_schema() {
        let snapshot = SchemaSnapshot {
            version: SCHEMA_SNAPSHOT_VERSION,
            id: "snapshot-1".to_string(),
            fingerprint: "fingerprint".to_string(),
            project_id: "project-1".to_string(),
            connection_id: "connection-1".to_string(),
            connection_name: "Production".to_string(),
            driver: "postgres".to_string(),
            database_name: Some("app".to_string()),
            schema_name: "public".to_string(),
            captured_at: 1,
            relations: Vec::new(),
            warnings: Vec::new(),
        };

        assert_eq!(
            migration_confirmation_target(&snapshot),
            "Production / app / public"
        );
    }
}
