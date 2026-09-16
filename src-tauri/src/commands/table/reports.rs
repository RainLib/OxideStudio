//! Reports for table operations.

use super::export_types::TableExportReport;
use super::import_types::{
    TableCsvImportOptions, TableImportFormat, TableImportMode, TableImportReport,
};
use super::limits::{
    TABLE_DATA_TRANSFER_OBJECT_REPORT_KIND, TABLE_DATA_TRANSFER_OBJECT_REPORT_PARENT_ID,
    TABLE_DATA_TRANSFER_REPORT_KIND, TABLE_DATA_TRANSFER_REPORT_PARENT_ID,
    TABLE_EXPORT_REPORT_KIND, TABLE_EXPORT_REPORT_PARENT_ID, TABLE_IMPORT_REPORT_KIND,
    TABLE_IMPORT_REPORT_PARENT_ID,
};
use super::transfer_objects::table_data_transfer_object_kind_label;
use super::transfer_plan::endpoint_label;
use super::transfer_types::{TableDataTransferObjectReport, TableDataTransferReport};
use crate::core::store::MetaStore;
use crate::core::store::Resource;
use sha2::Digest;
use sha2::Sha256;
use std::time::SystemTime;
use std::time::UNIX_EPOCH;

pub(super) fn normalized_table_data_transfer_project_id(
    project_id: Option<&str>,
) -> Option<String> {
    let project_id = project_id?.trim();
    if project_id.is_empty()
        || project_id.len() > 128
        || project_id.chars().any(|value| value.is_control())
    {
        return None;
    }
    Some(project_id.to_string())
}

pub(super) fn table_data_transfer_report_id(transfer_id: &str) -> String {
    format!("table-transfer-report-{transfer_id}")
}

pub(super) fn table_data_transfer_plan_digest(confirmation_token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(confirmation_token.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub(super) fn current_table_timestamp_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

pub(super) async fn persist_table_data_transfer_report(
    meta_store: &MetaStore,
    report: &TableDataTransferReport,
) -> Result<(), String> {
    let metadata = serde_json::to_value(report)
        .map_err(|error| format!("Could not serialize table transfer report: {error}"))?;
    let resource = Resource {
        id: report.id.clone(),
        project_id: report.project_id.clone(),
        // The destination owns the durable outcome. The report includes the
        // source endpoint so a target connection history remains actionable.
        connection_id: report.target.connection_id.clone(),
        parent_id: Some(TABLE_DATA_TRANSFER_REPORT_PARENT_ID.to_string()),
        kind: TABLE_DATA_TRANSFER_REPORT_KIND.to_string(),
        name: format!("{}:{}", report.started_at, endpoint_label(&report.target)),
        metadata,
        last_updated: current_table_timestamp_millis(),
    };
    meta_store
        .save_resources(&report.project_id, &[resource])
        .await
        .map_err(|error| format!("Could not persist table transfer report: {error}"))
}

pub(super) async fn persist_table_data_transfer_object_report(
    meta_store: &MetaStore,
    report: &TableDataTransferObjectReport,
) -> Result<(), String> {
    let metadata = serde_json::to_value(report)
        .map_err(|error| format!("Could not serialize schema object transfer report: {error}"))?;
    let resource = Resource {
        id: report.id.clone(),
        project_id: report.project_id.clone(),
        connection_id: report.target_connection_id.clone(),
        parent_id: Some(TABLE_DATA_TRANSFER_OBJECT_REPORT_PARENT_ID.to_string()),
        kind: TABLE_DATA_TRANSFER_OBJECT_REPORT_KIND.to_string(),
        name: format!(
            "{}:{}:{}",
            report.started_at,
            table_data_transfer_object_kind_label(report.object_type),
            report.name
        ),
        metadata,
        last_updated: current_table_timestamp_millis(),
    };
    meta_store
        .save_resources(&report.project_id, &[resource])
        .await
        .map_err(|error| format!("Could not persist schema object transfer report: {error}"))
}

pub(super) fn normalized_table_export_project_id(project_id: Option<&str>) -> Option<String> {
    let project_id = project_id?.trim();
    if project_id.is_empty()
        || project_id.len() > 128
        || project_id.chars().any(|value| value.is_control())
    {
        return None;
    }
    Some(project_id.to_string())
}

pub(super) fn table_export_report_id(export_id: &str) -> String {
    format!("table-export-report-{export_id}")
}

pub(super) async fn persist_table_export_report(
    meta_store: &MetaStore,
    report: &TableExportReport,
) -> Result<(), String> {
    let metadata = serde_json::to_value(report)
        .map_err(|error| format!("Could not serialize table export report: {error}"))?;
    let resource = Resource {
        id: report.id.clone(),
        project_id: report.project_id.clone(),
        connection_id: report.connection_id.clone(),
        parent_id: Some(TABLE_EXPORT_REPORT_PARENT_ID.to_string()),
        kind: TABLE_EXPORT_REPORT_KIND.to_string(),
        name: format!("{}:{}:{}", report.started_at, report.schema, report.table),
        metadata,
        last_updated: current_table_timestamp_millis(),
    };
    meta_store
        .save_resources(&report.project_id, &[resource])
        .await
        .map_err(|error| format!("Could not persist table export report: {error}"))
}

pub(super) fn validate_table_import_id(import_id: &str) -> Result<String, String> {
    let import_id = import_id.trim();
    if !(8..=128).contains(&import_id.len())
        || !import_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("Invalid table import id".to_string());
    }
    Ok(import_id.to_string())
}

pub(super) fn table_import_mapping_digest(
    format: TableImportFormat,
    mode: TableImportMode,
    first_row_header: Option<bool>,
    csv_options: Option<&TableCsvImportOptions>,
) -> Result<String, String> {
    let snapshot = serde_json::to_vec(&(format, mode, first_row_header, csv_options))
        .map_err(|error| format!("Could not serialize table import mapping: {error}"))?;
    Ok(format!("{:x}", Sha256::digest(snapshot)))
}

pub(super) fn table_import_report_id(import_id: &str) -> String {
    format!("table-import-report-{import_id}")
}

pub(super) async fn persist_table_import_report(
    meta_store: &MetaStore,
    report: &TableImportReport,
) -> Result<(), String> {
    let metadata = serde_json::to_value(report)
        .map_err(|error| format!("Could not serialize table import report: {error}"))?;
    let resource = Resource {
        id: report.id.clone(),
        project_id: report.project_id.clone(),
        connection_id: report.connection_id.clone(),
        parent_id: Some(TABLE_IMPORT_REPORT_PARENT_ID.to_string()),
        kind: TABLE_IMPORT_REPORT_KIND.to_string(),
        name: format!("{}:{}:{}", report.started_at, report.schema, report.table),
        metadata,
        last_updated: current_table_timestamp_millis(),
    };
    meta_store
        .save_resources(&report.project_id, &[resource])
        .await
        .map_err(|error| format!("Could not persist table import report: {error}"))
}
