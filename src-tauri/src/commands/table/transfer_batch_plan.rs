//! Transfer batch plan for table operations.

use super::policy::table_data_transfer_dialect;
use super::reports::{current_table_timestamp_millis, table_data_transfer_plan_digest};
use super::transfer_mapping::transfer_plan_can_execute;
use super::transfer_objects::{
    normalized_table_data_transfer_objects, resolve_table_data_transfer_object_plan,
    ResolvedTableDataTransferObjectPlan, MAX_TABLE_DATA_TRANSFER_BATCH_TABLES,
};
use super::transfer_plan::{
    ensure_transfer_endpoint_driver_matches_connection, resolve_table_data_transfer_plan,
};
use super::transfer_runtime::{
    bounded_table_data_transfer_message, normalized_transfer_driver_id,
    resolve_table_data_transfer_batch_plan_isolated,
};
use super::transfer_types::{
    TableDataTransferBatchPlan, TableDataTransferBatchPlanRequest,
    TableDataTransferBatchTablePreflight, TableDataTransferDependency, TableDataTransferEndpoint,
    TableDataTransferMode, TableDataTransferRequest,
};
use crate::core::manager::ConnectionManager;
use crate::core::protocol::ConstraintInfo;
use crate::core::protocol::Response;
use crate::core::schema_diff::finalize_schema_snapshot;
use crate::core::schema_diff::SchemaSnapshot;
use sha2::Digest;
use sha2::Sha256;
use std::collections::BTreeSet;
use std::collections::HashMap;
use std::collections::HashSet;
use tauri::State;

pub(super) fn normalized_table_data_transfer_batch_tables(
    tables: &[String],
) -> Result<Vec<String>, String> {
    if tables.len() > MAX_TABLE_DATA_TRANSFER_BATCH_TABLES {
        return Err(format!(
            "Select at most {MAX_TABLE_DATA_TRANSFER_BATCH_TABLES} tables for a batch transfer plan."
        ));
    }
    let mut seen = HashSet::new();
    let mut normalized = Vec::with_capacity(tables.len());
    for table in tables {
        let table = table.trim();
        if table.is_empty() || table.len() > 256 || table.chars().any(char::is_control) {
            return Err(
                "Batch transfer table names must be non-empty bounded identifiers.".to_string(),
            );
        }
        let key = table.to_ascii_lowercase();
        if !seen.insert(key) {
            return Err(format!("Batch transfer contains duplicate table {table}."));
        }
        normalized.push(table.to_string());
    }
    Ok(normalized)
}

pub(super) fn table_data_transfer_batch_preflight_id(
    request: &TableDataTransferBatchPlanRequest,
    table: &str,
) -> Result<String, String> {
    let encoded = serde_json::to_vec(&(request, table))
        .map_err(|error| format!("Could not encode batch table preflight: {error}"))?;
    let digest = Sha256::digest(encoded);
    Ok(format!(
        "batch-plan-{:X}",
        u64::from_be_bytes(digest[..8].try_into().expect("sha256 prefix"))
    ))
}

pub(super) fn finalize_table_data_transfer_batch_confirmation(
    request: &TableDataTransferBatchPlanRequest,
    plan: &mut TableDataTransferBatchPlan,
) -> Result<(), String> {
    let binding = serde_json::json!({
        "request": request,
        "orderedTables": &plan.ordered_tables,
        "dependencies": &plan.dependencies,
        "cyclicTables": &plan.cyclic_tables,
        "preflights": &plan.table_preflights,
        "objectPreflights": &plan.object_preflights,
    });
    let encoded = serde_json::to_vec(&binding)
        .map_err(|error| format!("Could not encode batch transfer confirmation: {error}"))?;
    let digest = Sha256::digest(encoded);
    plan.confirmation_token = format!(
        "BATCH TRANSFER {:X}",
        u64::from_be_bytes(digest[..8].try_into().expect("sha256 prefix"))
    );
    Ok(())
}

pub(super) fn table_data_transfer_batch_plan(
    request: &TableDataTransferBatchPlanRequest,
    tables: &[String],
    constraints_by_table: &[(String, Vec<ConstraintInfo>)],
) -> Result<TableDataTransferBatchPlan, String> {
    let table_by_key = tables
        .iter()
        .map(|table| (table.to_ascii_lowercase(), table.clone()))
        .collect::<HashMap<_, _>>();
    let mut outgoing = tables
        .iter()
        .map(|table| (table.to_ascii_lowercase(), BTreeSet::new()))
        .collect::<HashMap<_, BTreeSet<String>>>();
    let mut indegree = tables
        .iter()
        .map(|table| (table.to_ascii_lowercase(), 0_usize))
        .collect::<HashMap<_, _>>();
    let mut dependencies = Vec::new();

    for (dependent_table, constraints) in constraints_by_table {
        let dependent_key = dependent_table.to_ascii_lowercase();
        for constraint in constraints {
            if !constraint
                .constraint_type
                .eq_ignore_ascii_case("FOREIGN KEY")
            {
                continue;
            }
            let Some(referenced_table) = constraint.referenced_table.as_deref() else {
                continue;
            };
            let referenced_schema = constraint
                .referenced_schema
                .as_deref()
                .filter(|schema| !schema.trim().is_empty())
                .unwrap_or(&request.source_schema);
            if !referenced_schema.eq_ignore_ascii_case(&request.source_schema) {
                continue;
            }
            let prerequisite_key = referenced_table.trim().to_ascii_lowercase();
            if prerequisite_key == dependent_key || !table_by_key.contains_key(&prerequisite_key) {
                if prerequisite_key == dependent_key {
                    dependencies.push(TableDataTransferDependency {
                        prerequisite_table: table_by_key[&dependent_key].clone(),
                        dependent_table: table_by_key[&dependent_key].clone(),
                        constraint_name: constraint.name.clone(),
                    });
                    *indegree
                        .get_mut(&dependent_key)
                        .expect("selected table exists") += 1;
                }
                continue;
            }
            let successors = outgoing
                .get_mut(&prerequisite_key)
                .expect("selected prerequisite exists");
            if successors.insert(dependent_key.clone()) {
                *indegree
                    .get_mut(&dependent_key)
                    .expect("selected table exists") += 1;
            }
            dependencies.push(TableDataTransferDependency {
                prerequisite_table: table_by_key[&prerequisite_key].clone(),
                dependent_table: table_by_key[&dependent_key].clone(),
                constraint_name: constraint.name.clone(),
            });
        }
    }
    dependencies.sort_by(|left, right| {
        (
            &left.prerequisite_table,
            &left.dependent_table,
            &left.constraint_name,
        )
            .cmp(&(
                &right.prerequisite_table,
                &right.dependent_table,
                &right.constraint_name,
            ))
    });

    let mut ready = indegree
        .iter()
        .filter_map(|(key, degree)| (*degree == 0).then_some(key.clone()))
        .collect::<BTreeSet<_>>();
    let mut ordered_keys = Vec::with_capacity(tables.len());
    while let Some(next) = ready.pop_first() {
        ordered_keys.push(next.clone());
        for dependent in outgoing[&next].clone() {
            let degree = indegree
                .get_mut(&dependent)
                .expect("dependency target exists");
            *degree -= 1;
            if *degree == 0 {
                ready.insert(dependent);
            }
        }
    }
    let cyclic_tables = indegree
        .into_iter()
        .filter_map(|(key, degree)| (degree > 0).then_some(table_by_key[&key].clone()))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let cyclic_keys = cyclic_tables
        .iter()
        .map(|table| table.to_ascii_lowercase())
        .collect::<HashSet<_>>();
    let mut ordered_tables = ordered_keys
        .iter()
        .map(|key| table_by_key[key].clone())
        .collect::<Vec<_>>();
    ordered_tables.extend(
        tables
            .iter()
            .filter(|table| cyclic_keys.contains(&table.to_ascii_lowercase()))
            .cloned(),
    );
    let mut warnings = Vec::new();
    if !tables.is_empty() {
        warnings.push(
            "The reviewed dependency order and each table mapping are bound into one confirmation token. Execution writes all selected tables in one target transaction."
                .to_string(),
        );
    }
    if !cyclic_tables.is_empty() {
        warnings.push(
            "Selected tables contain an unresolved foreign-key dependency cycle. Execution is allowed only when every in-cycle foreign key is absent from the target and is bound to the reviewed post-copy restoration plan."
                .to_string(),
        );
    }
    if request.mode == TableDataTransferMode::Upsert {
        warnings.push(
            "Each upsert table must independently prove a complete target primary-key mapping before execution."
                .to_string(),
        );
    }
    Ok(TableDataTransferBatchPlan {
        ordered_tables,
        dependencies,
        cyclic_tables: cyclic_tables.clone(),
        table_preflights: Vec::new(),
        object_preflights: Vec::new(),
        can_execute: true,
        confirmation_token: String::new(),
        warnings,
    })
}

pub(super) fn missing_deferred_cycle_foreign_keys(
    plan: &TableDataTransferBatchPlan,
    deferred_foreign_keys_by_table: &HashMap<String, HashSet<String>>,
) -> Vec<String> {
    if plan.cyclic_tables.is_empty() {
        return Vec::new();
    }
    let unresolved = plan
        .cyclic_tables
        .iter()
        .map(|table| table.to_ascii_lowercase())
        .collect::<HashSet<_>>();
    let mut missing = plan
        .dependencies
        .iter()
        .filter(|dependency| {
            unresolved.contains(&dependency.prerequisite_table.to_ascii_lowercase())
                && unresolved.contains(&dependency.dependent_table.to_ascii_lowercase())
        })
        .filter_map(|dependency| {
            let table_key = dependency.dependent_table.to_ascii_lowercase();
            let constraint_key = dependency.constraint_name.to_ascii_lowercase();
            (!deferred_foreign_keys_by_table
                .get(&table_key)
                .is_some_and(|names| names.contains(&constraint_key)))
            .then(|| {
                format!(
                    "{}.{}",
                    dependency.dependent_table, dependency.constraint_name
                )
            })
        })
        .collect::<Vec<_>>();
    missing.sort();
    missing.dedup();
    missing
}

pub(super) fn empty_transfer_context_snapshot(
    connection_id: &str,
    driver: &str,
    database_name: Option<String>,
    schema_name: &str,
) -> Result<SchemaSnapshot, String> {
    finalize_schema_snapshot(SchemaSnapshot {
        version: crate::core::schema_diff::SCHEMA_SNAPSHOT_VERSION,
        id: String::new(),
        fingerprint: String::new(),
        project_id: "table-transfer-preview".to_string(),
        connection_id: connection_id.to_string(),
        connection_name: connection_id.to_string(),
        driver: driver.to_string(),
        database_name,
        schema_name: schema_name.to_string(),
        captured_at: current_table_timestamp_millis(),
        relations: Vec::new(),
        routines: Vec::new(),
        schema_objects: Vec::new(),
        warnings: Vec::new(),
    })
    .map_err(|error| error.to_string())
}

pub(super) struct ResolvedTableDataTransferBatchPlan {
    pub(super) plan: TableDataTransferBatchPlan,
    pub(super) object_plan: ResolvedTableDataTransferObjectPlan,
}

pub(super) async fn resolve_table_data_transfer_batch_plan(
    manager: &ConnectionManager,
    request: TableDataTransferBatchPlanRequest,
) -> Result<ResolvedTableDataTransferBatchPlan, String> {
    let tables = normalized_table_data_transfer_batch_tables(&request.tables)?;
    let objects = normalized_table_data_transfer_objects(&request.objects)?;
    if tables.is_empty() && objects.is_empty() {
        return Err(
            "Select at least one table or schema object for a batch transfer plan.".to_string(),
        );
    }
    if request.source_connection_id.trim().is_empty()
        || request.target_connection_id.trim().is_empty()
        || request.source_schema.trim().is_empty()
        || request.target_schema.trim().is_empty()
    {
        return Err(
            "Source and target connection/schema are required for a batch transfer plan."
                .to_string(),
        );
    }
    let sample_table = tables
        .first()
        .cloned()
        .or_else(|| objects.first().map(|object| object.name.clone()))
        .expect("validated non-empty transfer selection");
    let source = TableDataTransferEndpoint {
        connection_id: request.source_connection_id.clone(),
        driver: request.source_driver.clone(),
        database: request.source_database.clone(),
        schema: request.source_schema.clone(),
        table: sample_table.clone(),
    };
    let target = TableDataTransferEndpoint {
        connection_id: request.target_connection_id.clone(),
        driver: request.target_driver.clone(),
        database: request.target_database.clone(),
        schema: request.target_schema.clone(),
        table: sample_table,
    };
    ensure_transfer_endpoint_driver_matches_connection(manager, &source).await?;
    ensure_transfer_endpoint_driver_matches_connection(manager, &target).await?;
    table_data_transfer_dialect(manager, &source).await?;
    table_data_transfer_dialect(manager, &target).await?;

    let mut constraints_by_table = Vec::with_capacity(tables.len());
    for table in &tables {
        let constraints = match source.database.as_deref() {
            Some(database) => {
                manager
                    .get_database_constraints(
                        &source.connection_id,
                        database,
                        &source.schema,
                        table,
                    )
                    .await
            }
            None => {
                manager
                    .get_constraints(&source.connection_id, &source.schema, table)
                    .await
            }
        }
        .map_err(|error| {
            format!(
                "Could not inspect foreign-key dependencies for {}: {error}",
                table
            )
        })?;
        constraints_by_table.push((table.clone(), constraints));
    }
    let mut plan = table_data_transfer_batch_plan(&request, &tables, &constraints_by_table)?;
    let mut deferred_foreign_keys_by_table = HashMap::<String, HashSet<String>>::new();
    for table in &plan.ordered_tables {
        let preflight_request = TableDataTransferRequest {
            project_id: None,
            // Deterministic validation-only identity: the aggregate
            // confirmation token must be stable across preview and
            // execution while still satisfying transfer-id rules.
            transfer_id: table_data_transfer_batch_preflight_id(&request, table)?,
            source: TableDataTransferEndpoint {
                connection_id: request.source_connection_id.clone(),
                driver: request.source_driver.clone(),
                database: request.source_database.clone(),
                schema: request.source_schema.clone(),
                table: table.clone(),
            },
            target: TableDataTransferEndpoint {
                connection_id: request.target_connection_id.clone(),
                driver: request.target_driver.clone(),
                database: request.target_database.clone(),
                schema: request.target_schema.clone(),
                table: table.clone(),
            },
            mode: request.mode,
            max_rows: request.max_rows,
            batch_size: request.batch_size,
            reseed_identity: request.reseed_identity,
            quote_target_column_names: request.quote_target_column_names,
            restore_source_schema_objects: request.restore_source_schema_objects,
        };
        match resolve_table_data_transfer_plan(manager, &preflight_request).await {
            Ok(table_plan) => {
                let can_execute = transfer_plan_can_execute(&table_plan.mapped_columns);
                deferred_foreign_keys_by_table.insert(
                    table.to_ascii_lowercase(),
                    table_plan
                        .deferred_foreign_key_names
                        .iter()
                        .map(|name| name.to_ascii_lowercase())
                        .collect(),
                );
                plan.table_preflights
                    .push(TableDataTransferBatchTablePreflight {
                        table: table.clone(),
                        can_execute,
                        mapped_columns: table_plan.mapped_columns.len() as u32,
                        plan_digest: Some(table_data_transfer_plan_digest(
                            &table_plan.confirmation_token,
                        )),
                        identity_reseed_plans: table_plan.identity_reseed_plans,
                        schema_restore_statements: table_plan.schema_restore_statements,
                        warnings: table_plan.warnings,
                    });
                plan.can_execute &= can_execute;
            }
            Err(error) => {
                plan.table_preflights
                    .push(TableDataTransferBatchTablePreflight {
                        table: table.clone(),
                        can_execute: false,
                        mapped_columns: 0,
                        plan_digest: None,
                        identity_reseed_plans: Vec::new(),
                        schema_restore_statements: Vec::new(),
                        warnings: vec![bounded_table_data_transfer_message(&error)],
                    });
                plan.can_execute = false;
            }
        }
    }
    if !plan.can_execute {
        plan.warnings.push(
                    "At least one selected table failed a fresh source/target mapping preflight. Review every table before attempting a batch transfer."
                        .to_string(),
                );
    }
    if !plan.cyclic_tables.is_empty() {
        let target_driver = normalized_transfer_driver_id(&request.target_driver);
        let missing = missing_deferred_cycle_foreign_keys(&plan, &deferred_foreign_keys_by_table);
        if !matches!(target_driver.as_str(), "postgres" | "mysql") {
            plan.can_execute = false;
            plan.warnings.push(
                "Cyclic foreign-key batches require reviewed native PostgreSQL transactional DDL or native MySQL post-commit restoration with a partial-completion receipt."
                    .to_string(),
            );
        } else if !request.restore_source_schema_objects {
            plan.can_execute = false;
            plan.warnings.push(
                "Enable reviewed source index/constraint restoration so every in-cycle foreign key can be created only after all table rows are copied."
                    .to_string(),
            );
        } else if !missing.is_empty() {
            plan.can_execute = false;
            plan.warnings.push(format!(
                "The cycle is still enforced by target or unproven constraint(s): {}. Remove or separately review those target constraints before retrying.",
                missing.join(", ")
            ));
        } else if target_driver == "mysql" {
            plan.warnings.push(
                "Every unresolved in-cycle foreign key is absent from the target and bound to reviewed post-copy MySQL DDL. Row copies commit first; indexes and constraints then run one statement at a time. Any cancellation or failure produces a partial-completion receipt, requires manual target inspection, and disables automatic retry."
                    .to_string(),
            );
        } else {
            plan.warnings.push(
                "Every unresolved in-cycle foreign key is absent from the target and bound to post-copy PostgreSQL DDL. Tables keep deterministic selection order inside the transaction; all foreign keys are restored after every table copy succeeds."
                    .to_string(),
            );
        }
    }
    let object_plan = resolve_table_data_transfer_object_plan(manager, &request, &objects).await?;
    plan.object_preflights = object_plan.preflights.clone();
    if plan
        .object_preflights
        .iter()
        .any(|preflight| !preflight.can_execute)
    {
        plan.can_execute = false;
        plan.warnings.push(
            "At least one selected schema object is blocked because its source DDL or dependencies could not be proven."
                .to_string(),
        );
    }
    if !plan.object_preflights.is_empty() {
        plan.warnings.push(
            "Selected PostgreSQL schema objects are created before row copies inside the same reviewed target transaction; existing objects are skipped and never replaced."
                .to_string(),
        );
    }
    finalize_table_data_transfer_batch_confirmation(&request, &mut plan)?;
    Ok(ResolvedTableDataTransferBatchPlan { plan, object_plan })
}

#[tauri::command]
pub async fn preview_table_data_transfer_batch_plan(
    manager: State<'_, ConnectionManager>,
    request: TableDataTransferBatchPlanRequest,
) -> Result<Response<TableDataTransferBatchPlan>, String> {
    match resolve_table_data_transfer_batch_plan_isolated(&manager, request).await {
        Ok(resolved) => Ok(Response::ok(resolved.plan)),
        Err(error) => Ok(Response::err(
            "PREVIEW_TABLE_DATA_TRANSFER_BATCH_PLAN_ERROR",
            &error,
        )),
    }
}
