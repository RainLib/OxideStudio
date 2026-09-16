//! Shared database fixtures for table feature tests.

use super::access::{
    execute_target_parameterized_batch, get_target_columns, query_target,
    query_target_parameterized,
};

use super::compare_rows::{
    build_table_data_compare_result, data_compare_degradation_level, data_compare_key,
    data_compare_key_columns_are_declared_unique, data_compare_keyset_continuation,
    data_compare_row_values, data_compare_sample_key_predicate, merge_data_compare_sample_keys,
    normalized_data_compare_threshold, preview_metadata_required,
    skipped_table_data_compare_result,
};

use super::compare_sync::{
    build_table_data_compare_sync_parameterized_statements,
    build_table_data_compare_sync_statements, execute_frozen_table_data_compare_sync,
    table_data_compare_sync_metadata_digest, table_data_compare_sync_token_digest,
    validate_table_data_compare_sync_preview,
};

use super::compare_types::{
    FrozenTableDataCompareSyncPlan, TableDataCompareCancellationState,
    TableDataCompareDegradationLevel, TableDataCompareDegradationThreshold,
    TableDataCompareEndpoint, TableDataCompareResult, TableDataCompareSamplingStrategy,
    TableDataCompareSyncPlanState, TableDataCompareSyncPreviewRequest,
};

use super::ddl_columns::{
    build_add_table_column_statements, build_alter_table_column_statements,
    build_create_materialized_view_statement, build_create_table_statements,
    build_create_table_statements_with_defaults,
    build_create_table_statements_with_transfer_metadata, build_create_view_statement,
    build_drop_table_column_statement, build_rename_table_column_statement,
    validate_default_expression,
};

use super::ddl_constraints::{
    build_create_check_constraint_statement, build_create_foreign_key_statement,
    build_create_primary_key_statement, build_create_table_index_statement,
    build_create_unique_constraint_statement, build_drop_table_constraint_statement,
    build_drop_table_index_statement, build_rename_table_index_statement,
};

use super::ddl_types::{AlterColumnValueMode, AlterTableColumn, CreateTableColumn};

use super::export_analytical::{
    analytical_binary, analytical_column_kind, analytical_date32, analytical_timestamp_micros,
    AnalyticalColumnKind, AnalyticalTypePolicy,
};

use super::export_files::sanitize_file_part;

use super::export_sql::{
    ensure_sql_insert_conflict_policy, filter_sql_export_batch, sql_export_insert_batch_rows,
    sql_insert_statements, SqlExportDialect, SqlInsertExportOptions,
};

use super::export_text::{csv_escape, push_delimited_export_row, tsv_escape};

use super::export_types::{
    select_database_sql_export_tables, SqlInsertConflictPolicy, TableExportEncoding,
    TableExportFormat, TableExportWriterContext, TableExportWriterMessage,
    MAX_DATABASE_SQL_EXPORT_TABLE_SELECTION,
};

use super::export_writer::write_table_export_stream;

use super::export_xlsx::{xlsx_column_name, xlsx_escape_text, StreamingXlsxWriter};

use super::import_csv::{
    canonical_import_columns, csv_delimiter, csv_import_reader, csv_import_row_selected,
    csv_import_source_columns, csv_record_values, resolve_csv_import_columns,
    resolve_csv_import_row_range, resolve_csv_text_encoding,
};

use super::import_inference::{
    import_string_inferred_type, infer_csv_import_columns, infer_json_lines_import_columns,
    infer_materialized_import_columns, inferred_import_data_type, ImportInferredType,
};

use super::import_json::{is_json_lines_path, json_import_rows_with_cancel};

use super::import_preflight::{observe_json_import_preflight_row, JsonImportPreflightCounters};

use super::import_preview::{
    read_csv_import_preview, read_json_import_preview, stream_json_document_rows,
    validate_xlsx_headers, xlsx_cell_value, xlsx_import_rows_with_cancel,
};

use super::import_transaction::table_import_replace_statement;

use super::import_types::{
    TableCsvColumnMapping, TableCsvImportOptions, TableImportCancellationState, TableImportFormat,
    TableImportMode, TableImportTextEncoding,
};

use super::limits::{
    MAX_FULL_DATA_COMPARE_DETAIL_ROWS_PER_STATUS, MAX_JSON_IMPORT_PREVIEW_ROWS,
    MAX_TRANSFER_OVERWRITE_ROWS, SQL_EXPORT_INSERT_BATCH_ROWS, SQL_EXPORT_MAX_INSERT_BATCH_ROWS,
    TABLE_DATA_TRANSFER_PROGRESS_BATCH_INTERVAL, TABLE_DATA_TRANSFER_PROGRESS_QUEUE_CAPACITY,
    TABLE_IMPORT_CANCELLED,
};

use super::policy::{
    default_time_series_preview_filter, ensure_host_table_ddl_capability,
    ensure_table_export_format, object_label_from_type, object_type_is_foreign_table,
    object_type_is_materialized_view, object_type_is_view, relation_operation_allowed,
    resolve_transfer_target_column_quoting, reviewed_table_data_dialect, table_data_dialect,
    table_data_transfer_dialect, validated_raw_filter_sql, RelationOperation,
};

use super::postgres_catalog::{
    generate_postgres_materialized_view_ddl, generate_postgres_materialized_view_ddl_with_data,
    generate_postgres_table_ddl, generate_postgres_view_ddl, order_postgres_views,
    postgres_backup_index_definitions, postgres_backup_routine_definitions,
    postgres_backup_routine_definitions_query, postgres_materialized_view_populated_query,
    postgres_multirange_type_names, postgres_multirange_type_query, postgres_range_type_ddls,
    postgres_range_type_query, postgres_sequence_ddl, postgres_sequence_from_row,
    postgres_sequence_metadata_query, postgres_sequence_setval_sql, postgres_view_definition_query,
    postgres_view_dependency_query, view_definition_query,
};

use super::reports::{
    current_table_timestamp_millis, normalized_table_data_transfer_project_id,
    table_data_transfer_plan_digest, table_data_transfer_report_id, table_import_mapping_digest,
};

use super::row_sql::{
    build_insert_mutation, build_insert_mutation_with_column_quoting,
    build_structured_filter_where, build_table_order_by, build_update_mutation,
    build_upsert_mutation, build_upsert_mutation_with_column_quoting, column_lookup,
    summarize_mutation_affected, transfer_column_identifier,
};

use super::row_types::{should_calculate_table_total, TableFilter, TableRowUpdate, TableSort};

use super::sqlite_ddl::{
    rewrite_sqlite_create_index_for_transfer, rewrite_sqlite_create_table_for_transfer,
    rewrite_sqlite_create_trigger_for_transfer, rewrite_sqlite_create_view_for_transfer,
    sqlite_transfer_target_index_name,
};

use super::sqlite_ddl_builders::{
    build_sqlite_add_column_statements, build_sqlite_create_index_statement,
    build_sqlite_create_table_statements, build_sqlite_create_table_statements_with_defaults,
    build_sqlite_drop_column_statement, build_sqlite_drop_index_statement,
};

use super::transfer_batch_plan::{
    missing_deferred_cycle_foreign_keys, table_data_transfer_batch_plan,
};

use super::transfer_identity::{
    postgres_identity_reseed_plan_from_results, postgres_identity_reseed_plan_query,
    postgres_identity_reseed_statements,
};

use super::transfer_mapping::{
    apply_transfer_conversion, build_data_transfer_column_mapping, transfer_plan_can_execute,
    transfer_type_mapping_assessment, transfer_type_mapping_warnings,
};

use super::transfer_objects::{
    build_table_data_transfer_object_plan, normalized_table_data_transfer_objects,
};

use super::transfer_plan::{
    ensure_transfer_endpoint_driver_matches_connection, resolve_transfer_upsert_key_columns,
    transfer_confirmation_token, TableDataTransferConfirmationBinding,
};

use super::transfer_runtime::{
    append_transfer_verification, bounded_table_data_transfer_message,
    overwrite_transfer_verification, postgres_identity_reseed_verification_query,
    should_emit_table_data_transfer_progress, try_send_table_data_transfer_progress,
    validate_table_data_transfer_id, validate_table_data_transfer_overwrite_rows,
    AbortTableDataTransferTaskOnDrop,
};

use super::transfer_schema::{
    build_portable_transfer_schema_restore_plan, build_transfer_schema_restore_plan,
    TransferTableSchemaObjects,
};

use super::transfer_target::{
    resolve_table_data_transfer_target_plan, transfer_target_confirmation_token,
};

use super::transfer_target_columns::{
    build_transfer_target_columns, transfer_target_default_expression,
};

use super::transfer_target_types::{transfer_target_column_type, transfer_target_mapping_profile};

use super::transfer_transaction::{
    delete_table_data_transfer_target_for_overwrite, execute_mysql_post_commit_schema_statements,
    finish_table_data_transfer_transaction, post_commit_schema_receipt, PostCommitSchemaStatement,
};

use super::transfer_types::{
    TableDataTransferBatchPlanRequest, TableDataTransferCancellationState,
    TableDataTransferColumnMapping, TableDataTransferCompatibility, TableDataTransferConversion,
    TableDataTransferEndpoint, TableDataTransferIdentityReseedPlan, TableDataTransferMode,
    TableDataTransferObjectAction, TableDataTransferObjectKind, TableDataTransferObjectReport,
    TableDataTransferObjectSelection, TableDataTransferPostCommitStatus, TableDataTransferPreview,
    TableDataTransferProgress, TableDataTransferProgressStatus, TableDataTransferReport,
    TableDataTransferRequest, TableDataTransferRetryPolicy, TableDataTransferTargetColumn,
    TableDataTransferTargetPlanRequest, TableDataTransferVerificationStatus,
};

use super::values::value_to_u64;

use crate::core::dialect::DatabaseKind;

use crate::core::driver::DatabaseDriver;

use crate::core::manager::ConnectionManager;

use crate::core::protocol::ColumnDef;

use crate::core::protocol::ColumnInfo;

use crate::core::protocol::ConstraintInfo;

use crate::core::protocol::IndexInfo;

use crate::core::protocol::ParameterizedStatement;

use crate::core::protocol::QueryParameter;

use crate::core::protocol::QueryResult;

use crate::core::protocol::TableInfo;

use crate::core::schema_diff::finalize_schema_snapshot;

use crate::core::schema_diff::SchemaObjectSnapshot;

use crate::core::schema_diff::SchemaRelationSnapshot;

use crate::core::schema_diff::SchemaRoutineSnapshot;

use crate::core::schema_diff::SchemaSequenceOwnerSnapshot;

use crate::core::schema_diff::SchemaSnapshot;

use crate::core::schema_diff::SCHEMA_SNAPSHOT_VERSION;

use crate::drivers::sqlite::SqliteDriver;

use anyhow::Result;

use async_trait::async_trait;

use calamine::open_workbook_auto;

use calamine::Data;

use calamine::Reader;

use serde_json::json;

use serde_json::Value;

use std::collections::BTreeMap;

use std::collections::HashMap;

use std::collections::HashSet;

use std::fs;

use std::io::Read;

use std::path::Path;

use std::path::PathBuf;

use std::sync::atomic::AtomicU64;

use std::sync::Arc;

use std::sync::Mutex;

use tokio::sync::mpsc;

use tokio::sync::watch;

struct PreviewTargetDriver;

struct RestrictedExternalPostgresDriver;

struct ReviewedGaussTransferDriver;

struct TransferTransactionDriver {
    events: Arc<Mutex<Vec<String>>>,
    delete_rows: u64,
    rollback_error: Option<String>,
}

struct PostCommitTransferDriver {
    events: Arc<Mutex<Vec<String>>>,
}

struct SyncTransactionDriver {
    events: Arc<Mutex<Vec<String>>>,
    affected_rows: u64,
    columns: Vec<ColumnInfo>,
}

#[async_trait]
impl DatabaseDriver for TransferTransactionDriver {
    async fn connect(&mut self) -> Result<()> {
        Ok(())
    }

    async fn disconnect(&self) -> Result<()> {
        Ok(())
    }

    async fn ping(&self) -> Result<()> {
        Ok(())
    }

    async fn query(&self, _sql: &str) -> Result<Vec<QueryResult>> {
        Ok(Vec::new())
    }

    async fn execute_parameterized_transaction(
        &self,
        session_id: &str,
        statements: &[ParameterizedStatement],
    ) -> Result<Vec<u64>> {
        self.events.lock().expect("transfer event mutex").extend(
            statements
                .iter()
                .map(|statement| format!("execute:{session_id}:{}", statement.sql)),
        );
        Ok(vec![self.delete_rows; statements.len()])
    }

    async fn commit_transaction(&self, session_id: &str) -> Result<()> {
        self.events
            .lock()
            .expect("transfer event mutex")
            .push(format!("commit:{session_id}"));
        Ok(())
    }

    async fn rollback_transaction(&self, session_id: &str) -> Result<()> {
        self.events
            .lock()
            .expect("transfer event mutex")
            .push(format!("rollback:{session_id}"));
        if let Some(error) = &self.rollback_error {
            return Err(anyhow::anyhow!(error.clone()));
        }
        Ok(())
    }
}

#[async_trait]
impl DatabaseDriver for PostCommitTransferDriver {
    async fn connect(&mut self) -> Result<()> {
        Ok(())
    }

    async fn disconnect(&self) -> Result<()> {
        Ok(())
    }

    async fn ping(&self) -> Result<()> {
        Ok(())
    }

    async fn query(&self, _sql: &str) -> Result<Vec<QueryResult>> {
        Ok(Vec::new())
    }

    async fn execute_parameterized(&self, sql: &str, _params: &[QueryParameter]) -> Result<u64> {
        self.events
            .lock()
            .expect("post-commit event mutex")
            .push(sql.to_string());
        if sql == "FAIL" {
            return Err(anyhow::anyhow!("fixture failure with sensitive detail"));
        }
        Ok(0)
    }
}

#[async_trait]
impl DatabaseDriver for SyncTransactionDriver {
    async fn connect(&mut self) -> Result<()> {
        Ok(())
    }

    async fn disconnect(&self) -> Result<()> {
        Ok(())
    }

    async fn ping(&self) -> Result<()> {
        Ok(())
    }

    async fn query(&self, _sql: &str) -> Result<Vec<QueryResult>> {
        Ok(Vec::new())
    }

    async fn get_tables(&self, schema: &str) -> Result<Vec<TableInfo>> {
        Ok(vec![TableInfo {
            name: "users".to_string(),
            schema: Some(schema.to_string()),
            table_type: Some("BASE TABLE".to_string()),
            comment: None,
        }])
    }

    async fn get_columns(&self, _schema: &str, _table: &str) -> Result<Vec<ColumnInfo>> {
        Ok(self.columns.clone())
    }

    async fn begin_transaction(&self, session_id: &str, _schema: Option<&str>) -> Result<()> {
        self.events
            .lock()
            .expect("sync event mutex")
            .push(format!("begin:{session_id}"));
        Ok(())
    }

    async fn execute_parameterized_transaction(
        &self,
        session_id: &str,
        statements: &[ParameterizedStatement],
    ) -> Result<Vec<u64>> {
        self.events
            .lock()
            .expect("sync event mutex")
            .push(format!("execute:{session_id}:{}", statements.len()));
        Ok(vec![self.affected_rows; statements.len()])
    }

    async fn commit_transaction(&self, session_id: &str) -> Result<()> {
        self.events
            .lock()
            .expect("sync event mutex")
            .push(format!("commit:{session_id}"));
        Ok(())
    }

    async fn rollback_transaction(&self, session_id: &str) -> Result<()> {
        self.events
            .lock()
            .expect("sync event mutex")
            .push(format!("rollback:{session_id}"));
        Ok(())
    }
}

fn transfer_object_snapshot(
    connection_id: &str,
    schema: &str,
    relations: Vec<SchemaRelationSnapshot>,
    routines: Vec<SchemaRoutineSnapshot>,
    schema_objects: Vec<SchemaObjectSnapshot>,
) -> SchemaSnapshot {
    finalize_schema_snapshot(SchemaSnapshot {
        version: SCHEMA_SNAPSHOT_VERSION,
        id: String::new(),
        fingerprint: String::new(),
        project_id: "project".to_string(),
        connection_id: connection_id.to_string(),
        connection_name: connection_id.to_string(),
        driver: "postgres".to_string(),
        database_name: Some("app".to_string()),
        schema_name: schema.to_string(),
        captured_at: 1,
        relations,
        routines,
        schema_objects,
        warnings: Vec::new(),
    })
    .unwrap()
}

fn transfer_object_relation(
    name: &str,
    object_type: &str,
    definition: Option<&str>,
    dependencies: &[&str],
) -> SchemaRelationSnapshot {
    SchemaRelationSnapshot {
        name: name.to_string(),
        object_type: Some(object_type.to_string()),
        comment: None,
        definition: definition.map(ToString::to_string),
        materialized_view_populated: None,
        dependencies: dependencies
            .iter()
            .map(|dependency| dependency.to_string())
            .collect(),
        external_dependencies: Vec::new(),
        sequence_dependencies: Vec::new(),
        columns: Vec::new(),
        indexes: Vec::new(),
        constraints: Vec::new(),
    }
}

fn target_column(name: &str) -> ColumnInfo {
    ColumnInfo {
        name: name.to_string(),
        data_type: "text".to_string(),
        is_nullable: true,
        is_primary_key: false,
        is_unique: false,
        is_indexed: false,
        is_auto_increment: false,
        identity_generation: None,
        default_value: None,
        comment: None,
        is_generated: Some(false),
        is_hidden: Some(false),
    }
}

#[async_trait]
impl DatabaseDriver for PreviewTargetDriver {
    async fn connect(&mut self) -> Result<()> {
        Ok(())
    }

    async fn disconnect(&self) -> Result<()> {
        Ok(())
    }

    async fn ping(&self) -> Result<()> {
        Ok(())
    }

    async fn query(&self, _sql: &str) -> Result<Vec<QueryResult>> {
        Ok(vec![QueryResult::execution("primary", 0)])
    }

    async fn query_database(&self, database: &str, _sql: &str) -> Result<Vec<QueryResult>> {
        Ok(vec![QueryResult::execution(database, 0)])
    }

    async fn query_parameterized(
        &self,
        _sql: &str,
        params: &[QueryParameter],
    ) -> Result<Vec<QueryResult>> {
        Ok(vec![QueryResult::execution(
            "primary-parameterized",
            params.len() as u64,
        )])
    }

    async fn query_database_parameterized(
        &self,
        database: &str,
        _sql: &str,
        params: &[QueryParameter],
    ) -> Result<Vec<QueryResult>> {
        Ok(vec![QueryResult::execution(
            &format!("{database}-parameterized"),
            params.len() as u64,
        )])
    }

    async fn execute_parameterized_batch(
        &self,
        statements: &[ParameterizedStatement],
    ) -> Result<Vec<u64>> {
        Ok(vec![1; statements.len()])
    }

    async fn execute_database_parameterized_batch(
        &self,
        database: &str,
        statements: &[ParameterizedStatement],
    ) -> Result<Vec<u64>> {
        Ok(vec![database.len() as u64; statements.len()])
    }

    async fn get_columns(&self, _schema: &str, _table: &str) -> Result<Vec<ColumnInfo>> {
        Ok(vec![target_column("primary")])
    }

    async fn get_database_columns(
        &self,
        database: &str,
        _schema: &str,
        _table: &str,
    ) -> Result<Vec<ColumnInfo>> {
        Ok(vec![target_column(database)])
    }
}

#[async_trait]
impl DatabaseDriver for RestrictedExternalPostgresDriver {
    fn package_capabilities(&self) -> Option<crate::core::dialect::DatabaseCapabilities> {
        let mut capabilities = DatabaseKind::Postgres.capabilities();
        capabilities.display_name = "Restricted PostgreSQL package".to_string();
        capabilities.supports_table_data_transfer = false;
        Some(capabilities)
    }

    async fn connect(&mut self) -> Result<()> {
        Ok(())
    }

    async fn disconnect(&self) -> Result<()> {
        Ok(())
    }

    async fn ping(&self) -> Result<()> {
        Ok(())
    }

    async fn query(&self, _sql: &str) -> Result<Vec<QueryResult>> {
        Ok(vec![QueryResult::execution("restricted", 0)])
    }
}

#[async_trait]
impl DatabaseDriver for ReviewedGaussTransferDriver {
    fn package_capabilities(&self) -> Option<crate::core::dialect::DatabaseCapabilities> {
        let mut capabilities = DatabaseKind::Postgres.capabilities();
        capabilities.driver = "gaussdb".to_string();
        capabilities.display_name = "Reviewed GaussDB package".to_string();
        capabilities.supports_table_data_transfer = true;
        Some(capabilities)
    }

    async fn connect(&mut self) -> Result<()> {
        Ok(())
    }

    async fn disconnect(&self) -> Result<()> {
        Ok(())
    }

    async fn ping(&self) -> Result<()> {
        Ok(())
    }

    async fn query(&self, _sql: &str) -> Result<Vec<QueryResult>> {
        Ok(vec![QueryResult::execution("gauss", 0)])
    }
}

fn test_export_writer_context(
    final_path: PathBuf,
    format: TableExportFormat,
) -> TableExportWriterContext {
    TableExportWriterContext {
        app: None,
        export_id: "export-test".to_string(),
        final_path,
        kind: DatabaseKind::Postgres,
        sql_dialect: SqlExportDialect::Postgres,
        override_system_value: false,
        sql_insert_batch_rows: SQL_EXPORT_INSERT_BATCH_ROWS,
        sql_insert_conflict_policy: SqlInsertConflictPolicy::Strict,
        sql_conflict_key_columns: Vec::new(),
        analytical_type_policy: AnalyticalTypePolicy::Native,
        schema: "public".to_string(),
        table: "users".to_string(),
        format,
        encoding: if matches!(
            format,
            TableExportFormat::Arrow | TableExportFormat::Parquet
        ) {
            TableExportEncoding::Binary
        } else {
            TableExportEncoding::Utf8
        },
        xlsx_auto_filter: true,
        progress_rows: Arc::new(AtomicU64::new(0)),
        progress_batches: Arc::new(AtomicU64::new(0)),
    }
}

fn unique_export_test_path(label: &str, extension: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "oxide-table-export-{label}-{}.{extension}",
        uuid::Uuid::new_v4(),
    ))
}

fn matching_export_partials(final_path: &Path) -> Vec<PathBuf> {
    let file_name = final_path
        .file_name()
        .and_then(|value| value.to_str())
        .expect("test path has a file name");
    final_path
        .parent()
        .and_then(|parent| fs::read_dir(parent).ok())
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let name = entry.file_name();
            let name = name.to_str()?;
            (name.starts_with(&format!(".{file_name}.")) && name.ends_with(".partial"))
                .then(|| entry.path())
        })
        .collect()
}

#[tokio::test(flavor = "multi_thread")]
async fn export_writer_publishes_only_after_explicit_finish() {
    let final_path = unique_export_test_path("finish", "jsonl");
    let context = test_export_writer_context(final_path.clone(), TableExportFormat::Jsonl);
    let (sender, receiver) = mpsc::channel(2);
    let (_cancel_sender, cancel_rx) = watch::channel(false);
    let writer = tokio::task::spawn_blocking(move || {
        write_table_export_stream(context, receiver, cancel_rx)
    });

    sender
        .send(TableExportWriterMessage::Batch {
            columns: vec![
                ColumnDef {
                    name: "id".to_string(),
                    data_type: "INTEGER".to_string(),
                },
                ColumnDef {
                    name: "name".to_string(),
                    data_type: "TEXT".to_string(),
                },
            ],
            rows: vec![vec![json!(1), json!("Ada")]],
        })
        .await
        .unwrap();
    assert!(!final_path.exists());
    sender.send(TableExportWriterMessage::Finish).await.unwrap();
    drop(sender);

    let result = writer.await.unwrap().unwrap();
    assert_eq!(result.rows_exported, 1);
    assert_eq!(result.batches, 1);
    assert_eq!(
        fs::read_to_string(&final_path).unwrap(),
        "{\"id\":1,\"name\":\"Ada\"}\n"
    );
    assert!(matching_export_partials(&final_path).is_empty());
    fs::remove_file(final_path).unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn markdown_export_escapes_table_structure_and_preserves_nulls() {
    let final_path = unique_export_test_path("markdown", "md");
    let context = test_export_writer_context(final_path.clone(), TableExportFormat::Markdown);
    let (sender, receiver) = mpsc::channel(2);
    let (_cancel_sender, cancel_rx) = watch::channel(false);
    let writer = tokio::task::spawn_blocking(move || {
        write_table_export_stream(context, receiver, cancel_rx)
    });

    sender
        .send(TableExportWriterMessage::Batch {
            columns: vec![
                ColumnDef {
                    name: "name|path".to_string(),
                    data_type: "TEXT".to_string(),
                },
                ColumnDef {
                    name: "enabled".to_string(),
                    data_type: "BOOLEAN".to_string(),
                },
            ],
            rows: vec![vec![json!("Ada|one\nline"), Value::Null]],
        })
        .await
        .unwrap();
    sender.send(TableExportWriterMessage::Finish).await.unwrap();
    drop(sender);

    let result = writer.await.unwrap().unwrap();
    assert_eq!(result.rows_exported, 1);
    assert_eq!(
        fs::read_to_string(&final_path).unwrap(),
        "| name\\|path | enabled |\n| --- | --- |\n| Ada\\|one<br>line | NULL |\n"
    );
    assert!(matching_export_partials(&final_path).is_empty());
    fs::remove_file(final_path).unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn export_writer_removes_partial_when_producer_stops_without_finish() {
    let final_path = unique_export_test_path("interrupted", "jsonl");
    let context = test_export_writer_context(final_path.clone(), TableExportFormat::Jsonl);
    let (sender, receiver) = mpsc::channel(2);
    let (_cancel_sender, cancel_rx) = watch::channel(false);
    let writer = tokio::task::spawn_blocking(move || {
        write_table_export_stream(context, receiver, cancel_rx)
    });

    sender
        .send(TableExportWriterMessage::Batch {
            columns: vec![ColumnDef {
                name: "id".to_string(),
                data_type: "INTEGER".to_string(),
            }],
            rows: vec![vec![json!(1)]],
        })
        .await
        .unwrap();
    drop(sender);

    let error = writer.await.unwrap().unwrap_err();
    assert!(error.contains("before completion"));
    assert!(!final_path.exists());
    assert!(matching_export_partials(&final_path).is_empty());
}

async fn assert_analytical_export_file(format: TableExportFormat, extension: &str, magic: &[u8]) {
    let final_path = unique_export_test_path(extension, extension);
    let context = test_export_writer_context(final_path.clone(), format);
    let (sender, receiver) = mpsc::channel(2);
    let (_cancel_sender, cancel_rx) = watch::channel(false);
    let writer = tokio::task::spawn_blocking(move || {
        write_table_export_stream(context, receiver, cancel_rx)
    });

    sender
        .send(TableExportWriterMessage::Batch {
            columns: vec![
                ColumnDef {
                    name: "id".to_string(),
                    data_type: "BIGINT".to_string(),
                },
                ColumnDef {
                    name: "enabled".to_string(),
                    data_type: "BOOLEAN".to_string(),
                },
                ColumnDef {
                    name: "amount".to_string(),
                    data_type: "NUMERIC(38, 12)".to_string(),
                },
            ],
            rows: vec![vec![
                json!("9223372036854775807"),
                json!(true),
                json!("12345678901234567890.123456789012"),
            ]],
        })
        .await
        .unwrap();
    sender.send(TableExportWriterMessage::Finish).await.unwrap();
    drop(sender);

    let result = writer.await.unwrap().unwrap();
    assert_eq!(result.rows_exported, 1);
    assert_eq!(result.batches, 1);
    assert_eq!(result.type_coercions.len(), 1);
    assert_eq!(result.type_coercions[0].column, "amount");
    assert_eq!(result.type_coercions[0].source_type, "NUMERIC(38, 12)");
    let contents = fs::read(&final_path).unwrap();
    assert!(contents.starts_with(magic));
    assert!(contents.ends_with(magic));
    assert!(matching_export_partials(&final_path).is_empty());
    fs::remove_file(final_path).unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn arrow_export_writes_a_complete_ipc_file_with_type_metadata() {
    assert_analytical_export_file(TableExportFormat::Arrow, "arrow", b"ARROW1").await;
}

#[tokio::test(flavor = "multi_thread")]
async fn parquet_export_writes_a_complete_file_with_type_metadata() {
    assert_analytical_export_file(TableExportFormat::Parquet, "parquet", b"PAR1").await;
}

mod access;

mod compare_rows;

mod compare_sync;

mod contracts;

mod ddl_columns;

mod ddl_constraints;

mod export_analytical;

mod export_files;

mod export_sql;

mod export_text;

mod export_types;

mod export_xlsx;

mod import_csv;

mod import_inference;

mod import_json;

mod import_preview;

mod policy;

mod postgres_catalog;

mod reports;

mod row_sql;

mod row_types;

mod sqlite_ddl;

mod sqlite_ddl_builders;

mod transfer_batch_plan;

mod transfer_identity;

mod transfer_mapping;

mod transfer_objects;

mod transfer_plan;

mod transfer_runtime;

mod transfer_schema;

mod transfer_target;

mod transfer_target_columns;

mod transfer_target_types;

mod transfer_transaction;

mod values;
