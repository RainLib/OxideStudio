use crate::core::{
    dialect::{database_spec_for_driver, DatabaseKind},
    manager::ConnectionManager,
    protocol::{ParameterizedStatement, QueryResult, Response},
    schema_diff::{
        compare_schema_snapshots as build_schema_diff, finalize_schema_snapshot, SchemaChange,
        SchemaChangeKind, SchemaChangePhase, SchemaChangeRisk, SchemaDiffExecutionOwner,
        SchemaDiffPlan, SchemaDiffSummary, SchemaObjectSnapshot, SchemaPreflightAssertion,
        SchemaPreflightCheck, SchemaRelationSnapshot, SchemaRoutineSnapshot, SchemaSnapshot,
        SCHEMA_SNAPSHOT_VERSION,
    },
    store::{MetaStore, Resource},
};
use oxide_driver_protocol::{
    SchemaMigrationApplyRequest as DriverMigrationApplyRequest,
    SchemaMigrationApplyStatus as DriverMigrationApplyStatus, SchemaMigrationMode,
    SchemaMigrationPlanRequest as DriverMigrationPlanRequest,
    SchemaMigrationPlanResult as DriverMigrationPlanResult,
    SchemaMigrationPreflightRequest as DriverMigrationPreflightRequest,
    SchemaMigrationVerifyRequest as DriverMigrationVerifyRequest, SemanticSchemaSnapshot,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    str::FromStr,
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant, SystemTime},
};
use tauri::State;
use tokio::{sync::Semaphore, task::JoinSet};

const SNAPSHOT_METADATA_CONCURRENCY: usize = 6;
const MIGRATION_JOURNAL_PARENT_ID: &str = "schema-migration-journal-v1";
const MIGRATION_JOURNAL_KIND: &str = "SCHEMA_MIGRATION_JOURNAL";
const OFFLINE_PROJECT_DDL_REVIEW_WARNING: &str = "OFFLINE_PROJECT_DDL_REVIEW_ONLY";
const OFFLINE_DBML_REVIEW_WARNING: &str = "OFFLINE_DBML_REVIEW_ONLY";
const OFFLINE_METADATA_REVIEW_WARNING: &str = "OFFLINE_METADATA_JSON_REVIEW_ONLY";
const OFFLINE_DIAGRAM_DRAFT_REVIEW_WARNING: &str = "OFFLINE_DIAGRAM_DRAFT_REVIEW_ONLY";
const OFFLINE_REVIEW_WARNINGS: [&str; 4] = [
    OFFLINE_PROJECT_DDL_REVIEW_WARNING,
    OFFLINE_DBML_REVIEW_WARNING,
    OFFLINE_METADATA_REVIEW_WARNING,
    OFFLINE_DIAGRAM_DRAFT_REVIEW_WARNING,
];
const EXTERNAL_MIGRATION_SESSION_TTL: Duration = Duration::from_secs(15 * 60);
const MAX_EXTERNAL_MIGRATION_SESSIONS: usize = 64;
static ACTIVE_MIGRATION_JOURNALS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

#[derive(Default)]
pub struct ExternalSchemaMigrationSessionState {
    sessions: Mutex<HashMap<String, ExternalSchemaMigrationSession>>,
}

#[derive(Clone)]
struct ExternalSchemaMigrationSession {
    host_plan_id: String,
    sidecar_plan_id: String,
    plan_token: String,
    connection_id: String,
    runtime_process_id: u32,
    source_fingerprint: String,
    target_fingerprint: String,
    mode: SchemaMigrationMode,
    change_count: u32,
    blocked_change_count: u32,
    requires_review: bool,
    requires_destructive: bool,
    expires_at: Instant,
}

impl ExternalSchemaMigrationSessionState {
    fn insert(&self, session: ExternalSchemaMigrationSession) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "Schema migration session store is unavailable".to_string())?;
        let now = Instant::now();
        sessions.retain(|_, candidate| candidate.expires_at > now);
        if sessions.len() >= MAX_EXTERNAL_MIGRATION_SESSIONS {
            let oldest = sessions
                .iter()
                .min_by_key(|(_, candidate)| candidate.expires_at)
                .map(|(id, _)| id.clone());
            if let Some(oldest) = oldest {
                sessions.remove(&oldest);
            }
        }
        sessions.insert(session.host_plan_id.clone(), session);
        Ok(())
    }

    fn get(&self, plan_id: &str) -> Result<ExternalSchemaMigrationSession, String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "Schema migration session store is unavailable".to_string())?;
        let now = Instant::now();
        sessions.retain(|_, candidate| candidate.expires_at > now);
        sessions
            .get(plan_id)
            .cloned()
            .ok_or_else(|| {
                "The target-owned migration session expired or belongs to another application process; compare the snapshots again"
                    .to_string()
            })
    }

    fn consume(&self, plan_id: &str) -> Result<ExternalSchemaMigrationSession, String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "Schema migration session store is unavailable".to_string())?;
        sessions.remove(plan_id).ok_or_else(|| {
            "The target-owned migration session was already consumed; compare the snapshots again"
                .to_string()
        })
    }
}

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

struct ActiveMigrationJournal {
    id: String,
}

impl ActiveMigrationJournal {
    fn register(id: &str) -> Self {
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

fn migration_is_active(id: &str) -> bool {
    ACTIVE_MIGRATION_JOURNALS
        .get()
        .and_then(|journals| journals.lock().ok().map(|journals| journals.contains(id)))
        .unwrap_or(false)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SchemaMigrationExecutionMode {
    Transactional,
    NonTransactional,
}

fn schema_migration_execution_mode(driver: &str) -> Option<SchemaMigrationExecutionMode> {
    // Resolve aliases through the same dialect registry that generated the
    // migration plan. This keeps MariaDB and future PostgreSQL/MySQL family
    // aliases from silently losing their explicit transaction semantics.
    match DatabaseKind::from_str(driver).ok()? {
        DatabaseKind::Postgres => Some(SchemaMigrationExecutionMode::Transactional),
        // MySQL DDL may commit implicitly. It is still useful to apply a
        // reviewed plan, but it must run in an explicit statement-by-statement
        // mode with a persistent progress journal.
        DatabaseKind::Mysql => Some(SchemaMigrationExecutionMode::NonTransactional),
    }
}

fn ensure_host_schema_migration_capability(
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

async fn ensure_host_schema_migration_allowed(
    manager: &ConnectionManager,
    connection_id: &str,
) -> Result<(), String> {
    let capabilities = manager
        .package_capabilities(connection_id)
        .await
        .map_err(|error| error.to_string())?;
    ensure_host_schema_migration_capability(capabilities.as_ref())
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
    let capabilities = manager
        .package_capabilities(&connection_id)
        .await
        .map_err(|error| error.to_string())?
        .or_else(|| database_spec_for_driver(&driver).map(|spec| spec.capabilities()))
        .ok_or_else(|| {
            format!(
                "{} does not declare a signed schema snapshot capability contract",
                driver.trim()
            )
        })?;
    if !capabilities.supports_table_browsing && !capabilities.supports_collection_browsing {
        return Err(format!(
            "{} does not expose schema or collection snapshots",
            capabilities.display_name
        ));
    }
    let schema = schema.trim();
    if schema.is_empty() {
        return Err("Schema name is required".to_string());
    }
    let database = database.as_deref();
    let objects: Vec<(String, Option<String>)> = if capabilities.supports_table_browsing {
        match database {
            Some(database) => {
                manager
                    .get_database_tables(&connection_id, database, schema)
                    .await
            }
            None => manager.get_tables(&connection_id, schema).await,
        }
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|table| (table.name, table.table_type))
        .collect()
    } else {
        manager
            .get_collections(&connection_id, schema)
            .await
            .map_err(|error| error.to_string())?
            .into_iter()
            .map(|collection| (collection.name, collection.collection_type))
            .collect()
    };

    let manager = manager.clone();
    let concurrency = Arc::new(Semaphore::new(SNAPSHOT_METADATA_CONCURRENCY));
    let mut captures = JoinSet::new();
    for (relation_name, object_type) in objects {
        let manager = manager.clone();
        let concurrency = Arc::clone(&concurrency);
        let connection_id = connection_id.clone();
        let database = database.map(ToString::to_string);
        let schema = schema.to_string();
        let supports_indexes = capabilities.supports_table_indexes;
        let supports_constraints = capabilities.supports_table_constraints;
        let database_scoped = capabilities.supports_table_browsing && database.is_some();
        captures.spawn(async move {
            let _permit = concurrency
                .acquire_owned()
                .await
                .map_err(|_| "Schema snapshot concurrency gate closed".to_string())?;
            let columns = async {
                match (database_scoped, database.as_deref()) {
                    (true, Some(database)) => {
                        manager
                            .get_database_columns(&connection_id, database, &schema, &relation_name)
                            .await
                    }
                    _ => {
                        manager
                            .get_columns(&connection_id, &schema, &relation_name)
                            .await
                    }
                }
            };
            let indexes = async {
                if !supports_indexes {
                    return Ok(Vec::new());
                }
                match (database_scoped, database.as_deref()) {
                    (true, Some(database)) => {
                        manager
                            .get_database_indexes(&connection_id, database, &schema, &relation_name)
                            .await
                    }
                    _ => {
                        manager
                            .get_indexes(&connection_id, &schema, &relation_name)
                            .await
                    }
                }
            };
            let constraints = async {
                if !supports_constraints {
                    return Ok(Vec::new());
                }
                match (database_scoped, database.as_deref()) {
                    (true, Some(database)) => {
                        manager
                            .get_database_constraints(
                                &connection_id,
                                database,
                                &schema,
                                &relation_name,
                            )
                            .await
                    }
                    _ => {
                        manager
                            .get_constraints(&connection_id, &schema, &relation_name)
                            .await
                    }
                }
            };
            let metadata = tokio::try_join!(columns, indexes, constraints).map_err(|error| {
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

    // Capture only review-safe routine signatures. Definitions/bodies are not
    // requested because they are dialect-specific and may contain sensitive
    // implementation details; the diff planner deliberately never emits DDL
    // from these records.
    let routines = if capabilities.supports_functions {
        let functions = match (capabilities.supports_table_browsing, database) {
            (true, Some(database)) => {
                manager
                    .get_database_functions(&connection_id, database, schema)
                    .await
            }
            _ => manager.get_functions(&connection_id, schema).await,
        }
        .map_err(|error| format!("Failed to capture routines for {schema}: {error}"))?;
        functions
            .into_iter()
            .map(SchemaRoutineSnapshot::from)
            .collect()
    } else {
        Vec::new()
    };

    // Descriptor discovery is deliberately best-effort. A role that can read
    // relations may still lack catalog visibility for extensions, triggers or
    // types; that must not make an otherwise usable snapshot fail. The warning
    // binds this incomplete coverage to the snapshot review record.
    let mut warnings = Vec::new();
    let schema_objects = if capabilities.supports_table_browsing {
        let result = match database {
            Some(database) => {
                manager
                    .get_database_schema_objects(&connection_id, database, schema)
                    .await
            }
            None => manager.get_schema_objects(&connection_id, schema).await,
        };
        match result {
            Ok(objects) => objects
                .into_iter()
                .map(SchemaObjectSnapshot::from)
                .collect(),
            Err(_) => {
                warnings.push(
                    "Schema object descriptors were unavailable for this server role; snapshot comparison excludes those objects."
                        .to_string(),
                );
                Vec::new()
            }
        }
    } else {
        Vec::new()
    };

    finalize_schema_snapshot(SchemaSnapshot {
        version: SCHEMA_SNAPSHOT_VERSION,
        id: String::new(),
        fingerprint: String::new(),
        project_id,
        connection_id,
        connection_name,
        driver: capabilities.driver,
        database_name: database.map(ToString::to_string),
        schema_name: schema.to_string(),
        captured_at: current_timestamp_millis(),
        relations,
        routines,
        schema_objects,
        warnings,
    })
    .map_err(|error| error.to_string())
}

fn descriptor_value_fingerprint(value: Option<&str>) -> Option<String> {
    value.map(|value| format!("{:x}", Sha256::digest(value.as_bytes())))
}

fn semantic_schema_snapshot(snapshot: &SchemaSnapshot) -> SemanticSchemaSnapshot {
    let relations = snapshot
        .relations
        .iter()
        .map(|relation| {
            serde_json::json!({
                "name": relation.name,
                "objectType": relation.object_type,
                "columns": relation.columns.iter().map(|column| serde_json::json!({
                    "name": column.name,
                    "dataType": column.data_type,
                    "nullable": column.is_nullable,
                    "primaryKey": column.is_primary_key,
                    "unique": column.is_unique,
                    "indexed": column.is_indexed,
                    "autoIncrement": column.is_auto_increment,
                    "hasDefault": column.default_value.is_some(),
                    "defaultFingerprint": descriptor_value_fingerprint(column.default_value.as_deref()),
                })).collect::<Vec<_>>(),
                "indexes": relation.indexes.iter().map(|index| serde_json::json!({
                    "name": index.name,
                    "columns": index.columns,
                    "unique": index.is_unique,
                    "primary": index.is_primary,
                    "indexType": index.index_type,
                    "hasOpaqueExpression": index.definition.is_some(),
                    "expressionFingerprint": descriptor_value_fingerprint(index.definition.as_deref()),
                })).collect::<Vec<_>>(),
                "constraints": relation.constraints.iter().map(|constraint| serde_json::json!({
                    "name": constraint.name,
                    "constraintType": constraint.constraint_type,
                    "columns": constraint.columns,
                    "referencedSchema": constraint.referenced_schema,
                    "referencedTable": constraint.referenced_table,
                    "referencedColumns": constraint.referenced_columns,
                    "hasOpaqueExpression": constraint.definition.is_some(),
                    "expressionFingerprint": descriptor_value_fingerprint(constraint.definition.as_deref()),
                })).collect::<Vec<_>>(),
            })
        })
        .collect::<Vec<_>>();
    let routines = snapshot
        .routines
        .iter()
        .map(|routine| {
            serde_json::json!({
                "name": routine.name,
                "routineType": routine.routine_type,
                "parameters": routine.parameters.iter().map(|parameter| serde_json::json!({
                    "name": parameter.name,
                    "dataType": parameter.data_type,
                    "optional": parameter.optional,
                })).collect::<Vec<_>>(),
                "returnType": routine.return_type,
            })
        })
        .collect::<Vec<_>>();
    let schema_objects = snapshot
        .schema_objects
        .iter()
        .map(|object| {
            serde_json::json!({
                "name": object.name,
                "objectType": object.object_type,
                "parentName": object.parent_name,
            })
        })
        .collect::<Vec<_>>();
    SemanticSchemaSnapshot {
        snapshot_version: 1,
        fingerprint: snapshot.fingerprint.clone(),
        database: snapshot.database_name.clone(),
        namespace: snapshot.schema_name.clone(),
        descriptor: serde_json::json!({
            "relations": relations,
            "routines": routines,
            "schemaObjects": schema_objects,
        }),
    }
}

fn external_review_only_plan(mut plan: SchemaDiffPlan) -> SchemaDiffPlan {
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

fn external_driver_plan(
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

fn external_preflight_results(
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

async fn attach_host_recapture_after_external_failure(
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
async fn execute_external_schema_migration(
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

#[tauri::command]
pub async fn execute_schema_migration(
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
            "Automatic migration apply is available only for PostgreSQL transactional plans and explicitly acknowledged MySQL non-transactional plans; open the reviewed SQL in a console for other drivers",
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
    }

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
    for entry in &mut entries {
        if interrupt_stale_migration_journal(entry) {
            persist_journal_or_warn(meta_store.inner(), entry).await;
        }
    }
    entries.sort_by_key(|entry| std::cmp::Reverse(entry.started_at));
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

/// Offline baselines are intentionally review-only descriptions. Check every
/// registered marker before fingerprint verification so a frontend guard or a
/// future source format cannot accidentally expose migration execution.
fn ensure_snapshot_is_executable_source(
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

fn interrupt_stale_migration_journal(journal: &mut SchemaMigrationJournalEntry) -> bool {
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
    use crate::core::protocol::{ColumnDef, ColumnInfo, ConstraintInfo, IndexInfo};

    fn semantic_fixture_snapshot() -> SchemaSnapshot {
        SchemaSnapshot {
            version: SCHEMA_SNAPSHOT_VERSION,
            id: "snapshot-1".to_string(),
            fingerprint: "snapshot-fingerprint".to_string(),
            project_id: "project-1".to_string(),
            connection_id: "connection-1".to_string(),
            connection_name: "Production".to_string(),
            driver: "warehouse".to_string(),
            database_name: Some("app".to_string()),
            schema_name: "public".to_string(),
            captured_at: 1,
            relations: vec![SchemaRelationSnapshot {
                name: "users".to_string(),
                object_type: Some("TABLE".to_string()),
                columns: vec![ColumnInfo {
                    name: "id".to_string(),
                    data_type: "integer".to_string(),
                    is_nullable: false,
                    is_primary_key: true,
                    is_unique: true,
                    is_indexed: true,
                    is_auto_increment: false,
                    default_value: Some("nextval('private_sequence')".to_string()),
                    comment: Some("private comment".to_string()),
                }],
                indexes: vec![IndexInfo {
                    name: "users_idx".to_string(),
                    columns: vec!["id".to_string()],
                    is_unique: true,
                    is_primary: true,
                    index_type: Some("btree".to_string()),
                    definition: Some("CREATE INDEX private_source".to_string()),
                    comment: Some("private index comment".to_string()),
                }],
                constraints: vec![ConstraintInfo {
                    name: "users_check".to_string(),
                    constraint_type: "CHECK".to_string(),
                    columns: vec!["id".to_string()],
                    referenced_schema: None,
                    referenced_table: None,
                    referenced_columns: Vec::new(),
                    definition: Some("CHECK (id > 0)".to_string()),
                }],
            }],
            routines: Vec::new(),
            schema_objects: Vec::new(),
            warnings: Vec::new(),
        }
    }

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
    fn migration_execution_mode_keeps_mysql_non_transactional() {
        assert_eq!(
            schema_migration_execution_mode("postgres"),
            Some(SchemaMigrationExecutionMode::Transactional)
        );
        assert_eq!(
            schema_migration_execution_mode("mysql"),
            Some(SchemaMigrationExecutionMode::NonTransactional)
        );
        assert_eq!(
            schema_migration_execution_mode("mariadb"),
            Some(SchemaMigrationExecutionMode::NonTransactional)
        );
        assert_eq!(schema_migration_execution_mode("sqlite"), None);
        assert_eq!(schema_migration_execution_mode("duckdb"), None);
    }

    #[test]
    fn external_packages_cannot_receive_host_generated_schema_migrations() {
        let mut capabilities = DatabaseKind::Postgres.capabilities();
        capabilities.display_name = "PostgreSQL JDBC package".to_string();

        assert!(ensure_host_schema_migration_capability(None).is_ok());
        assert_eq!(
            ensure_host_schema_migration_capability(Some(&capabilities)).unwrap_err(),
            "PostgreSQL JDBC package does not provide a verified semantic schema migration protocol"
        );
    }

    #[test]
    fn semantic_sidecar_snapshot_hashes_opaque_expressions_without_source_text() {
        let snapshot = semantic_schema_snapshot(&semantic_fixture_snapshot());
        let encoded = serde_json::to_string(&snapshot).unwrap();

        assert!(!encoded.contains("nextval"));
        assert!(!encoded.contains("CREATE INDEX"));
        assert!(!encoded.contains("CHECK ("));
        assert!(!encoded.contains("private comment"));
        assert!(encoded.contains("defaultFingerprint"));
        assert!(encoded.contains("expressionFingerprint"));
    }

    #[test]
    fn external_plan_exposes_host_id_and_preview_but_never_sidecar_tokens() {
        let source = semantic_fixture_snapshot();
        let target = semantic_fixture_snapshot();
        let result = DriverMigrationPlanResult {
            plan_id: "sidecar-plan-id".to_string(),
            plan_token: "sidecar-secret-token".to_string(),
            target_fingerprint: target.fingerprint.clone(),
            mode: SchemaMigrationMode::Transactional,
            change_count: 1,
            blocked_change_count: 0,
            requires_review: true,
            requires_destructive: false,
            preview: vec![oxide_driver_protocol::SchemaMigrationPreviewChange {
                id: "sidecar-change-id".to_string(),
                kind: "alterColumn".to_string(),
                label: "users.id".to_string(),
                risk: "review".to_string(),
                reversible: true,
                summary: "Change the identifier representation".to_string(),
            }],
            warnings: Vec::new(),
        };

        let plan = external_driver_plan(&source, &target, "host-plan-id".to_string(), 1, &result);
        let encoded = serde_json::to_string(&plan).unwrap();

        assert_eq!(plan.id, "host-plan-id");
        assert_eq!(
            plan.execution_owner,
            SchemaDiffExecutionOwner::ExternalDriver
        );
        assert!(plan.migration_sql.is_empty());
        assert!(!encoded.contains("sidecar-secret-token"));
        assert!(!encoded.contains("sidecar-plan-id"));
        assert!(!encoded.contains("sidecar-change-id"));
    }

    #[test]
    fn external_migration_sessions_are_process_local_bounded_and_single_use() {
        let state = ExternalSchemaMigrationSessionState::default();
        state
            .insert(ExternalSchemaMigrationSession {
                host_plan_id: "host-plan-id".to_string(),
                sidecar_plan_id: "sidecar-plan-id".to_string(),
                plan_token: "secret-token".to_string(),
                connection_id: "connection-1".to_string(),
                runtime_process_id: 42,
                source_fingerprint: "source".to_string(),
                target_fingerprint: "target".to_string(),
                mode: SchemaMigrationMode::Transactional,
                change_count: 1,
                blocked_change_count: 0,
                requires_review: false,
                requires_destructive: false,
                expires_at: Instant::now() + Duration::from_secs(60),
            })
            .unwrap();

        assert_eq!(
            state.get("host-plan-id").unwrap().plan_token,
            "secret-token"
        );
        assert_eq!(
            state.consume("host-plan-id").unwrap().sidecar_plan_id,
            "sidecar-plan-id"
        );
        assert!(state.get("host-plan-id").is_err());
        assert!(state.consume("host-plan-id").is_err());
    }

    #[test]
    fn external_preflight_journal_does_not_copy_raw_observed_text() {
        let result = oxide_driver_protocol::SchemaMigrationPreflightResult {
            plan_id: "sidecar-plan".to_string(),
            preflight_token: "preflight-token".to_string(),
            target_fingerprint: "target".to_string(),
            ready: false,
            checks: vec![oxide_driver_protocol::SchemaMigrationPreflightCheckResult {
                id: "check-1".to_string(),
                label: "Check target".to_string(),
                status: "blocked".to_string(),
                blocks_execution: true,
                observed: "private@example.com".to_string(),
            }],
        };

        let journal = external_preflight_results(&result);

        assert_eq!(journal.len(), 1);
        assert!(journal[0].blocks_execution);
        assert!(!journal[0].observed.contains("private@example.com"));
    }

    #[test]
    fn active_migration_journal_is_not_treated_as_an_interrupted_process() {
        let id = "schema-migration-active-test";
        let guard = ActiveMigrationJournal::register(id);
        assert!(migration_is_active(id));
        drop(guard);
        assert!(!migration_is_active(id));
    }

    #[test]
    fn stale_running_journal_requires_a_fresh_snapshot_instead_of_resume() {
        let mut journal = SchemaMigrationJournalEntry {
            id: "schema-migration-stale-test".to_string(),
            project_id: "project-1".to_string(),
            connection_id: "connection-1".to_string(),
            connection_name: "Production".to_string(),
            database_name: Some("app".to_string()),
            schema_name: "public".to_string(),
            plan_id: "plan-1".to_string(),
            source_fingerprint: "source".to_string(),
            target_fingerprint_before: "target".to_string(),
            status: SchemaMigrationStatus::Running,
            started_at: 1,
            finished_at: None,
            statement_count: 2,
            committed_statements: 1,
            preflight_results: Vec::new(),
            rollback: SchemaRollbackArtifact {
                available: false,
                reason: None,
                plan_id: None,
                change_count: 0,
                requires_manual_review: true,
                sql: None,
            },
            verification: None,
            error: None,
            warnings: Vec::new(),
        };

        assert!(interrupt_stale_migration_journal(&mut journal));
        assert_eq!(journal.status, SchemaMigrationStatus::Interrupted);
        assert_eq!(journal.committed_statements, 1);
        assert!(journal.finished_at.is_some());
        assert!(journal
            .error
            .as_deref()
            .is_some_and(|error| error.contains("fresh snapshot")));
        assert!(!interrupt_stale_migration_journal(&mut journal));
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
            routines: Vec::new(),
            schema_objects: Vec::new(),
            warnings: Vec::new(),
        };

        assert_eq!(
            migration_confirmation_target(&snapshot),
            "Production / app / public"
        );
    }

    #[test]
    fn project_ddl_baseline_cannot_enter_migration_execution() {
        let snapshot = SchemaSnapshot {
            version: SCHEMA_SNAPSHOT_VERSION,
            id: "project-ddl-1".to_string(),
            fingerprint: "offline-1234".to_string(),
            project_id: "project-1".to_string(),
            connection_id: "connection-1".to_string(),
            connection_name: "Production".to_string(),
            driver: "postgres".to_string(),
            database_name: Some("app".to_string()),
            schema_name: "public".to_string(),
            captured_at: 1,
            relations: Vec::new(),
            routines: Vec::new(),
            schema_objects: Vec::new(),
            warnings: vec![OFFLINE_PROJECT_DDL_REVIEW_WARNING.to_string()],
        };

        let error = ensure_snapshot_is_executable_source(snapshot).unwrap_err();

        assert!(error.contains("review-only"));
    }

    #[test]
    fn every_offline_baseline_marker_is_rejected_by_the_backend() {
        for warning in OFFLINE_REVIEW_WARNINGS {
            let snapshot = SchemaSnapshot {
                version: SCHEMA_SNAPSHOT_VERSION,
                id: format!("offline-{warning}"),
                fingerprint: "offline-1234".to_string(),
                project_id: "project-1".to_string(),
                connection_id: "connection-1".to_string(),
                connection_name: "Production".to_string(),
                driver: "postgres".to_string(),
                database_name: Some("app".to_string()),
                schema_name: "public".to_string(),
                captured_at: 1,
                relations: Vec::new(),
                routines: Vec::new(),
                schema_objects: Vec::new(),
                warnings: vec![warning.to_string()],
            };

            assert!(ensure_snapshot_is_executable_source(snapshot)
                .unwrap_err()
                .contains("review-only"));
        }
    }
}
