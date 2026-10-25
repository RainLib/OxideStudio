//! Compare rows for table operations.

use super::access::{query_data_compare_target_tracked, query_target_parameterized};
use super::compare_runtime::{
    emit_running_table_data_compare_progress, ensure_table_data_compare_not_cancelled,
};
use super::compare_types::{
    TableDataCompareDegradationLevel, TableDataCompareDegradationThreshold,
    TableDataCompareEndpoint, TableDataCompareModifiedRow, TableDataCompareProgressPhase,
    TableDataCompareResult, TableDataCompareRow, TableDataCompareSamplingStrategy,
};
use super::limits::{
    MAX_DATA_COMPARE_SAMPLE_QUERY_PARAMETERS, MAX_DATA_COMPARE_SAMPLE_SIZE,
    MAX_FULL_DATA_COMPARE_DETAIL_ROWS_PER_STATUS, MAX_FULL_DATA_COMPARE_ROWS,
    MAX_SAMPLED_DATA_COMPARE_MAX_ROWS,
};
use super::policy::schema_option;
use super::row_sql::query_parameter;
use super::row_types::{TableFilter, TableSort};
use super::transfer_types::TableDataTransferEndpoint;
use super::values::value_to_u64;
use crate::core::dialect::DatabaseKind;
use crate::core::manager::ConnectionManager;
use crate::core::protocol::ColumnInfo;
use crate::core::protocol::QueryParameter;
use crate::core::protocol::QueryResult;
use serde_json::Value;
use sha2::Digest;
use sha2::Sha256;
use std::collections::BTreeMap;
use std::collections::BTreeSet;
use std::collections::HashSet;
use tauri::AppHandle;
use tokio::sync::watch;

pub(super) fn preview_metadata_required(
    structured_filters: Option<&[TableFilter]>,
    requested_sort: Option<&TableSort>,
) -> bool {
    structured_filters.is_some() || requested_sort.is_some()
}

pub(super) fn data_compare_transfer_endpoint(
    endpoint: &TableDataCompareEndpoint,
) -> TableDataTransferEndpoint {
    TableDataTransferEndpoint {
        connection_id: endpoint.connection_id.clone(),
        driver: endpoint.driver.clone(),
        schema: endpoint.schema.clone(),
        table: endpoint.table.clone(),
        database: endpoint.database.clone(),
    }
}

pub(super) fn data_compare_row_count(result: &[QueryResult]) -> Result<u64, String> {
    result
        .first()
        .and_then(|set| set.rows.first())
        .and_then(|row| row.first())
        .and_then(value_to_u64)
        .ok_or_else(|| "COUNT query returned no numeric row count".to_string())
}

pub(super) fn data_compare_row_values(
    columns: &[String],
    row: &[Value],
) -> BTreeMap<String, Value> {
    columns
        .iter()
        .enumerate()
        .map(|(index, column)| {
            (
                column.clone(),
                row.get(index).cloned().unwrap_or(Value::Null),
            )
        })
        .collect()
}

pub(super) fn data_compare_key(values: &BTreeMap<String, Value>, key_columns: &[String]) -> String {
    key_columns
        .iter()
        .map(|column| {
            serde_json::to_string(values.get(column).unwrap_or(&Value::Null)).unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join("\u{001f}")
}

pub(super) fn data_compare_key_columns_are_declared_unique(
    columns: &BTreeMap<String, ColumnInfo>,
    key_columns: &[String],
) -> bool {
    let selected = key_columns.iter().collect::<HashSet<_>>();
    let primary = columns
        .values()
        .filter(|column| column.is_primary_key)
        .map(|column| &column.name)
        .collect::<Vec<_>>();
    let selects_full_primary_key =
        !primary.is_empty() && primary.iter().all(|column| selected.contains(column));
    selects_full_primary_key
        || key_columns.iter().any(|column| {
            columns
                .get(column)
                .map(|metadata| metadata.is_unique)
                .unwrap_or(false)
        })
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn fetch_full_data_compare_rows(
    app: &AppHandle,
    manager: &ConnectionManager,
    endpoint: &TableDataCompareEndpoint,
    endpoint_name: &str,
    compare_id: &str,
    query_id: &str,
    cancellation: &watch::Receiver<bool>,
    kind: DatabaseKind,
    columns: &[String],
    column_metadata: &BTreeMap<String, ColumnInfo>,
    key_columns: &[String],
    batch_size: u32,
) -> Result<Vec<BTreeMap<String, Value>>, String> {
    let selected = columns
        .iter()
        .map(|column| kind.quote_identifier(column))
        .collect::<Vec<_>>()
        .join(", ");
    let order = key_columns
        .iter()
        .map(|column| format!("{} ASC", kind.quote_identifier(column)))
        .collect::<Vec<_>>()
        .join(", ");
    let relation = kind.qualified_table(schema_option(&endpoint.schema), &endpoint.table);
    let key_metadata = key_columns
        .iter()
        .map(|column| {
            column_metadata.get(column).cloned().ok_or_else(|| {
                format!("Missing metadata for full data compare key column {column}")
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    if let Some(column) = key_metadata.iter().find(|column| column.is_nullable) {
        return Err(format!(
            "Full data compare key column {} must be NOT NULL for keyset pagination",
            column.name
        ));
    }
    let mut cursor: Option<Vec<Value>> = None;
    let mut rows = Vec::new();
    let typed_postgres_parameters =
        data_compare_uses_typed_postgres_parameters(kind, &endpoint.driver);
    loop {
        ensure_table_data_compare_not_cancelled(cancellation)?;
        let (continuation, params) = data_compare_keyset_continuation(
            kind,
            &key_metadata,
            cursor.as_deref(),
            typed_postgres_parameters,
        )?;
        let where_clause = continuation
            .as_deref()
            .map(|condition| format!(" WHERE {condition}"))
            .unwrap_or_default();
        let sql = format!(
            "SELECT {selected} FROM {relation}{where_clause} ORDER BY {order} LIMIT {batch_size};"
        );
        let query_result = if params.is_empty() {
            query_data_compare_target_tracked(manager, endpoint, query_id, &sql).await
        } else {
            query_target_parameterized(
                manager,
                &endpoint.connection_id,
                endpoint.database.as_deref(),
                &sql,
                &params,
            )
            .await
        };
        ensure_table_data_compare_not_cancelled(cancellation)?;
        let mut result = query_result.map_err(|error| error.to_string())?;
        let page = result
            .drain(..)
            .next()
            .unwrap_or_else(|| QueryResult::rows(Vec::new(), Vec::new()));
        let fetched = page.rows.len() as u32;
        let page_values = page
            .rows
            .iter()
            .map(|row| data_compare_row_values(columns, row))
            .collect::<Vec<_>>();
        cursor = page_values.last().map(|values| {
            key_columns
                .iter()
                .map(|column| values.get(column).cloned().unwrap_or(Value::Null))
                .collect()
        });
        rows.extend(page_values);
        emit_running_table_data_compare_progress(
            app,
            compare_id,
            TableDataCompareProgressPhase::FetchingRows,
            Some(endpoint_name),
            rows.len() as u64,
            None,
            None,
            Some("Reading table rows with stable keyset pagination"),
        );
        if fetched < batch_size {
            break;
        }
    }
    Ok(rows)
}

/// Builds `(key_1 > $1) OR (key_1 = $2 AND key_2 > $3) ...` with bound
/// values. Identifier names and placeholders remain host owned, while row
/// values never enter SQL text.
pub(super) fn data_compare_keyset_continuation(
    kind: DatabaseKind,
    key_columns: &[ColumnInfo],
    cursor: Option<&[Value]>,
    typed_postgres_parameters: bool,
) -> Result<(Option<String>, Vec<QueryParameter>), String> {
    let Some(cursor) = cursor else {
        return Ok((None, Vec::new()));
    };
    if cursor.len() != key_columns.len() {
        return Err(
            "Full data compare keyset cursor does not match selected key columns".to_string(),
        );
    }
    if cursor.iter().any(Value::is_null) {
        return Err("Full data compare keyset cannot continue from a NULL key value".to_string());
    }
    let mut clauses = Vec::with_capacity(key_columns.len());
    let mut params = Vec::with_capacity(key_columns.len() * (key_columns.len() + 1) / 2);
    for index in 0..key_columns.len() {
        let mut comparisons = Vec::with_capacity(index + 1);
        for prefix in 0..index {
            let column = &key_columns[prefix];
            params.push(query_parameter(column, &cursor[prefix]));
            comparisons.push(format!(
                "{} = {}",
                kind.quote_identifier(&column.name),
                data_compare_parameter_placeholder(
                    kind,
                    params.len(),
                    &column.data_type,
                    typed_postgres_parameters,
                ),
            ));
        }
        let column = &key_columns[index];
        params.push(query_parameter(column, &cursor[index]));
        comparisons.push(format!(
            "{} > {}",
            kind.quote_identifier(&column.name),
            data_compare_parameter_placeholder(
                kind,
                params.len(),
                &column.data_type,
                typed_postgres_parameters,
            ),
        ));
        clauses.push(format!("({})", comparisons.join(" AND ")));
    }
    Ok((Some(format!("({})", clauses.join(" OR "))), params))
}

pub(super) fn data_compare_uses_typed_postgres_parameters(
    kind: DatabaseKind,
    driver: &str,
) -> bool {
    kind == DatabaseKind::Postgres
        && !matches!(
            driver.trim().to_ascii_lowercase().as_str(),
            "sqlite" | "sqlite3" | "rqlite"
        )
}

pub(super) fn data_compare_parameter_placeholder(
    kind: DatabaseKind,
    index: usize,
    data_type: &str,
    typed_postgres_parameters: bool,
) -> String {
    if kind == DatabaseKind::Postgres && !typed_postgres_parameters {
        format!("${index}")
    } else {
        kind.parameter_placeholder(index, data_type)
    }
}

pub(super) fn normalized_data_compare_threshold(
    legacy_max_rows: Option<u32>,
    threshold: Option<TableDataCompareDegradationThreshold>,
) -> Result<TableDataCompareDegradationThreshold, String> {
    if legacy_max_rows.is_some() && threshold.is_some() {
        return Err(
            "Use either maxRows or degradationThreshold for data comparison, not both".to_string(),
        );
    }
    let threshold = threshold.unwrap_or_else(|| {
        let mut threshold = TableDataCompareDegradationThreshold::default();
        if let Some(max_rows) = legacy_max_rows {
            threshold.full_compare_max_rows = u64::from(max_rows.clamp(1, 100_000));
        }
        threshold
    });
    if threshold.full_compare_max_rows == 0
        || threshold.full_compare_max_rows > MAX_FULL_DATA_COMPARE_ROWS
    {
        return Err(format!(
            "Full data compare row threshold must be between 1 and {MAX_FULL_DATA_COMPARE_ROWS}"
        ));
    }
    if threshold.sample_max_rows < threshold.full_compare_max_rows
        || threshold.sample_max_rows > MAX_SAMPLED_DATA_COMPARE_MAX_ROWS
    {
        return Err(format!(
            "Sampled data compare row threshold must be between the full threshold and {MAX_SAMPLED_DATA_COMPARE_MAX_ROWS}"
        ));
    }
    if threshold.sample_size == 0 || threshold.sample_size > MAX_DATA_COMPARE_SAMPLE_SIZE {
        return Err(format!(
            "Data compare sample size must be between 1 and {MAX_DATA_COMPARE_SAMPLE_SIZE}"
        ));
    }
    Ok(threshold)
}

pub(super) fn data_compare_degradation_level(
    source_row_count: u64,
    target_row_count: u64,
    threshold: &TableDataCompareDegradationThreshold,
) -> TableDataCompareDegradationLevel {
    let maximum = source_row_count.max(target_row_count);
    if maximum <= threshold.full_compare_max_rows {
        TableDataCompareDegradationLevel::Full
    } else if maximum <= threshold.sample_max_rows {
        TableDataCompareDegradationLevel::Sample
    } else {
        TableDataCompareDegradationLevel::SkipWithRisk
    }
}

pub(super) fn data_compare_key_values(
    key_columns: &[String],
    row: &[Value],
) -> Result<Vec<Value>, String> {
    if row.len() < key_columns.len() {
        return Err("Sampled data compare key query returned an incomplete row".to_string());
    }
    Ok(row.iter().take(key_columns.len()).cloned().collect())
}

pub(super) fn canonical_data_compare_key_values(values: &[Value]) -> Result<String, String> {
    serde_json::to_string(values)
        .map_err(|error| format!("Could not encode sampled data compare key: {error}"))
}

pub(super) fn merge_data_compare_sample_keys(
    source: Vec<Vec<Value>>,
    target: Vec<Vec<Value>>,
) -> Result<Vec<Vec<Value>>, String> {
    let mut keys = BTreeMap::<String, Vec<Value>>::new();
    for values in source.into_iter().chain(target) {
        keys.entry(canonical_data_compare_key_values(&values)?)
            .or_insert(values);
    }
    Ok(keys.into_values().collect())
}

pub(super) fn data_compare_sample_coverage(
    source_sample_rows: usize,
    target_sample_rows: usize,
    source_rows: u64,
    target_rows: u64,
) -> f64 {
    let rate = |sample: usize, rows: u64| {
        if rows == 0 {
            1.0
        } else {
            (sample as f64 / rows as f64).min(1.0)
        }
    };
    rate(source_sample_rows, source_rows).min(rate(target_sample_rows, target_rows))
}

pub(super) fn data_compare_sample_key_predicate(
    kind: DatabaseKind,
    key_columns: &[ColumnInfo],
    sampled_keys: &[Vec<Value>],
    typed_postgres_parameters: bool,
) -> Result<(String, Vec<QueryParameter>), String> {
    if key_columns.is_empty() || sampled_keys.is_empty() {
        return Err("Sampled data compare requires key columns and sampled keys".to_string());
    }
    let mut clauses = Vec::with_capacity(sampled_keys.len());
    let mut params = Vec::with_capacity(sampled_keys.len() * key_columns.len());
    for values in sampled_keys {
        if values.len() != key_columns.len() {
            return Err("Sampled data compare key does not match selected key columns".to_string());
        }
        if values.iter().any(Value::is_null) {
            return Err("Sampled data compare key cannot contain NULL".to_string());
        }
        let mut comparisons = Vec::with_capacity(key_columns.len());
        for (column, value) in key_columns.iter().zip(values) {
            params.push(query_parameter(column, value));
            comparisons.push(format!(
                "{} = {}",
                kind.quote_identifier(&column.name),
                data_compare_parameter_placeholder(
                    kind,
                    params.len(),
                    &column.data_type,
                    typed_postgres_parameters,
                ),
            ));
        }
        clauses.push(format!("({})", comparisons.join(" AND ")));
    }
    Ok((format!("({})", clauses.join(" OR ")), params))
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn fetch_sampled_data_compare_rows(
    manager: &ConnectionManager,
    endpoint: &TableDataCompareEndpoint,
    cancellation: &watch::Receiver<bool>,
    kind: DatabaseKind,
    columns: &[String],
    column_metadata: &BTreeMap<String, ColumnInfo>,
    key_columns: &[String],
    sampled_keys: &[Vec<Value>],
    mut progress: impl FnMut(u64),
) -> Result<Vec<BTreeMap<String, Value>>, String> {
    if sampled_keys.is_empty() {
        return Ok(Vec::new());
    }
    if key_columns.len() > MAX_DATA_COMPARE_SAMPLE_QUERY_PARAMETERS {
        return Err(format!(
            "Sampled data compare supports at most {MAX_DATA_COMPARE_SAMPLE_QUERY_PARAMETERS} key columns"
        ));
    }
    let key_metadata = key_columns
        .iter()
        .map(|column| {
            column_metadata.get(column).cloned().ok_or_else(|| {
                format!("Missing metadata for sampled data compare key column {column}")
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    if let Some(column) = key_metadata.iter().find(|column| column.is_nullable) {
        return Err(format!(
            "Sampled data compare key column {} must be NOT NULL",
            column.name
        ));
    }
    let selected = columns
        .iter()
        .map(|column| kind.quote_identifier(column))
        .collect::<Vec<_>>()
        .join(", ");
    let relation = kind.qualified_table(schema_option(&endpoint.schema), &endpoint.table);
    let order = key_columns
        .iter()
        .map(|column| format!("{} ASC", kind.quote_identifier(column)))
        .collect::<Vec<_>>()
        .join(", ");
    let typed_postgres_parameters =
        data_compare_uses_typed_postgres_parameters(kind, &endpoint.driver);
    let keys_per_batch =
        (MAX_DATA_COMPARE_SAMPLE_QUERY_PARAMETERS / key_columns.len()).clamp(1, 500);
    let mut rows = Vec::with_capacity(sampled_keys.len());
    let mut payload_bytes = 0_usize;
    for keys in sampled_keys.chunks(keys_per_batch) {
        ensure_table_data_compare_not_cancelled(cancellation)?;
        let (predicate, params) = data_compare_sample_key_predicate(
            kind,
            &key_metadata,
            keys,
            typed_postgres_parameters,
        )?;
        let limit = keys.len() + 1;
        let sql = format!(
            "SELECT {selected} FROM {relation} WHERE {predicate} ORDER BY {order} LIMIT {limit};"
        );
        let query_result = query_target_parameterized(
            manager,
            &endpoint.connection_id,
            endpoint.database.as_deref(),
            &sql,
            &params,
        )
        .await;
        ensure_table_data_compare_not_cancelled(cancellation)?;
        let mut result = query_result.map_err(|error| error.to_string())?;
        let page = result
            .drain(..)
            .next()
            .unwrap_or_else(|| QueryResult::rows(Vec::new(), Vec::new()));
        if page.truncated {
            return Err("Data compare sampled row lookup was truncated by the driver".into());
        }
        if page.rows.len() > keys.len() {
            return Err(
                "Sampled data compare observed duplicate rows for a declared unique key"
                    .to_string(),
            );
        }
        for row in &page.rows {
            let values = data_compare_row_values(columns, row);
            payload_bytes = payload_bytes.saturating_add(
                serde_json::to_vec(&values)
                    .map_err(|error| error.to_string())?
                    .len(),
            );
            if payload_bytes > 64 * 1024 * 1024 {
                return Err("Data compare sampled values exceed their 64 MiB budget".into());
            }
            rows.push(values);
        }
        progress(rows.len() as u64);
    }
    Ok(rows)
}

pub(super) fn data_compare_column_checksums(
    columns: &[String],
    ordered_keys: &[String],
    rows: &BTreeMap<String, BTreeMap<String, Value>>,
    cancellation: &watch::Receiver<bool>,
) -> Result<BTreeMap<String, String>, String> {
    let mut hashers = columns
        .iter()
        .map(|column| (column.clone(), Sha256::new()))
        .collect::<BTreeMap<_, _>>();
    for (index, key) in ordered_keys.iter().enumerate() {
        if index % 256 == 0 {
            ensure_table_data_compare_not_cancelled(cancellation)?;
        }
        for column in columns {
            let hasher = hashers
                .get_mut(column)
                .expect("checksum hasher exists for every selected column");
            hasher.update((key.len() as u64).to_be_bytes());
            hasher.update(key.as_bytes());
            if let Some(row) = rows.get(key) {
                hasher.update([1]);
                let encoded = serde_json::to_vec(row.get(column).unwrap_or(&Value::Null))
                    .unwrap_or_else(|_| b"null".to_vec());
                hasher.update((encoded.len() as u64).to_be_bytes());
                hasher.update(encoded);
            } else {
                hasher.update([0]);
            }
        }
    }
    Ok(hashers
        .into_iter()
        .map(|(column, hasher)| (column, format!("{:x}", hasher.finalize())))
        .collect())
}

#[allow(clippy::too_many_arguments)]
pub(super) fn build_table_data_compare_result(
    source_rows: Vec<BTreeMap<String, Value>>,
    target_rows: Vec<BTreeMap<String, Value>>,
    columns: &[String],
    key_columns: &[String],
    source_row_count: u64,
    target_row_count: u64,
    batch_size: u32,
    degradation_level: TableDataCompareDegradationLevel,
    sampling_strategy: Option<TableDataCompareSamplingStrategy>,
    sampling_rate: f64,
    confidence_score: Option<f64>,
    verification_method: &str,
    enable_checksum: bool,
    cancellation: &watch::Receiver<bool>,
) -> Result<TableDataCompareResult, String> {
    let mut source = BTreeMap::new();
    for (index, values) in source_rows.into_iter().enumerate() {
        if index % 256 == 0 {
            ensure_table_data_compare_not_cancelled(cancellation)?;
        }
        let key = data_compare_key(&values, key_columns);
        if source.insert(key.clone(), values).is_some() {
            return Err(format!("Duplicate source key: {key}"));
        }
    }
    let mut target = BTreeMap::new();
    for (index, values) in target_rows.into_iter().enumerate() {
        if index % 256 == 0 {
            ensure_table_data_compare_not_cancelled(cancellation)?;
        }
        let key = data_compare_key(&values, key_columns);
        if target.insert(key.clone(), values).is_some() {
            return Err(format!("Duplicate target key: {key}"));
        }
    }
    let ordered_keys = source
        .keys()
        .chain(target.keys())
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let mut added = Vec::new();
    let mut removed = Vec::new();
    let mut modified = Vec::new();
    let mut added_count = 0_u64;
    let mut removed_count = 0_u64;
    let mut modified_count = 0_u64;
    let mut equal_count = 0_u64;
    for (index, key) in ordered_keys.iter().enumerate() {
        if index % 256 == 0 {
            ensure_table_data_compare_not_cancelled(cancellation)?;
        }
        match (source.get(key), target.get(key)) {
            (Some(source_values), None) => {
                added_count += 1;
                if added.len() < MAX_FULL_DATA_COMPARE_DETAIL_ROWS_PER_STATUS {
                    added.push(TableDataCompareRow {
                        key: key.clone(),
                        values: source_values.clone(),
                    });
                }
            }
            (None, Some(target_values)) => {
                removed_count += 1;
                if removed.len() < MAX_FULL_DATA_COMPARE_DETAIL_ROWS_PER_STATUS {
                    removed.push(TableDataCompareRow {
                        key: key.clone(),
                        values: target_values.clone(),
                    });
                }
            }
            (Some(source_values), Some(target_values)) => {
                let changed_columns = columns
                    .iter()
                    .filter(|column| !key_columns.contains(column))
                    .filter(|column| source_values.get(*column) != target_values.get(*column))
                    .cloned()
                    .collect::<Vec<_>>();
                if changed_columns.is_empty() {
                    equal_count += 1;
                } else {
                    modified_count += 1;
                    if modified.len() < MAX_FULL_DATA_COMPARE_DETAIL_ROWS_PER_STATUS {
                        modified.push(TableDataCompareModifiedRow {
                            key: key.clone(),
                            source_values: source_values.clone(),
                            target_values: target_values.clone(),
                            changed_columns,
                        });
                    }
                }
            }
            (None, None) => unreachable!("key union contains at least one row"),
        }
    }
    let (source_checksums, target_checksums, checksums_match) = if enable_checksum {
        let source_checksums =
            data_compare_column_checksums(columns, &ordered_keys, &source, cancellation)?;
        let target_checksums =
            data_compare_column_checksums(columns, &ordered_keys, &target, cancellation)?;
        let checksums_match = source_checksums == target_checksums;
        (
            Some(source_checksums),
            Some(target_checksums),
            Some(checksums_match),
        )
    } else {
        (None, None, None)
    };
    let detail_limit_per_status = MAX_FULL_DATA_COMPARE_DETAIL_ROWS_PER_STATUS as u32;
    let details_truncated = added_count > added.len() as u64
        || removed_count > removed.len() as u64
        || modified_count > modified.len() as u64;
    let counts_exact = degradation_level == TableDataCompareDegradationLevel::Full;
    Ok(TableDataCompareResult {
        added,
        removed,
        modified,
        added_count,
        removed_count,
        modified_count,
        equal_count,
        source_row_count,
        target_row_count,
        compared_key_count: ordered_keys.len() as u64,
        batch_size,
        detail_limit_per_status,
        details_truncated,
        degradation_level,
        sampling_strategy,
        sampling_rate,
        confidence_score,
        verification_method: verification_method.to_string(),
        counts_exact,
        sampled_key_count: ordered_keys.len() as u64,
        source_checksums,
        target_checksums,
        checksums_match,
    })
}

pub(super) fn skipped_table_data_compare_result(
    source_row_count: u64,
    target_row_count: u64,
    batch_size: u32,
) -> TableDataCompareResult {
    TableDataCompareResult {
        added: Vec::new(),
        removed: Vec::new(),
        modified: Vec::new(),
        added_count: 0,
        removed_count: 0,
        modified_count: 0,
        equal_count: 0,
        source_row_count,
        target_row_count,
        compared_key_count: 0,
        batch_size,
        detail_limit_per_status: MAX_FULL_DATA_COMPARE_DETAIL_ROWS_PER_STATUS as u32,
        details_truncated: false,
        degradation_level: TableDataCompareDegradationLevel::SkipWithRisk,
        sampling_strategy: None,
        sampling_rate: 0.0,
        confidence_score: None,
        verification_method: "skipped_size_limit".to_string(),
        counts_exact: false,
        sampled_key_count: 0,
        source_checksums: None,
        target_checksums: None,
        checksums_match: None,
    }
}
