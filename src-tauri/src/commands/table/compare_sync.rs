//! Compare sync for table operations.

use super::access::{ensure_target_relation_operation_allowed, get_target_columns};
use super::compare_rows::{
    data_compare_key_columns_are_declared_unique, data_compare_transfer_endpoint,
};
use super::compare_types::{
    ExecuteTableDataCompareSyncRequest, FrozenTableDataCompareSyncPlan,
    TableDataCompareDegradationLevel, TableDataCompareEndpoint, TableDataCompareSyncPlanState,
    TableDataCompareSyncPreview, TableDataCompareSyncPreviewRequest, TableDataCompareSyncReceipt,
};
use super::export_sql::{sql_export_dialect, sql_export_literal, SqlExportDialect};
use super::limits::{MAX_DATA_COMPARE_SYNC_OPERATIONS, MAX_DATA_COMPARE_SYNC_SQL_BYTES};
use super::policy::{schema_option, table_data_transfer_dialect, RelationOperation};
use super::row_sql::{
    build_insert_mutation, column_for, column_lookup, query_parameter, validate_insert_values,
    writable_column_for,
};
use super::transfer_plan::ensure_transfer_endpoint_driver_matches_connection;
use crate::core::dialect::DatabaseKind;
use crate::core::manager::ConnectionManager;
use crate::core::protocol::ColumnInfo;
use crate::core::protocol::ParameterizedStatement;
use crate::core::protocol::QueryParameter;
use crate::core::protocol::Response;
use serde_json::Value;
use sha2::Digest;
use sha2::Sha256;
use std::collections::BTreeMap;
use std::collections::HashSet;
use tauri::State;

pub(super) fn validate_table_data_compare_sync_preview(
    request: &TableDataCompareSyncPreviewRequest,
) -> Result<(Vec<String>, Vec<String>), String> {
    let encoded_comparison = serde_json::to_vec(&request.comparison)
        .map_err(|error| format!("Could not validate synchronization payload: {error}"))?;
    if encoded_comparison.len() > MAX_DATA_COMPARE_SYNC_SQL_BYTES {
        return Err(format!(
            "Data synchronization comparison payload exceeds the {} MiB review limit",
            MAX_DATA_COMPARE_SYNC_SQL_BYTES / (1024 * 1024)
        ));
    }
    if request.comparison.degradation_level != TableDataCompareDegradationLevel::Full
        || !request.comparison.counts_exact
    {
        return Err(
            "Data synchronization preview requires an exact full-table comparison; sampled or skipped results cannot produce mutation SQL."
                .to_string(),
        );
    }
    if request.comparison.details_truncated {
        return Err(
            "Data synchronization preview is blocked because the comparison detail set was truncated. Reconcile the table in smaller reviewed scopes."
                .to_string(),
        );
    }
    if request.comparison.added_count != request.comparison.added.len() as u64
        || request.comparison.removed_count != request.comparison.removed.len() as u64
        || request.comparison.modified_count != request.comparison.modified.len() as u64
    {
        return Err(
            "Data synchronization preview requires every reported difference to be present in the reviewed comparison payload."
                .to_string(),
        );
    }
    let operation_count = request
        .comparison
        .added
        .len()
        .saturating_add(request.comparison.removed.len())
        .saturating_add(request.comparison.modified.len());
    if operation_count == 0 {
        return Err("Data synchronization preview requires at least one difference".to_string());
    }
    if operation_count > MAX_DATA_COMPARE_SYNC_OPERATIONS {
        return Err(format!(
            "Data synchronization preview is limited to {MAX_DATA_COMPARE_SYNC_OPERATIONS} reviewed row operations"
        ));
    }

    let columns = request
        .columns
        .iter()
        .map(|column| column.trim().to_string())
        .filter(|column| !column.is_empty())
        .collect::<Vec<_>>();
    let key_columns = request
        .key_columns
        .iter()
        .map(|column| column.trim().to_string())
        .filter(|column| !column.is_empty())
        .collect::<Vec<_>>();
    if columns.is_empty() || key_columns.is_empty() {
        return Err(
            "Data synchronization preview requires selected columns and key columns".to_string(),
        );
    }
    if columns.iter().collect::<HashSet<_>>().len() != columns.len()
        || key_columns.iter().collect::<HashSet<_>>().len() != key_columns.len()
        || key_columns.iter().any(|key| !columns.contains(key))
    {
        return Err(
            "Data synchronization columns must be unique and include every key column".to_string(),
        );
    }
    Ok((columns, key_columns))
}

pub(super) fn data_compare_sync_literal(
    dialect: SqlExportDialect,
    column: &ColumnInfo,
    value: &Value,
) -> String {
    sql_export_literal(dialect, value, Some(&column.data_type))
}

pub(super) fn table_data_compare_sync_token_digest(token: &str) -> String {
    format!("{:x}", Sha256::digest(token.as_bytes()))
}

pub(super) fn table_data_compare_sync_metadata_digest(
    metadata: &BTreeMap<String, ColumnInfo>,
) -> Result<String, String> {
    serde_json::to_vec(metadata)
        .map(|encoded| format!("{:x}", Sha256::digest(encoded)))
        .map_err(|error| format!("Could not bind target metadata to synchronization plan: {error}"))
}

pub(super) fn table_data_compare_sync_confirmation_text(
    target: &TableDataCompareEndpoint,
    delete_count: u64,
) -> String {
    let relation = target
        .database
        .iter()
        .map(String::as_str)
        .chain(std::iter::once(target.schema.as_str()))
        .chain(std::iter::once(target.table.as_str()))
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(".");
    if delete_count > 0 {
        format!("SYNC AND DELETE {delete_count} ROWS FROM {relation}")
    } else {
        format!("SYNC {relation}")
    }
}

pub(super) fn data_compare_sync_snapshot_predicate(
    kind: DatabaseKind,
    dialect: SqlExportDialect,
    metadata: &BTreeMap<String, ColumnInfo>,
    values: &BTreeMap<String, Value>,
    columns: &[String],
) -> Result<String, String> {
    let mut predicates = Vec::with_capacity(columns.len());
    for column_name in columns {
        let column = column_for(metadata, column_name)?;
        let value = values.get(column_name).ok_or_else(|| {
            format!("Data synchronization row is missing selected column {column_name}")
        })?;
        let identifier = kind.quote_identifier(column_name);
        if value.is_null() {
            predicates.push(format!("{identifier} IS NULL"));
        } else {
            predicates.push(format!(
                "{identifier} = {}",
                data_compare_sync_literal(dialect, column, value)
            ));
        }
    }
    if predicates.is_empty() {
        Err("Data synchronization snapshot produced no predicates".to_string())
    } else {
        Ok(predicates.join(" AND "))
    }
}

pub(super) fn build_table_data_compare_sync_statements(
    request: &TableDataCompareSyncPreviewRequest,
    kind: DatabaseKind,
    dialect: SqlExportDialect,
    metadata: &BTreeMap<String, ColumnInfo>,
    columns: &[String],
    key_columns: &[String],
) -> Result<(Vec<String>, u64), String> {
    for column in columns {
        column_for(metadata, column)?;
    }
    for key in key_columns {
        let column = column_for(metadata, key)?;
        if column.is_nullable {
            return Err(format!(
                "Data synchronization key column {key} must be NOT NULL"
            ));
        }
    }
    if !data_compare_key_columns_are_declared_unique(metadata, key_columns) {
        return Err(
            "Data synchronization requires keys declared unique on the target table".to_string(),
        );
    }

    let relation =
        kind.qualified_table(schema_option(&request.target.schema), &request.target.table);
    let writable_columns = columns
        .iter()
        .filter(|column| {
            metadata.get(*column).is_some_and(|column| {
                column.is_generated != Some(true) && column.is_hidden != Some(true)
            })
        })
        .collect::<Vec<_>>();
    let mut statements = Vec::new();

    for row in &request.comparison.added {
        for column in columns {
            if !row.values.contains_key(column) {
                return Err(format!(
                    "Inserted synchronization row is missing selected column {column}"
                ));
            }
        }
        let values = writable_columns
            .iter()
            .filter_map(|column| {
                row.values
                    .get(*column)
                    .map(|value| ((*column).clone(), value.clone()))
            })
            .collect::<BTreeMap<_, _>>();
        validate_insert_values(metadata, &values)?;
        if values.is_empty() {
            statements.push(match kind {
                DatabaseKind::Mysql => format!("INSERT INTO {relation} () VALUES ();"),
                DatabaseKind::Postgres => format!("INSERT INTO {relation} DEFAULT VALUES;"),
            });
            continue;
        }
        let names = writable_columns
            .iter()
            .filter(|column| values.contains_key(column.as_str()))
            .map(|column| kind.quote_identifier(column))
            .collect::<Vec<_>>();
        let literals = writable_columns
            .iter()
            .filter_map(|column| {
                let value = values.get(column.as_str())?;
                let metadata = metadata.get(column.as_str())?;
                Some(data_compare_sync_literal(dialect, metadata, value))
            })
            .collect::<Vec<_>>();
        statements.push(format!(
            "INSERT INTO {relation} ({}) VALUES ({});",
            names.join(", "),
            literals.join(", ")
        ));
    }

    let mut skipped_generated_updates = 0_u64;
    for row in &request.comparison.modified {
        let mut assignments = Vec::new();
        for column in &row.changed_columns {
            if !columns.contains(column) {
                return Err(format!(
                    "Modified synchronization row references an unselected column {column}"
                ));
            }
            if key_columns.contains(column) {
                return Err(format!(
                    "Data synchronization cannot modify key column {column}"
                ));
            }
            let column_metadata = metadata
                .get(column)
                .ok_or_else(|| format!("Target metadata is missing changed column {column}"))?;
            let value = row.source_values.get(column).ok_or_else(|| {
                format!("Modified synchronization row is missing source column {column}")
            })?;
            if column_metadata.is_generated == Some(true) || column_metadata.is_hidden == Some(true)
            {
                continue;
            }
            assignments.push(format!(
                "{} = {}",
                kind.quote_identifier(column),
                data_compare_sync_literal(dialect, column_metadata, value)
            ));
        }
        if assignments.is_empty() {
            skipped_generated_updates += 1;
            continue;
        }
        for key in key_columns {
            let source_key = row.source_values.get(key).ok_or_else(|| {
                format!("Modified synchronization row is missing source key column {key}")
            })?;
            let target_key = row.target_values.get(key).ok_or_else(|| {
                format!("Modified synchronization row is missing target key column {key}")
            })?;
            if source_key.is_null() || source_key != target_key {
                return Err(format!(
                    "Data synchronization key column {key} changed or contains NULL"
                ));
            }
        }
        let predicate = data_compare_sync_snapshot_predicate(
            kind,
            dialect,
            metadata,
            &row.target_values,
            columns,
        )?;
        statements.push(format!(
            "UPDATE {relation} SET {} WHERE {predicate};",
            assignments.join(", ")
        ));
    }

    for row in &request.comparison.removed {
        let predicate =
            data_compare_sync_snapshot_predicate(kind, dialect, metadata, &row.values, columns)?;
        statements.push(format!("DELETE FROM {relation} WHERE {predicate};"));
    }
    Ok((statements, skipped_generated_updates))
}

pub(super) fn data_compare_sync_parameterized_snapshot_predicate(
    kind: DatabaseKind,
    metadata: &BTreeMap<String, ColumnInfo>,
    values: &BTreeMap<String, Value>,
    columns: &[String],
    params: &mut Vec<QueryParameter>,
) -> Result<String, String> {
    let mut predicates = Vec::with_capacity(columns.len());
    for column_name in columns {
        let column = column_for(metadata, column_name)?;
        let value = values.get(column_name).ok_or_else(|| {
            format!("Data synchronization row is missing selected column {column_name}")
        })?;
        let identifier = kind.quote_identifier(column_name);
        if value.is_null() {
            predicates.push(format!("{identifier} IS NULL"));
        } else {
            let placeholder = kind.parameter_placeholder(params.len() + 1, &column.data_type);
            predicates.push(format!("{identifier} = {placeholder}"));
            params.push(query_parameter(column, value));
        }
    }
    if predicates.is_empty() {
        Err("Data synchronization snapshot produced no predicates".to_string())
    } else {
        Ok(predicates.join(" AND "))
    }
}

pub(super) fn build_table_data_compare_sync_parameterized_statements(
    request: &TableDataCompareSyncPreviewRequest,
    kind: DatabaseKind,
    metadata: &BTreeMap<String, ColumnInfo>,
    columns: &[String],
    key_columns: &[String],
) -> Result<(Vec<ParameterizedStatement>, u64), String> {
    let relation =
        kind.qualified_table(schema_option(&request.target.schema), &request.target.table);
    let writable_columns = columns
        .iter()
        .filter_map(|column_name| {
            metadata.get(column_name).and_then(|column| {
                (column.is_generated == Some(false) && column.is_hidden == Some(false))
                    .then_some(column_name)
            })
        })
        .collect::<Vec<_>>();
    for column_name in columns {
        let column = column_for(metadata, column_name)?;
        if column.is_generated.is_none() || column.is_hidden.is_none() {
            return Err(format!(
                "Column {column_name} cannot be synchronized because generated/hidden metadata is unavailable"
            ));
        }
    }

    let mut statements = Vec::new();
    for row in &request.comparison.added {
        let values = writable_columns
            .iter()
            .map(|column_name| {
                row.values
                    .get(*column_name)
                    .cloned()
                    .map(|value| ((*column_name).clone(), value))
                    .ok_or_else(|| {
                        format!(
                            "Inserted synchronization row is missing selected column {column_name}"
                        )
                    })
            })
            .collect::<Result<BTreeMap<_, _>, _>>()?;
        let (sql, params) = build_insert_mutation(
            kind,
            &request.target.schema,
            &request.target.table,
            metadata,
            &values,
        )?;
        statements.push(ParameterizedStatement { sql, params });
    }

    let mut skipped_generated_updates = 0_u64;
    for row in &request.comparison.modified {
        for key in key_columns {
            let source_key = row.source_values.get(key).ok_or_else(|| {
                format!("Modified synchronization row is missing source key column {key}")
            })?;
            let target_key = row.target_values.get(key).ok_or_else(|| {
                format!("Modified synchronization row is missing target key column {key}")
            })?;
            if source_key.is_null() || source_key != target_key {
                return Err(format!(
                    "Data synchronization key column {key} changed or contains NULL"
                ));
            }
        }
        let mut params = Vec::new();
        let mut assignments = Vec::new();
        for column_name in &row.changed_columns {
            if !columns.contains(column_name) {
                return Err(format!(
                    "Modified synchronization row references an unselected column {column_name}"
                ));
            }
            if key_columns.contains(column_name) {
                return Err(format!(
                    "Data synchronization cannot modify key column {column_name}"
                ));
            }
            let column = column_for(metadata, column_name)?;
            if column.is_generated == Some(true) || column.is_hidden == Some(true) {
                continue;
            }
            let column = writable_column_for(metadata, column_name)?;
            let value = row.source_values.get(column_name).ok_or_else(|| {
                format!("Modified synchronization row is missing source column {column_name}")
            })?;
            let placeholder = kind.parameter_placeholder(params.len() + 1, &column.data_type);
            assignments.push(format!(
                "{} = {placeholder}",
                kind.quote_identifier(column_name)
            ));
            params.push(query_parameter(column, value));
        }
        if assignments.is_empty() {
            skipped_generated_updates += 1;
            continue;
        }
        let predicate = data_compare_sync_parameterized_snapshot_predicate(
            kind,
            metadata,
            &row.target_values,
            columns,
            &mut params,
        )?;
        statements.push(ParameterizedStatement {
            sql: format!(
                "UPDATE {relation} SET {} WHERE {predicate};",
                assignments.join(", ")
            ),
            params,
        });
    }

    for row in &request.comparison.removed {
        let mut params = Vec::new();
        let predicate = data_compare_sync_parameterized_snapshot_predicate(
            kind,
            metadata,
            &row.values,
            columns,
            &mut params,
        )?;
        statements.push(ParameterizedStatement {
            sql: format!("DELETE FROM {relation} WHERE {predicate};"),
            params,
        });
    }
    Ok((statements, skipped_generated_updates))
}

#[tauri::command]
pub async fn preview_table_data_compare_sync(
    manager: State<'_, ConnectionManager>,
    plans: State<'_, TableDataCompareSyncPlanState>,
    request: TableDataCompareSyncPreviewRequest,
) -> Result<Response<TableDataCompareSyncPreview>, String> {
    let result: Result<TableDataCompareSyncPreview, String> = async {
        let (columns, key_columns) = validate_table_data_compare_sync_preview(&request)?;
        let endpoint = data_compare_transfer_endpoint(&request.target);
        ensure_transfer_endpoint_driver_matches_connection(&manager, &endpoint).await?;
        let kind = table_data_transfer_dialect(&manager, &endpoint).await?;
        ensure_target_relation_operation_allowed(
            &manager,
            &request.target.connection_id,
            request.target.database.as_deref(),
            &request.target.schema,
            &request.target.table,
            RelationOperation::DataMutation,
        )
        .await?;
        let metadata = get_target_columns(
            &manager,
            &request.target.connection_id,
            request.target.database.as_deref(),
            &request.target.schema,
            &request.target.table,
        )
        .await
        .map(column_lookup)
        .map_err(|error| error.to_string())?;
        let dialect = sql_export_dialect(&request.target.driver, kind);
        let (statements, skipped_generated_updates) =
            build_table_data_compare_sync_statements(
                &request,
                kind,
                dialect,
                &metadata,
                &columns,
                &key_columns,
            )?;
        let (parameterized_statements, parameterized_skipped_updates) =
            build_table_data_compare_sync_parameterized_statements(
                &request,
                kind,
                &metadata,
                &columns,
                &key_columns,
            )?;
        if parameterized_skipped_updates != skipped_generated_updates
            || parameterized_statements.len() != statements.len()
        {
            return Err(
                "Synchronization review and parameterized execution plans diverged".to_string(),
            );
        }
        let transaction_start = if dialect == SqlExportDialect::Mysql {
            "START TRANSACTION;"
        } else {
            "BEGIN;"
        };
        let mut script_parts = Vec::with_capacity(statements.len() + 3);
        script_parts.push(
            "-- Review-only synchronization script generated from an exact, untruncated comparison."
                .to_string(),
        );
        script_parts.push(transaction_start.to_string());
        script_parts.extend(statements.iter().cloned());
        script_parts.push("COMMIT;".to_string());
        let sql = script_parts.join("\n");
        if sql.len() > MAX_DATA_COMPARE_SYNC_SQL_BYTES {
            return Err(format!(
                "Data synchronization SQL exceeds the {} MiB review limit",
                MAX_DATA_COMPARE_SYNC_SQL_BYTES / (1024 * 1024)
            ));
        }
        let metadata_digest = table_data_compare_sync_metadata_digest(&metadata)?;
        let digest_input = serde_json::json!({
            "target": &request.target,
            "columns": &columns,
            "keyColumns": &key_columns,
            "sql": &sql,
            "metadataDigest": &metadata_digest,
            "parameterizedStatements": &parameterized_statements,
        });
        let digest = format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&digest_input).map_err(|error| error.to_string())?)
        );
        let update_count = request
            .comparison
            .modified_count
            .saturating_sub(skipped_generated_updates);
        let confirmation_text = table_data_compare_sync_confirmation_text(
            &request.target,
            request.comparison.removed_count,
        );
        let frozen_plan = FrozenTableDataCompareSyncPlan {
            target: request.target.clone(),
            metadata_digest,
            statements: parameterized_statements,
            insert_count: request.comparison.added_count,
            update_count,
            delete_count: request.comparison.removed_count,
            plan_digest: digest.clone(),
            confirmation_text: confirmation_text.clone(),
            expires_at: 0,
        };
        let (plan_token, expires_at) = plans.issue(frozen_plan).await;
        let mut warnings = vec![
            "The SQL is a review artifact. Oxide executes only the Host-frozen parameterized plan after the exact confirmation phrase; the preview SQL is never submitted back for execution."
                .to_string(),
            "Every UPDATE and DELETE is bound to the compared target snapshot. Target drift, schema drift, expiry, replay, or an unexpected affected-row count rolls the entire transaction back."
                .to_string(),
        ];
        if skipped_generated_updates > 0 {
            warnings.push(format!(
                "{skipped_generated_updates} modified row(s) changed only generated or hidden columns and produced no UPDATE statement."
            ));
        }
        Ok(TableDataCompareSyncPreview {
            insert_count: request.comparison.added_count,
            update_count,
            delete_count: request.comparison.removed_count,
            statement_count: statements.len() as u64,
            statements,
            sql,
            plan_digest: digest,
            review_only: true,
            can_execute: true,
            plan_token,
            expires_at,
            confirmation_text,
            warnings,
        })
    }
    .await;
    Ok(match result {
        Ok(plan) => Response::ok(plan),
        Err(error) => Response::err("PREVIEW_TABLE_DATA_COMPARE_SYNC_ERROR", &error),
    })
}

pub(super) async fn execute_frozen_table_data_compare_sync(
    manager: &ConnectionManager,
    plan: FrozenTableDataCompareSyncPlan,
) -> Result<TableDataCompareSyncReceipt, String> {
    let endpoint = data_compare_transfer_endpoint(&plan.target);
    ensure_transfer_endpoint_driver_matches_connection(manager, &endpoint).await?;
    ensure_target_relation_operation_allowed(
        manager,
        &plan.target.connection_id,
        plan.target.database.as_deref(),
        &plan.target.schema,
        &plan.target.table,
        RelationOperation::DataMutation,
    )
    .await?;
    let metadata = get_target_columns(
        manager,
        &plan.target.connection_id,
        plan.target.database.as_deref(),
        &plan.target.schema,
        &plan.target.table,
    )
    .await
    .map(column_lookup)
    .map_err(|error| error.to_string())?;
    if table_data_compare_sync_metadata_digest(&metadata)? != plan.metadata_digest {
        return Err(
            "Target table metadata changed after preview. Compare and preview again before writing."
                .to_string(),
        );
    }
    let expected_statement_count = plan
        .insert_count
        .saturating_add(plan.update_count)
        .saturating_add(plan.delete_count);
    if plan.statements.len() as u64 != expected_statement_count {
        return Err("Frozen synchronization plan has inconsistent operation counts".to_string());
    }

    let transaction_id = format!("table-compare-sync-{}", uuid::Uuid::new_v4());
    match plan.target.database.as_deref() {
        Some(database) => {
            manager
                .begin_database_transaction(
                    &plan.target.connection_id,
                    &transaction_id,
                    database,
                    schema_option(&plan.target.schema).map(str::to_string),
                )
                .await
        }
        None => {
            manager
                .begin_transaction(
                    &plan.target.connection_id,
                    &transaction_id,
                    schema_option(&plan.target.schema).map(str::to_string),
                )
                .await
        }
    }
    .map_err(|error| format!("Could not start synchronization transaction: {error}"))?;

    let mut commit_attempted = false;
    let execution = async {
        let affected = manager
            .execute_parameterized_transaction(
                &plan.target.connection_id,
                &transaction_id,
                &plan.statements,
            )
            .await
            .map_err(|error| format!("Synchronization transaction failed: {error}"))?;
        if affected.len() != plan.statements.len()
            || affected.iter().any(|rows_affected| *rows_affected != 1)
        {
            return Err(format!(
                "Target data changed after comparison: expected one affected row for each of {} operation(s), but the database returned {:?}. The transaction was not committed.",
                plan.statements.len(),
                affected
            ));
        }
        commit_attempted = true;
        manager
            .commit_transaction(&plan.target.connection_id, &transaction_id)
            .await
            .map_err(|error| format!("Could not commit synchronization transaction: {error}"))?;
        Ok(TableDataCompareSyncReceipt {
            insert_count: plan.insert_count,
            update_count: plan.update_count,
            delete_count: plan.delete_count,
            rows_affected: expected_statement_count,
            plan_digest: plan.plan_digest.clone(),
        })
    }
    .await;

    if let Err(execution_error) = &execution {
        let rollback = manager
            .rollback_transaction(&plan.target.connection_id, &transaction_id)
            .await;
        if commit_attempted {
            let rollback_status = rollback
                .map(|_| {
                    "A rollback was requested, but it cannot prove whether the commit took effect."
                        .to_string()
                })
                .unwrap_or_else(|error| format!("Rollback also failed: {error}."));
            return Err(format!(
                "{execution_error} The commit outcome is unknown. {rollback_status} Verify the target manually and do not retry automatically."
            ));
        }
        if let Err(rollback_error) = rollback {
            return Err(format!(
                "{execution_error} Rollback could not be confirmed: {rollback_error}. Verify the target manually before retrying."
            ));
        }
    }
    execution
}

#[tauri::command]
pub async fn execute_table_data_compare_sync(
    manager: State<'_, ConnectionManager>,
    plans: State<'_, TableDataCompareSyncPlanState>,
    request: ExecuteTableDataCompareSyncRequest,
) -> Result<Response<TableDataCompareSyncReceipt>, String> {
    let plan = match plans.consume(&request.plan_token).await {
        Ok(plan) => plan,
        Err(error) => {
            return Ok(Response::err(
                "TABLE_DATA_COMPARE_SYNC_PLAN_UNAVAILABLE",
                &error,
            ))
        }
    };
    if request.plan_digest.trim() != plan.plan_digest {
        return Ok(Response::err(
            "TABLE_DATA_COMPARE_SYNC_PLAN_CHANGED",
            "Synchronization plan digest does not match the Host-frozen plan. Compare and preview again.",
        ));
    }
    if request.confirmation_text.trim() != plan.confirmation_text {
        return Ok(Response::err(
            "TABLE_DATA_COMPARE_SYNC_CONFIRMATION_REQUIRED",
            "The synchronization confirmation phrase does not match exactly.",
        ));
    }

    let target_connection = plan.target.connection_id.clone();
    let target_table = plan.target.table.clone();
    let plan_digest = plan.plan_digest.clone();
    let result = execute_frozen_table_data_compare_sync(&manager, plan).await;
    match result {
        Ok(receipt) => {
            tracing::info!(
                connection_id = %target_connection,
                table = %target_table,
                plan_digest = %plan_digest,
                rows_affected = receipt.rows_affected,
                "executed frozen table comparison synchronization plan"
            );
            Ok(Response::ok(receipt))
        }
        Err(error) => Ok(Response::err(
            "EXECUTE_TABLE_DATA_COMPARE_SYNC_ERROR",
            &error,
        )),
    }
}
