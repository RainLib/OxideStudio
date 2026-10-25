//! Transfer target for table operations.

use super::access::{get_target_columns, query_target};
use super::ddl_columns::build_create_table_statements_with_transfer_metadata;
use super::ddl_types::CreateTableResult;
use super::policy::{ensure_host_table_ddl_allowed, table_data_transfer_dialect};
use super::sqlite_ddl::{is_sqlite_driver, normalized_sqlite_schema};
use super::sqlite_ddl_builders::build_sqlite_create_table_statements_with_defaults;
use super::transfer_mapping::normalized_transfer_type;
use super::transfer_plan::{endpoint_label, ensure_transfer_endpoint_driver_matches_connection};
use super::transfer_runtime::normalized_transfer_driver_id;
use super::transfer_schema::{
    resolve_sqlite_catalog_transfer_target_statements, sqlite_transfer_can_preserve_catalog_schema,
};
use super::transfer_target_columns::{build_transfer_target_columns, TransferTargetColumnsPlan};
use super::transfer_target_types::transfer_target_mapping_profile;
use super::transfer_types::{
    TableDataTransferCompatibility, TableDataTransferEndpoint, TableDataTransferTargetColumn,
    TableDataTransferTargetPlan, TableDataTransferTargetPlanRequest,
};
use crate::core::dialect::DatabaseKind;
use crate::core::manager::ConnectionManager;
use crate::core::protocol::ParameterizedStatement;
use crate::core::protocol::Response;
use sha2::Digest;
use sha2::Sha256;
use std::str::FromStr;
use tauri::State;

pub(super) async fn ensure_transfer_target_table_absent(
    manager: &ConnectionManager,
    endpoint: &TableDataTransferEndpoint,
) -> Result<(), String> {
    let tables = match endpoint.database.as_deref() {
        Some(database) => {
            manager
                .get_database_tables(&endpoint.connection_id, database, &endpoint.schema)
                .await
        }
        None => {
            manager
                .get_tables(&endpoint.connection_id, &endpoint.schema)
                .await
        }
    }
    .map_err(|error| error.to_string())?;
    if tables
        .iter()
        .any(|table| table.name.eq_ignore_ascii_case(endpoint.table.trim()))
    {
        return Err(format!(
            "Target table already exists: {}",
            endpoint_label(endpoint)
        ));
    }
    Ok(())
}

pub(super) fn transfer_target_confirmation_token(
    request: &TableDataTransferTargetPlanRequest,
    columns: &[TableDataTransferTargetColumn],
    statements: &[String],
) -> Result<String, String> {
    let binding = serde_json::json!({
        "source": &request.source,
        "target": &request.target,
        "columns": columns,
        "statements": statements,
    });
    let encoded = serde_json::to_vec(&binding).map_err(|error| error.to_string())?;
    let digest = format!("{:x}", Sha256::digest(encoded));
    Ok(format!("CREATE {}", digest[..8].to_ascii_uppercase()))
}

pub(super) async fn resolve_table_data_transfer_target_plan(
    manager: &ConnectionManager,
    request: &TableDataTransferTargetPlanRequest,
) -> Result<TableDataTransferTargetPlan, String> {
    if request.source.table.trim().is_empty() || request.target.table.trim().is_empty() {
        return Err("Source and target table names are required".to_string());
    }
    ensure_transfer_endpoint_driver_matches_connection(manager, &request.source).await?;
    ensure_transfer_endpoint_driver_matches_connection(manager, &request.target).await?;
    table_data_transfer_dialect(manager, &request.source).await?;
    table_data_transfer_dialect(manager, &request.target).await?;
    ensure_host_table_ddl_allowed(manager, &request.target.connection_id, "creation").await?;
    ensure_transfer_target_table_absent(manager, &request.target).await?;

    let target_driver = normalized_transfer_driver_id(&request.target.driver);
    let source_columns = get_target_columns(
        manager,
        &request.source.connection_id,
        request.source.database.as_deref(),
        &request.source.schema,
        &request.source.table,
    )
    .await
    .map_err(|error| error.to_string())?;
    let source_driver = normalized_transfer_driver_id(&request.source.driver);
    let mapping_profile = transfer_target_mapping_profile(&source_driver, &target_driver);
    let target_columns_plan =
        build_transfer_target_columns(&source_columns, &source_driver, &target_driver)?;
    let TransferTargetColumnsPlan {
        columns,
        create_columns,
        default_expressions,
        identity_generations,
        character_metadata,
        warnings: mut target_column_warnings,
    } = target_columns_plan;
    let can_execute = columns
        .iter()
        .all(|column| column.compatibility != TableDataTransferCompatibility::Unsupported);
    let sqlite_catalog_schema_preserved = if can_execute
        && sqlite_transfer_can_preserve_catalog_schema(&request.source, &request.target)
    {
        !manager
            .is_external_driver_connection(&request.source.connection_id)
            .await
            .map_err(|error| error.to_string())?
            && !manager
                .is_external_driver_connection(&request.target.connection_id)
                .await
                .map_err(|error| error.to_string())?
    } else {
        false
    };
    let statements = if !can_execute {
        Vec::new()
    } else if sqlite_catalog_schema_preserved {
        resolve_sqlite_catalog_transfer_target_statements(manager, request).await?
    } else if matches!(target_driver.as_str(), "sqlite" | "sqlite3") {
        build_sqlite_create_table_statements_with_defaults(
            &request.target.schema,
            &request.target.table,
            &create_columns,
            &default_expressions,
        )?
    } else {
        let kind = DatabaseKind::from_str(&target_driver).map_err(|error| error.to_string())?;
        build_create_table_statements_with_transfer_metadata(
            kind,
            &request.target.schema,
            &request.target.table,
            &create_columns,
            &default_expressions,
            &identity_generations,
            &character_metadata,
        )?
    };
    let confirmation_token = if can_execute {
        transfer_target_confirmation_token(request, &columns, &statements)?
    } else {
        String::new()
    };
    let mut warnings = vec![format!(
        "This creates only the empty target table {}. Data is copied later through a separate reviewed transfer.",
        endpoint_label(&request.target)
    )];
    if sqlite_catalog_schema_preserved {
        target_column_warnings.retain(|warning| {
            !warning.starts_with("Hidden/invisible source column(s)")
                && !warning.starts_with("Generated source column(s)")
        });
        warnings.push(
            "The native SQLite catalog definition is retained while the target table identity is rebuilt. Proven self-referencing foreign keys are rewritten to the target table; external foreign-key targets stay schema-local. Table-level primary/unique/check/foreign-key constraints, generated/hidden columns, collations, STRICT/WITHOUT ROWID options, and catalog-backed explicit indexes are included in the reviewed DDL. Renamed-table indexes receive deterministic target-scoped names. Triggers and virtual-table implementation objects are not copied."
                .to_string(),
        );
        warnings.push(
            "SQLite target creation executes the reviewed table and index statements in one target transaction; any statement failure rolls the new table back."
                .to_string(),
        );
    } else {
        warnings.push(
            "Primary-key and nullability metadata are retained. Supported same-product auto-increment columns receive new target-owned generators. Reviewed same-product defaults and portable literals/system values may be retained. The empty-table step does not create secondary indexes or constraints by itself; an eligible same-product PostgreSQL/MySQL data transfer can separately review and restore catalog-backed indexes, unique/check constraints, and foreign keys after rows are copied. Source sequence names/current values, generated expressions, triggers, and unmapped defaults are not copied."
                .to_string(),
        );
    }
    warnings.extend(target_column_warnings);
    if !can_execute {
        warnings.push(
            "Executable CREATE TABLE DDL is blocked because at least one source type has no explicit cross-product mapping. No textual fallback DDL was generated."
                .to_string(),
        );
    }
    warnings.extend(
        columns
            .iter()
            .filter(|column| {
                !normalized_transfer_type(&column.source_data_type)
                    .eq_ignore_ascii_case(&normalized_transfer_type(&column.target_data_type))
            })
            .map(|column| {
                format!(
                    "{}: {} → {}. {}",
                    column.name, column.source_data_type, column.target_data_type, column.reason
                )
            }),
    );

    Ok(TableDataTransferTargetPlan {
        mapping_profile,
        columns,
        statements,
        can_execute,
        confirmation_token,
        warnings,
    })
}

#[tauri::command]
pub async fn preview_table_data_transfer_target(
    manager: State<'_, ConnectionManager>,
    request: TableDataTransferTargetPlanRequest,
) -> Result<Response<TableDataTransferTargetPlan>, String> {
    match resolve_table_data_transfer_target_plan(&manager, &request).await {
        Ok(plan) => Ok(Response::ok(plan)),
        Err(error) => Ok(Response::err(
            "PREVIEW_TABLE_DATA_TRANSFER_TARGET_ERROR",
            &error,
        )),
    }
}

#[tauri::command]
pub async fn create_table_data_transfer_target(
    manager: State<'_, ConnectionManager>,
    request: TableDataTransferTargetPlanRequest,
    confirmation_token: String,
) -> Result<Response<CreateTableResult>, String> {
    let result: Result<CreateTableResult, String> = async {
        let plan = resolve_table_data_transfer_target_plan(&manager, &request).await?;
        if !plan.can_execute {
            return Err(
                "The reviewed target-table mapping contains unsupported source types; no DDL was generated."
                    .to_string(),
            );
        }
        if confirmation_token.trim() != plan.confirmation_token {
            return Err(format!(
                "Type the exact confirmation phrase: {}",
                plan.confirmation_token
            ));
        }
        if is_sqlite_driver(&request.target.driver) {
            let transaction_id = format!("sqlite-target-create-{}", uuid::Uuid::new_v4());
            match request.target.database.as_deref() {
                Some(database) => {
                    manager
                        .begin_database_transaction(
                            &request.target.connection_id,
                            &transaction_id,
                            database,
                            Some(normalized_sqlite_schema(&request.target.schema).to_string()),
                        )
                        .await
                }
                None => {
                    manager
                        .begin_transaction(
                            &request.target.connection_id,
                            &transaction_id,
                            Some(normalized_sqlite_schema(&request.target.schema).to_string()),
                        )
                        .await
                }
            }
            .map_err(|error| format!("Could not start SQLite target creation: {error}"))?;
            let statements = plan
                .statements
                .iter()
                .map(|sql| ParameterizedStatement {
                    sql: sql.clone(),
                    params: Vec::new(),
                })
                .collect::<Vec<_>>();
            if let Err(error) = manager
                .execute_parameterized_transaction(
                    &request.target.connection_id,
                    &transaction_id,
                    &statements,
                )
                .await
            {
                let rollback = manager
                    .rollback_transaction(&request.target.connection_id, &transaction_id)
                    .await;
                return Err(match rollback {
                    Ok(()) => format!(
                        "SQLite target creation failed and was rolled back: {error}"
                    ),
                    Err(rollback_error) => format!(
                        "SQLite target creation failed: {error}. Rollback could not be confirmed: {rollback_error}. Verify the target before retrying."
                    ),
                });
            }
            if let Err(error) = manager
                .commit_transaction(&request.target.connection_id, &transaction_id)
                .await
            {
                let rollback = manager
                    .rollback_transaction(&request.target.connection_id, &transaction_id)
                    .await;
                return Err(match rollback {
                    Ok(()) => format!(
                        "Could not commit SQLite target creation: {error}. A rollback was requested, but verify the target before retrying."
                    ),
                    Err(rollback_error) => format!(
                        "Could not commit SQLite target creation: {error}. Rollback also failed: {rollback_error}. The outcome is unknown; verify the target and do not retry automatically."
                    ),
                });
            }
        } else {
            for statement in &plan.statements {
                query_target(
                    &manager,
                    &request.target.connection_id,
                    request.target.database.as_deref(),
                    statement,
                )
                .await
                .map_err(|error| error.to_string())?;
            }
        }
        Ok(CreateTableResult {
            table: request.target.table.trim().to_string(),
            statements: plan.statements,
        })
    }
    .await;

    match result {
        Ok(created) => Ok(Response::ok(created)),
        Err(error) => Ok(Response::err(
            "CREATE_TABLE_DATA_TRANSFER_TARGET_ERROR",
            &error,
        )),
    }
}
