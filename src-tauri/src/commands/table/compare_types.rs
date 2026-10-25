//! Compare types for table operations.

use super::compare_runtime::validate_table_data_compare_id;
use super::compare_sync::table_data_compare_sync_token_digest;
use super::limits::{
    DEFAULT_DATA_COMPARE_SAMPLE_SIZE, DEFAULT_FULL_DATA_COMPARE_MAX_ROWS,
    DEFAULT_SAMPLED_DATA_COMPARE_MAX_ROWS, MAX_ACTIVE_TABLE_DATA_COMPARE_SYNC_PLANS,
    TABLE_DATA_COMPARE_SYNC_PLAN_TTL_MILLIS,
};
use super::reports::current_table_timestamp_millis;
use crate::core::protocol::ParameterizedStatement;
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::watch;
use tokio::sync::Mutex as AsyncMutex;

/// A reviewed table endpoint used by the bounded, server-side data compare
/// path. It intentionally mirrors the transfer endpoint rather than accepting
/// arbitrary SQL: this keeps pagination and identifier quoting host-owned.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataCompareEndpoint {
    pub connection_id: String,
    pub driver: String,
    #[serde(default)]
    pub database: Option<String>,
    pub schema: String,
    pub table: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataCompareRequest {
    pub compare_id: String,
    pub source: TableDataCompareEndpoint,
    pub target: TableDataCompareEndpoint,
    pub columns: Vec<String>,
    pub key_columns: Vec<String>,
    #[serde(default)]
    pub batch_size: Option<u32>,
    /// Legacy full-compare ceiling. Larger relations automatically use the
    /// bounded sampled/checksum path unless an explicit threshold is supplied.
    #[serde(default)]
    pub max_rows: Option<u32>,
    #[serde(default)]
    pub degradation_threshold: Option<TableDataCompareDegradationThreshold>,
    #[serde(default)]
    pub sampling_strategy: Option<TableDataCompareSamplingStrategy>,
    #[serde(default)]
    pub enable_checksum: Option<bool>,
}

#[derive(Clone)]
pub(super) struct TableDataCompareCancellationHandle {
    pub(super) source_connection_id: String,
    pub(super) target_connection_id: String,
    pub(super) source_query_id: String,
    pub(super) target_query_id: String,
    pub(super) sender: watch::Sender<bool>,
}

#[derive(Default)]
pub struct TableDataCompareCancellationState(
    pub(super) Arc<AsyncMutex<HashMap<String, TableDataCompareCancellationHandle>>>,
);

impl TableDataCompareCancellationState {
    pub(super) async fn register(
        &self,
        compare_id: &str,
        source_connection_id: &str,
        target_connection_id: &str,
    ) -> Result<(watch::Receiver<bool>, String, String), String> {
        validate_table_data_compare_id(compare_id)?;
        let source_query_id = format!("{compare_id}-source");
        let target_query_id = format!("{compare_id}-target");
        let (sender, receiver) = watch::channel(false);
        let mut active = self.0.lock().await;
        if active.contains_key(compare_id) {
            return Err(format!(
                "Table data comparison is already active: {compare_id}"
            ));
        }
        active.insert(
            compare_id.to_string(),
            TableDataCompareCancellationHandle {
                source_connection_id: source_connection_id.to_string(),
                target_connection_id: target_connection_id.to_string(),
                source_query_id: source_query_id.clone(),
                target_query_id: target_query_id.clone(),
                sender,
            },
        );
        Ok((receiver, source_query_id, target_query_id))
    }

    pub(super) async fn request_cancel(
        &self,
        compare_id: &str,
    ) -> Option<TableDataCompareCancellationHandle> {
        self.0.lock().await.get(compare_id).cloned()
    }

    pub(super) async fn take(&self, compare_id: &str) {
        self.0.lock().await.remove(compare_id);
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TableDataCompareProgressStatus {
    Running,
    Done,
    Cancelled,
    Error,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TableDataCompareProgressPhase {
    Validating,
    Counting,
    SelectingSampleKeys,
    FetchingRows,
    Comparing,
    Completed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataCompareProgress {
    pub compare_id: String,
    pub phase: TableDataCompareProgressPhase,
    pub endpoint: Option<String>,
    pub processed_rows: u64,
    pub source_row_count: Option<u64>,
    pub target_row_count: Option<u64>,
    pub status: TableDataCompareProgressStatus,
    pub terminal: bool,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TableDataCompareDegradationLevel {
    Full,
    Sample,
    SkipWithRisk,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TableDataCompareSamplingStrategy {
    ExtremeValues,
    Stratified,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataCompareDegradationThreshold {
    pub full_compare_max_rows: u64,
    pub sample_max_rows: u64,
    pub sample_size: u32,
}

impl Default for TableDataCompareDegradationThreshold {
    fn default() -> Self {
        Self {
            full_compare_max_rows: DEFAULT_FULL_DATA_COMPARE_MAX_ROWS,
            sample_max_rows: DEFAULT_SAMPLED_DATA_COMPARE_MAX_ROWS,
            sample_size: DEFAULT_DATA_COMPARE_SAMPLE_SIZE,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataCompareRow {
    pub key: String,
    pub values: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataCompareModifiedRow {
    pub key: String,
    pub source_values: BTreeMap<String, Value>,
    pub target_values: BTreeMap<String, Value>,
    pub changed_columns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataCompareResult {
    pub added: Vec<TableDataCompareRow>,
    pub removed: Vec<TableDataCompareRow>,
    pub modified: Vec<TableDataCompareModifiedRow>,
    /// Totals across the inspected key universe. They are exact for `full`
    /// comparisons and sample-local for `sample` comparisons.
    pub added_count: u64,
    pub removed_count: u64,
    pub modified_count: u64,
    pub equal_count: u64,
    pub source_row_count: u64,
    pub target_row_count: u64,
    pub compared_key_count: u64,
    pub batch_size: u32,
    pub detail_limit_per_status: u32,
    pub details_truncated: bool,
    pub degradation_level: TableDataCompareDegradationLevel,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sampling_strategy: Option<TableDataCompareSamplingStrategy>,
    pub sampling_rate: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence_score: Option<f64>,
    pub verification_method: String,
    pub counts_exact: bool,
    pub sampled_key_count: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_checksums: Option<BTreeMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_checksums: Option<BTreeMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checksums_match: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataCompareSyncPreviewRequest {
    pub target: TableDataCompareEndpoint,
    pub columns: Vec<String>,
    pub key_columns: Vec<String>,
    pub comparison: TableDataCompareResult,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataCompareSyncPreview {
    pub insert_count: u64,
    pub update_count: u64,
    pub delete_count: u64,
    pub statement_count: u64,
    pub statements: Vec<String>,
    pub sql: String,
    pub plan_digest: String,
    pub review_only: bool,
    pub can_execute: bool,
    pub plan_token: String,
    pub expires_at: i64,
    pub confirmation_text: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteTableDataCompareSyncRequest {
    pub plan_token: String,
    pub plan_digest: String,
    pub confirmation_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataCompareSyncReceipt {
    pub insert_count: u64,
    pub update_count: u64,
    pub delete_count: u64,
    pub rows_affected: u64,
    pub plan_digest: String,
}

#[derive(Debug, Clone)]
pub(super) struct FrozenTableDataCompareSyncPlan {
    pub(super) target: TableDataCompareEndpoint,
    pub(super) metadata_digest: String,
    pub(super) statements: Vec<ParameterizedStatement>,
    pub(super) insert_count: u64,
    pub(super) update_count: u64,
    pub(super) delete_count: u64,
    pub(super) plan_digest: String,
    pub(super) confirmation_text: String,
    pub(super) expires_at: i64,
}

#[derive(Default)]
pub struct TableDataCompareSyncPlanState(
    pub(super) Arc<AsyncMutex<HashMap<String, FrozenTableDataCompareSyncPlan>>>,
);

impl TableDataCompareSyncPlanState {
    pub(super) async fn issue(&self, mut plan: FrozenTableDataCompareSyncPlan) -> (String, i64) {
        let now = current_table_timestamp_millis();
        plan.expires_at = now.saturating_add(TABLE_DATA_COMPARE_SYNC_PLAN_TTL_MILLIS);
        let expires_at = plan.expires_at;
        let token = uuid::Uuid::new_v4().to_string();
        let token_digest = table_data_compare_sync_token_digest(&token);
        let mut plans = self.0.lock().await;
        plans.retain(|_, candidate| candidate.expires_at > now);
        if plans.len() >= MAX_ACTIVE_TABLE_DATA_COMPARE_SYNC_PLANS {
            if let Some(oldest) = plans
                .iter()
                .min_by_key(|(_, candidate)| candidate.expires_at)
                .map(|(key, _)| key.clone())
            {
                plans.remove(&oldest);
            }
        }
        plans.insert(token_digest, plan);
        (token, expires_at)
    }

    pub(super) async fn consume(
        &self,
        token: &str,
    ) -> Result<FrozenTableDataCompareSyncPlan, String> {
        let token = token.trim();
        if token.is_empty() || token.len() > 128 {
            return Err("Synchronization plan token is invalid".to_string());
        }
        let now = current_table_timestamp_millis();
        let token_digest = table_data_compare_sync_token_digest(token);
        let mut plans = self.0.lock().await;
        plans.retain(|key, candidate| key == &token_digest || candidate.expires_at > now);
        let plan = plans.remove(&token_digest).ok_or_else(|| {
            "Synchronization plan is unavailable or was already consumed. Compare and preview again."
                .to_string()
        })?;
        if plan.expires_at <= now {
            return Err(
                "Synchronization plan expired. Compare and preview again before writing."
                    .to_string(),
            );
        }
        Ok(plan)
    }
}
