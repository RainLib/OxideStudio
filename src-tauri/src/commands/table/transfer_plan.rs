//! Transfer plan for table operations.

use super::access::{ensure_target_relation_operation_allowed, get_target_columns, query_target};
use super::policy::{
    resolve_transfer_target_column_quoting, schema_option, table_data_transfer_dialect,
    RelationOperation,
};
use super::row_sql::{build_table_order_by, column_lookup};
use super::transfer_identity::{
    postgres_identity_reseed_columns, resolve_postgres_identity_reseed_plans,
};
use super::transfer_mapping::{
    apply_transfer_conversion, build_data_transfer_column_mapping, transfer_plan_can_execute,
    transfer_type_mapping_warnings,
};
use super::transfer_runtime::{
    normalized_transfer_batch_size, normalized_transfer_driver_id, normalized_transfer_limit,
    resolve_table_data_transfer_plan_isolated, validate_table_data_transfer_id,
    validate_table_data_transfer_overwrite_rows,
};
use super::transfer_schema::resolve_transfer_schema_restore_plan;
use super::transfer_types::{
    TableDataTransferColumnMapping, TableDataTransferEndpoint, TableDataTransferIdentityReseedPlan,
    TableDataTransferMode, TableDataTransferPreview, TableDataTransferRequest,
};
use super::values::value_to_u64;
use crate::core::dialect::DatabaseKind;
use crate::core::manager::ConnectionManager;
use crate::core::protocol::ColumnInfo;
use crate::core::protocol::QueryResult;
use crate::core::protocol::Response;
use serde_json::Value;
use sha2::Digest;
use sha2::Sha256;
use std::collections::BTreeMap;
use tauri::State;

#[derive(Debug, Clone)]
pub(super) struct ResolvedTableDataTransferPlan {
    pub(super) source_kind: DatabaseKind,
    pub(super) target_kind: DatabaseKind,
    pub(super) quote_target_column_names: bool,
    pub(super) mapped_columns: Vec<TableDataTransferColumnMapping>,
    pub(super) skipped_source_columns: Vec<String>,
    pub(super) source_columns: BTreeMap<String, ColumnInfo>,
    pub(super) target_columns: BTreeMap<String, ColumnInfo>,
    pub(super) max_rows: u32,
    pub(super) batch_size: u32,
    pub(super) target_rows_before: Option<u64>,
    pub(super) target_rows_to_delete: Option<u64>,
    pub(super) upsert_key_columns: Vec<String>,
    pub(super) identity_reseed_columns: Vec<String>,
    pub(super) identity_reseed_plans: Vec<TableDataTransferIdentityReseedPlan>,
    pub(super) schema_restore_statements: Vec<String>,
    pub(super) immediate_schema_restore_statements: Vec<String>,
    pub(super) deferred_foreign_key_statements: Vec<String>,
    pub(super) deferred_foreign_key_names: Vec<String>,
    pub(super) confirmation_token: String,
    pub(super) warnings: Vec<String>,
}

pub(super) fn resolve_transfer_upsert_key_columns(
    mode: TableDataTransferMode,
    target_is_external: bool,
    target_columns: &[ColumnInfo],
    mapped_columns: &[TableDataTransferColumnMapping],
) -> Result<Vec<String>, String> {
    if mode != TableDataTransferMode::Upsert {
        return Ok(Vec::new());
    }
    if target_is_external {
        return Err(
            "Upsert is not available for external driver packages until the signed protocol declares semantic conflict-write support."
                .to_string(),
        );
    }
    let keys = target_columns
        .iter()
        .filter(|column| column.is_primary_key)
        .map(|column| column.name.clone())
        .collect::<Vec<_>>();
    if keys.is_empty() {
        return Err("Upsert requires a declared primary key on the target table.".to_string());
    }
    let missing = keys
        .iter()
        .filter(|key| {
            !mapped_columns
                .iter()
                .any(|mapping| mapping.target.eq_ignore_ascii_case(key))
        })
        .cloned()
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return Err(format!(
            "Upsert requires every target primary-key column to be mapped: {}.",
            missing.join(", ")
        ));
    }
    Ok(keys)
}

pub(super) async fn ensure_transfer_endpoint_driver_matches_connection(
    manager: &ConnectionManager,
    endpoint: &TableDataTransferEndpoint,
) -> Result<(), String> {
    let Some(connected_driver) = manager
        .connection_driver_id(&endpoint.connection_id)
        .await
        .map_err(|error| error.to_string())?
    else {
        // Programmatic legacy/test connections may not carry an identity.
        // Their driver remains the execution authority; preserve that path
        // while all desktop-opened connections receive the stronger binding.
        return Ok(());
    };
    let requested_driver = normalized_transfer_driver_id(&endpoint.driver);
    if connected_driver != requested_driver {
        return Err(format!(
            "Transfer endpoint driver '{}' does not match the connected driver '{}'. Refresh the connection and preview again.",
            endpoint.driver.trim(), connected_driver
        ));
    }
    Ok(())
}

pub(super) fn endpoint_label(endpoint: &TableDataTransferEndpoint) -> String {
    let namespace = endpoint
        .database
        .as_deref()
        .filter(|database| !database.trim().is_empty())
        .map(|database| format!("{database}."))
        .unwrap_or_default();
    let schema = schema_option(&endpoint.schema)
        .map(|schema| format!("{schema}."))
        .unwrap_or_default();
    format!("{}{}{}", namespace, schema, endpoint.table.trim())
}

pub(super) struct TableDataTransferConfirmationBinding<'a> {
    pub(super) mapped_columns: &'a [TableDataTransferColumnMapping],
    pub(super) max_rows: u32,
    pub(super) batch_size: u32,
    pub(super) target_rows_before: Option<u64>,
    pub(super) target_rows_to_delete: Option<u64>,
    pub(super) upsert_key_columns: &'a [String],
    pub(super) identity_reseed_plans: &'a [TableDataTransferIdentityReseedPlan],
    pub(super) schema_restore_statements: &'a [String],
}

pub(super) fn transfer_confirmation_token(
    request: &TableDataTransferRequest,
    binding: &TableDataTransferConfirmationBinding<'_>,
) -> Result<String, String> {
    let binding = serde_json::json!({
        "transferId": &request.transfer_id,
        "source": &request.source,
        "target": &request.target,
        "mode": request.mode,
        "mappedColumns": binding.mapped_columns,
        "maxRows": binding.max_rows,
        "batchSize": binding.batch_size,
        "targetRowsBefore": binding.target_rows_before,
        "targetRowsToDelete": binding.target_rows_to_delete,
        "upsertKeyColumns": binding.upsert_key_columns,
        "reseedIdentity": request.reseed_identity,
        "quoteTargetColumnNames": request.quote_target_column_names,
        "identityReseedPlans": binding.identity_reseed_plans,
        "restoreSourceSchemaObjects": request.restore_source_schema_objects,
        "schemaRestoreStatements": binding.schema_restore_statements,
    });
    let encoded = serde_json::to_vec(&binding).map_err(|error| error.to_string())?;
    let digest = format!("{:x}", Sha256::digest(encoded));
    Ok(format!("TRANSFER {}", digest[..8].to_ascii_uppercase()))
}

pub(super) async fn resolve_table_data_transfer_plan(
    manager: &ConnectionManager,
    request: &TableDataTransferRequest,
) -> Result<ResolvedTableDataTransferPlan, String> {
    validate_table_data_transfer_id(&request.transfer_id)?;
    if request.source.connection_id.trim().is_empty()
        || request.target.connection_id.trim().is_empty()
    {
        return Err("Source and target connections are required".to_string());
    }
    if request.source.table.trim().is_empty() || request.target.table.trim().is_empty() {
        return Err("Source and target tables are required".to_string());
    }
    ensure_transfer_endpoint_driver_matches_connection(manager, &request.source).await?;
    ensure_transfer_endpoint_driver_matches_connection(manager, &request.target).await?;
    let source_kind = table_data_transfer_dialect(manager, &request.source).await?;
    let target_kind = table_data_transfer_dialect(manager, &request.target).await?;
    let quote_target_column_names = resolve_transfer_target_column_quoting(
        manager,
        &request.target,
        request.quote_target_column_names,
    )
    .await?;
    if request.source.connection_id == request.target.connection_id
        && request.source.database == request.target.database
        && request.source.schema == request.target.schema
        && request.source.table == request.target.table
    {
        return Err("Source and target tables must be different".to_string());
    }

    ensure_target_relation_operation_allowed(
        manager,
        &request.target.connection_id,
        request.target.database.as_deref(),
        &request.target.schema,
        &request.target.table,
        RelationOperation::DataMutation,
    )
    .await?;

    let source_columns = get_target_columns(
        manager,
        &request.source.connection_id,
        request.source.database.as_deref(),
        &request.source.schema,
        &request.source.table,
    )
    .await
    .map_err(|error| error.to_string())?;
    let target_columns = get_target_columns(
        manager,
        &request.target.connection_id,
        request.target.database.as_deref(),
        &request.target.schema,
        &request.target.table,
    )
    .await
    .map_err(|error| error.to_string())?;
    let (mapped_columns, skipped_source_columns) =
        build_data_transfer_column_mapping(&source_columns, &target_columns)?;
    let target_is_external = manager
        .is_external_driver_connection(&request.target.connection_id)
        .await
        .map_err(|error| error.to_string())?;
    let upsert_key_columns = resolve_transfer_upsert_key_columns(
        request.mode,
        target_is_external,
        &target_columns,
        &mapped_columns,
    )?;
    let identity_reseed_columns =
        postgres_identity_reseed_columns(target_kind, &target_columns, request.reseed_identity)?;
    let identity_reseed_plans =
        resolve_postgres_identity_reseed_plans(manager, &request.target, &identity_reseed_columns)
            .await?;
    let schema_restore_plan = resolve_transfer_schema_restore_plan(
        manager,
        request,
        source_kind,
        target_kind,
        &target_columns,
    )
    .await?;
    let max_rows = normalized_transfer_limit(request.max_rows);
    let batch_size = normalized_transfer_batch_size(request.batch_size);
    let target_rows_before = if matches!(
        request.mode,
        TableDataTransferMode::Append | TableDataTransferMode::Overwrite
    ) {
        let count_sql = target_kind.count_table_query(
            schema_option(&request.target.schema),
            &request.target.table,
            None,
        );
        let results = query_target(
            manager,
            &request.target.connection_id,
            request.target.database.as_deref(),
            &count_sql,
        )
        .await
        .map_err(|error| error.to_string())?;
        let count = results
            .first()
            .and_then(|result| result.rows.first())
            .and_then(|row| row.first())
            .and_then(value_to_u64)
            .ok_or_else(|| {
                "Target row count could not be verified for overwrite mode".to_string()
            })?;
        Some(if request.mode == TableDataTransferMode::Overwrite {
            validate_table_data_transfer_overwrite_rows(count)?
        } else {
            count
        })
    } else {
        None
    };
    let target_rows_to_delete = if request.mode == TableDataTransferMode::Overwrite {
        target_rows_before
    } else {
        None
    };
    let confirmation_token = transfer_confirmation_token(
        request,
        &TableDataTransferConfirmationBinding {
            mapped_columns: &mapped_columns,
            max_rows,
            batch_size,
            target_rows_before,
            target_rows_to_delete,
            upsert_key_columns: &upsert_key_columns,
            identity_reseed_plans: &identity_reseed_plans,
            schema_restore_statements: &schema_restore_plan.statements,
        },
    )?;

    let mut warnings = vec![match request.mode {
        TableDataTransferMode::Overwrite => format!(
            "Overwrite mode deletes {count} existing row(s) from {} inside the same target transaction before inserting source rows.",
            endpoint_label(&request.target),
            count = target_rows_to_delete.unwrap_or_default(),
        ),
        TableDataTransferMode::Upsert => format!(
            "Upsert mode inserts new rows and updates conflicts in {} using target primary key ({}).",
            endpoint_label(&request.target),
            upsert_key_columns.join(", ")
        ),
        TableDataTransferMode::Append => format!(
            "Append mode adds rows to {} and does not delete or update existing rows. The reviewed target baseline is {count} row(s); post-commit verification expects the baseline plus copied rows.",
            endpoint_label(&request.target),
            count = target_rows_before.unwrap_or_default(),
        ),
    }];
    if request.mode == TableDataTransferMode::Upsert && !request.reseed_identity {
        warnings.push(
            "Explicit identity values are copied, but database sequences/identity generators are not reseeded by this transfer. Review the target generator before later inserts."
                .to_string(),
        );
    }
    if request.reseed_identity {
        if identity_reseed_columns.is_empty() {
            warnings.push("Identity reseed was requested, but the PostgreSQL target exposes no serial/identity column to synchronize.".to_string());
        } else {
            warnings.push(format!(
                "After data writes, the reviewed PostgreSQL generator(s) {} will be synchronized inside the same target transaction.",
                identity_reseed_plans
                    .iter()
                    .map(|plan| format!(
                        "{}.{} for {}",
                        plan.sequence_schema, plan.sequence_name, plan.column
                    ))
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
    }
    if request.restore_source_schema_objects {
        if source_kind != target_kind {
            warnings.push(
                "Cross-product schema restoration uses only structured ordinary BTREE indexes, UNIQUE constraints, and foreign keys. Source DDL text, CHECK expressions, expression/partial indexes, included columns, comments, and non-BTREE methods remain blocked."
                    .to_string(),
            );
        }
        warnings.push(if schema_restore_plan.statements.is_empty() {
            "Catalog-backed secondary indexes and constraints are already present on the target; no post-copy DDL is required."
                .to_string()
        } else if target_kind == DatabaseKind::Mysql {
            format!(
                "After the row transaction commits, {} reviewed MySQL secondary index/constraint statement(s) will run one at a time; foreign keys run last. A failure produces a partial-completion receipt, requires manual target inspection, and disables automatic retry.",
                schema_restore_plan.statements.len()
            )
        } else {
            format!(
                "After all row writes, {} reviewed secondary index/constraint statement(s) will run inside the same target transaction; foreign keys run last.",
                schema_restore_plan.statements.len()
            )
        });
    }
    if !skipped_source_columns.is_empty() {
        warnings.push(format!(
            "Source values are not written for matching target-owned generated or hidden columns: {}.",
            skipped_source_columns.join(", ")
        ));
    }
    if !quote_target_column_names {
        warnings.push(
            "GaussDB/openGauss target column quoting is disabled. Safe identifiers are emitted unquoted and therefore fold according to the target server; reserved or unsafe names remain quoted."
                .to_string(),
        );
    }
    warnings.extend(transfer_type_mapping_warnings(&mapped_columns));
    warnings.push(format!(
        "Each run is bounded to {max_rows} rows, writes batches of at most {batch_size} rows, and commits the target only after every batch succeeds."
    ));

    Ok(ResolvedTableDataTransferPlan {
        source_kind,
        target_kind,
        quote_target_column_names,
        mapped_columns,
        skipped_source_columns,
        source_columns: column_lookup(source_columns),
        target_columns: column_lookup(target_columns),
        max_rows,
        batch_size,
        target_rows_before,
        target_rows_to_delete,
        upsert_key_columns,
        identity_reseed_columns,
        identity_reseed_plans,
        schema_restore_statements: schema_restore_plan.statements,
        immediate_schema_restore_statements: schema_restore_plan.immediate_statements,
        deferred_foreign_key_statements: schema_restore_plan.deferred_foreign_key_statements,
        deferred_foreign_key_names: schema_restore_plan.deferred_foreign_key_names,
        confirmation_token,
        warnings,
    })
}

pub(super) fn map_transfer_result_rows(
    result: &QueryResult,
    plan: &ResolvedTableDataTransferPlan,
) -> Result<Vec<BTreeMap<String, Value>>, String> {
    let indices = plan
        .mapped_columns
        .iter()
        .map(|mapping| {
            result
                .columns
                .iter()
                .position(|column| column.name.eq_ignore_ascii_case(&mapping.source))
                .ok_or_else(|| {
                    format!(
                        "Source query did not return the mapped column {}",
                        mapping.source
                    )
                })
                .map(|index| (mapping, index))
        })
        .collect::<Result<Vec<_>, _>>()?;

    result
        .rows
        .iter()
        .map(|row| {
            indices
                .iter()
                .map(|(mapping, index)| {
                    row.get(*index)
                        .ok_or_else(|| "Source row is shorter than its column metadata".to_string())
                        .and_then(|value| apply_transfer_conversion(mapping, value))
                        .map(|value| (mapping.target.clone(), value))
                })
                .collect()
        })
        .collect()
}

#[tauri::command]
pub async fn preview_table_data_transfer(
    manager: State<'_, ConnectionManager>,
    request: TableDataTransferRequest,
) -> Result<Response<TableDataTransferPreview>, String> {
    let result: Result<TableDataTransferPreview, String> = async {
        let plan = resolve_table_data_transfer_plan_isolated(&manager, &request).await?;
        let preview_limit = plan.max_rows.min(100);
        let order = build_table_order_by(plan.source_kind, &plan.source_columns, None)?;
        let sql = plan.source_kind.paged_table_query_with_order(
            schema_option(&request.source.schema),
            &request.source.table,
            None,
            order.as_deref(),
            preview_limit,
            0,
        );
        let mut results = query_target(
            &manager,
            &request.source.connection_id,
            request.source.database.as_deref(),
            &sql,
        )
        .await
        .map_err(|error| error.to_string())?;
        let source_result = results
            .drain(..)
            .next()
            .unwrap_or_else(|| QueryResult::rows(Vec::new(), Vec::new()));
        let can_execute = transfer_plan_can_execute(&plan.mapped_columns);
        if can_execute {
            // Exercise the same bounded conversion path that execution uses;
            // preview must prove more than a source row count.
            map_transfer_result_rows(&source_result, &plan)?;
        }
        let preview_rows = source_result.rows.len() as u32;

        Ok(TableDataTransferPreview {
            mode: request.mode,
            mapped_columns: plan.mapped_columns,
            skipped_source_columns: plan.skipped_source_columns,
            preview_rows,
            max_rows: plan.max_rows,
            batch_size: plan.batch_size,
            target_rows_before: plan.target_rows_before,
            target_rows_to_delete: plan.target_rows_to_delete,
            upsert_key_columns: plan.upsert_key_columns,
            identity_reseed_columns: plan.identity_reseed_columns,
            identity_reseed_plans: plan.identity_reseed_plans,
            schema_restore_statements: plan.schema_restore_statements,
            can_execute,
            confirmation_token: plan.confirmation_token,
            warnings: plan.warnings,
        })
    }
    .await;

    match result {
        Ok(preview) => Ok(Response::ok(preview)),
        Err(error) => Ok(Response::err("PREVIEW_TABLE_DATA_TRANSFER_ERROR", &error)),
    }
}
