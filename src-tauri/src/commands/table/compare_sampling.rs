//! Bounded key windows across the ordered relation, followed by shared-key lookup.
use super::access::query_data_compare_target_tracked;
use super::compare_rows::{canonical_data_compare_key_values, data_compare_key_values};
use super::compare_runtime::ensure_table_data_compare_not_cancelled;
use super::compare_types::{TableDataCompareEndpoint, TableDataCompareSamplingStrategy};
use super::limits::{
    MAX_DATA_COMPARE_SAMPLE_SIZE, MAX_SAMPLED_DATA_COMPARE_MAX_ROWS, TABLE_DATA_COMPARE_CANCELLED,
};
use super::policy::schema_option;
use crate::core::{
    dialect::DatabaseKind, manager::ConnectionManager, protocol::DEFAULT_QUERY_RESULT_ROW_LIMIT,
};
use serde_json::Value;
use std::{collections::BTreeMap, time::Duration};
use tokio::{sync::watch, time::Instant};

const MAX_WINDOWS: u64 = 16;
const MAX_KEY_POSITIONS: u64 = 40_000_000;
const MAX_KEY_BYTES: usize = 16 * 1024 * 1024;
const QUERY_TIMEOUT: Duration = Duration::from_secs(10);
const SELECTION_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone)]
pub(super) struct SampleWindow {
    pub offset: u64,
    pub limit: u32,
    pub descending: bool,
}

pub(super) fn sample_windows(
    rows: u64,
    sample_size: u32,
    strategy: &TableDataCompareSamplingStrategy,
) -> Result<Vec<SampleWindow>, String> {
    if sample_size == 0
        || sample_size > MAX_DATA_COMPARE_SAMPLE_SIZE
        || rows > MAX_SAMPLED_DATA_COMPARE_MAX_ROWS
    {
        return Err("Data compare sample exceeds its row budget".into());
    }
    let size = rows.min(u64::from(sample_size));
    let mut windows = Vec::new();
    match strategy {
        TableDataCompareSamplingStrategy::ExtremeValues => {
            for (descending, count) in [(false, size.div_ceil(2)), (true, size / 2)] {
                let mut offset = 0;
                while offset < count {
                    let limit = (count - offset).min(DEFAULT_QUERY_RESULT_ROW_LIMIT as u64) as u32;
                    windows.push(SampleWindow {
                        offset,
                        limit,
                        descending,
                    });
                    offset += u64::from(limit);
                }
            }
        }
        TableDataCompareSamplingStrategy::Stratified => {
            let count = size.min(MAX_WINDOWS);
            for index in 0..count {
                // Front-loaded remainders in both distributions guarantee that
                // each stratum can hold its sample, including very small tables.
                let begin = index * (rows / count) + index.min(rows % count);
                let span = rows / count + u64::from(index < rows % count);
                let take = size / count + u64::from(index < size % count);
                let start = if count == 1 {
                    begin + (span - take) / 2
                } else if index == 0 {
                    0
                } else if index + 1 == count {
                    rows - take
                } else {
                    begin + (span - take) / 2
                };
                let reverse = rows - start - take;
                windows.push(SampleWindow {
                    offset: start.min(reverse),
                    limit: take as u32,
                    descending: reverse < start,
                });
            }
        }
    }
    if windows.len() > MAX_WINDOWS as usize
        || windows
            .iter()
            .any(|window| window.limit as usize > DEFAULT_QUERY_RESULT_ROW_LIMIT)
        || windows
            .iter()
            .map(|window| window.offset + u64::from(window.limit))
            .sum::<u64>()
            > MAX_KEY_POSITIONS
    {
        return Err("Data compare sample exceeds its key-window budget".into());
    }
    Ok(windows)
}

pub(super) fn sample_window_sql(
    kind: DatabaseKind,
    endpoint: &TableDataCompareEndpoint,
    columns: &[String],
    window: &SampleWindow,
) -> String {
    let selected = columns
        .iter()
        .map(|column| kind.quote_identifier(column))
        .collect::<Vec<_>>()
        .join(", ");
    let direction = if window.descending { "DESC" } else { "ASC" };
    let order = columns
        .iter()
        .map(|column| format!("{} {direction}", kind.quote_identifier(column)))
        .collect::<Vec<_>>()
        .join(", ");
    let relation = kind.qualified_table(schema_option(&endpoint.schema), &endpoint.table);
    format!(
        "SELECT {selected} FROM {relation} ORDER BY {order} LIMIT {} OFFSET {};",
        window.limit, window.offset
    )
}

async fn cancel_sample_query(
    manager: &ConnectionManager,
    endpoint: &TableDataCompareEndpoint,
    query_id: &str,
) {
    let _ = tokio::time::timeout(
        Duration::from_secs(2),
        manager.cancel_query(&endpoint.connection_id, query_id),
    )
    .await;
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn fetch_data_compare_sample_keys(
    manager: &ConnectionManager,
    endpoint: &TableDataCompareEndpoint,
    query_id: &str,
    cancellation: &watch::Receiver<bool>,
    kind: DatabaseKind,
    key_columns: &[String],
    sample_size: u32,
    row_count: u64,
    strategy: &TableDataCompareSamplingStrategy,
    mut progress: impl FnMut(u64),
) -> Result<Vec<Vec<Value>>, String> {
    if key_columns.is_empty() {
        return Err("Data compare sample requires unique key columns".into());
    }
    let windows = sample_windows(row_count, sample_size, strategy)?;
    let deadline = Instant::now() + SELECTION_TIMEOUT;
    let mut cancellation = cancellation.clone();
    let mut keys = BTreeMap::new();
    let mut bytes = 0_usize;
    for window in windows {
        ensure_table_data_compare_not_cancelled(&cancellation)?;
        let sql = sample_window_sql(kind, endpoint, key_columns, &window);
        let query = query_data_compare_target_tracked(manager, endpoint, query_id, &sql);
        tokio::pin!(query);
        let result = tokio::select! {
            biased;
            _ = cancellation.changed() => {
                cancel_sample_query(manager, endpoint, query_id).await;
                return Err(TABLE_DATA_COMPARE_CANCELLED.into());
            }
            _ = tokio::time::sleep_until(deadline.min(Instant::now() + QUERY_TIMEOUT)) => {
                cancel_sample_query(manager, endpoint, query_id).await;
                return Err("Data compare sample key selection exceeded its time budget".into());
            }
            result = &mut query => result.map_err(|error| error.to_string())?,
        };
        ensure_table_data_compare_not_cancelled(&cancellation)?;
        if result.len() != 1 || result[0].truncated || result[0].rows.len() != window.limit as usize
        {
            return Err("Data compare sample window was incomplete; the table changed or the driver truncated the result".into());
        }
        for row in &result[0].rows {
            let values = data_compare_key_values(key_columns, row)?;
            if values.iter().any(Value::is_null) {
                return Err("Sampled data compare cannot continue from a NULL key value".into());
            }
            let key = canonical_data_compare_key_values(&values)?;
            bytes = bytes.saturating_add(key.len());
            if bytes > MAX_KEY_BYTES {
                return Err("Data compare sample keys exceed their 16 MiB budget".into());
            }
            if keys.insert(key, values).is_some() {
                return Err("Data compare sample windows overlapped; compare again after table changes settle".into());
            }
        }
        progress(keys.len() as u64);
    }
    ensure_table_data_compare_not_cancelled(&cancellation)?;
    Ok(keys.into_values().collect())
}
