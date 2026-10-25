//! Compare execute for table operations.

use super::access::{get_target_columns, query_data_compare_target_tracked};
use super::compare_rows::{
    build_table_data_compare_result, data_compare_degradation_level,
    data_compare_key_columns_are_declared_unique, data_compare_row_count,
    data_compare_sample_coverage, data_compare_transfer_endpoint, fetch_full_data_compare_rows,
    fetch_sampled_data_compare_rows, merge_data_compare_sample_keys,
    normalized_data_compare_threshold, skipped_table_data_compare_result,
};
use super::compare_runtime::{
    emit_running_table_data_compare_progress, emit_table_data_compare_progress,
    ensure_table_data_compare_not_cancelled, validate_table_data_compare_id,
};
use super::compare_sampling::fetch_data_compare_sample_keys;
use super::compare_types::{
    TableDataCompareCancellationState, TableDataCompareDegradationLevel, TableDataCompareProgress,
    TableDataCompareProgressPhase, TableDataCompareProgressStatus, TableDataCompareRequest,
    TableDataCompareResult, TableDataCompareSamplingStrategy,
};
use super::limits::{MAX_FULL_DATA_COMPARE_BATCH_SIZE, TABLE_DATA_COMPARE_CANCELLED};
use super::policy::{schema_option, table_data_transfer_dialect};
use super::row_sql::column_lookup;
use super::transfer_runtime::bounded_table_data_transfer_message;
use crate::core::manager::ConnectionManager;
use crate::core::protocol::Response;
use std::collections::HashSet;
use tauri::AppHandle;
use tauri::State;

#[tauri::command]
pub async fn compare_table_data_full(
    app: AppHandle,
    manager: State<'_, ConnectionManager>,
    cancellation_state: State<'_, TableDataCompareCancellationState>,
    request: TableDataCompareRequest,
) -> Result<Response<TableDataCompareResult>, String> {
    let compare_id = request.compare_id.trim().to_string();
    let (compare_cancellation, source_query_id, target_query_id) = cancellation_state
        .register(
            &compare_id,
            &request.source.connection_id,
            &request.target.connection_id,
        )
        .await?;
    emit_running_table_data_compare_progress(
        &app,
        &compare_id,
        TableDataCompareProgressPhase::Validating,
        None,
        0,
        None,
        None,
        Some("Validating table metadata and comparison keys"),
    );
    let result: Result<TableDataCompareResult, String> = async {
        ensure_table_data_compare_not_cancelled(&compare_cancellation)?;
        let columns = request
            .columns
            .into_iter()
            .map(|column| column.trim().to_string())
            .filter(|column| !column.is_empty())
            .collect::<Vec<_>>();
        let key_columns = request
            .key_columns
            .into_iter()
            .map(|column| column.trim().to_string())
            .filter(|column| !column.is_empty())
            .collect::<Vec<_>>();
        if columns.is_empty() || key_columns.is_empty() {
            return Err("Full data comparison requires selected columns and at least one key column".to_string());
        }
        if columns.iter().collect::<HashSet<_>>().len() != columns.len()
            || key_columns.iter().collect::<HashSet<_>>().len() != key_columns.len()
        {
            return Err("Data comparison columns and key columns must be unique".to_string());
        }
        if key_columns.iter().any(|key| !columns.contains(key)) {
            return Err("Every data comparison key column must be selected for comparison".to_string());
        }
        let source_endpoint = data_compare_transfer_endpoint(&request.source);
        let target_endpoint = data_compare_transfer_endpoint(&request.target);
        let source_kind = table_data_transfer_dialect(&manager, &source_endpoint).await?;
        let target_kind = table_data_transfer_dialect(&manager, &target_endpoint).await?;
        let batch_size = request
            .batch_size
            .unwrap_or(1_000)
            .clamp(100, MAX_FULL_DATA_COMPARE_BATCH_SIZE);
        let threshold = normalized_data_compare_threshold(
            request.max_rows,
            request.degradation_threshold,
        )?;
        let sampling_strategy = request
            .sampling_strategy
            .unwrap_or(TableDataCompareSamplingStrategy::Stratified);
        let verification_method = match &sampling_strategy {
            TableDataCompareSamplingStrategy::ExtremeValues => "extreme_key_sample",
            TableDataCompareSamplingStrategy::Stratified => "stratified_key_sample",
        };
        let enable_checksum = request.enable_checksum.unwrap_or(true);
        let (source_columns, target_columns) = tokio::try_join!(
            get_target_columns(
                &manager,
                &request.source.connection_id,
                request.source.database.as_deref(),
                &request.source.schema,
                &request.source.table,
            ),
            get_target_columns(
                &manager,
                &request.target.connection_id,
                request.target.database.as_deref(),
                &request.target.schema,
                &request.target.table,
            ),
        )
        .map_err(|error| error.to_string())?;
        ensure_table_data_compare_not_cancelled(&compare_cancellation)?;
        let source_columns = column_lookup(source_columns);
        let target_columns = column_lookup(target_columns);
        for column in &columns {
            if !source_columns.contains_key(column) || !target_columns.contains_key(column) {
                return Err(format!(
                    "Data compare column {column} is not available on both table endpoints"
                ));
            }
        }
        for key in &key_columns {
            if !source_columns.contains_key(key) || !target_columns.contains_key(key) {
                return Err(format!(
                    "Full data compare key column {key} is not available on both table endpoints"
                ));
            }
        }
        if !data_compare_key_columns_are_declared_unique(&source_columns, &key_columns)
            || !data_compare_key_columns_are_declared_unique(&target_columns, &key_columns)
        {
            return Err(
                "Full data compare requires keys declared unique on both table endpoints for stable keyset pagination"
                    .to_string(),
            );
        }
        let source_count_sql = source_kind.count_table_query(schema_option(&request.source.schema), &request.source.table, None);
        let target_count_sql = target_kind.count_table_query(schema_option(&request.target.schema), &request.target.table, None);
        emit_running_table_data_compare_progress(
            &app,
            &compare_id,
            TableDataCompareProgressPhase::Counting,
            None,
            0,
            None,
            None,
            Some("Counting both table endpoints"),
        );
        let source_count_cancellation = compare_cancellation.clone();
        let target_count_cancellation = compare_cancellation.clone();
        let source_count = async {
            ensure_table_data_compare_not_cancelled(&source_count_cancellation)?;
            let result = query_data_compare_target_tracked(
                &manager,
                &request.source,
                &source_query_id,
                &source_count_sql,
            )
            .await;
            ensure_table_data_compare_not_cancelled(&source_count_cancellation)?;
            result.map_err(|error| error.to_string())
        };
        let target_count = async {
            ensure_table_data_compare_not_cancelled(&target_count_cancellation)?;
            let result = query_data_compare_target_tracked(
                &manager,
                &request.target,
                &target_query_id,
                &target_count_sql,
            )
            .await;
            ensure_table_data_compare_not_cancelled(&target_count_cancellation)?;
            result.map_err(|error| error.to_string())
        };
        let (source_count_result, target_count_result) =
            tokio::try_join!(source_count, target_count)?;
        let source_row_count = data_compare_row_count(&source_count_result)?;
        let target_row_count = data_compare_row_count(&target_count_result)?;
        emit_running_table_data_compare_progress(
            &app,
            &compare_id,
            TableDataCompareProgressPhase::Counting,
            None,
            source_row_count.saturating_add(target_row_count),
            Some(source_row_count),
            Some(target_row_count),
            Some("Row counts captured"),
        );
        match data_compare_degradation_level(
            source_row_count,
            target_row_count,
            &threshold,
        ) {
            TableDataCompareDegradationLevel::Full => {
                emit_running_table_data_compare_progress(
                    &app,
                    &compare_id,
                    TableDataCompareProgressPhase::FetchingRows,
                    None,
                    0,
                    Some(source_row_count),
                    Some(target_row_count),
                    Some("Reading complete table contents"),
                );
                let source_fetch_cancellation = compare_cancellation.clone();
                let target_fetch_cancellation = compare_cancellation.clone();
                let (source_rows, target_rows) = tokio::try_join!(
                    fetch_full_data_compare_rows(&app, &manager, &request.source, "source", &compare_id, &source_query_id, &source_fetch_cancellation, source_kind, &columns, &source_columns, &key_columns, batch_size),
                    fetch_full_data_compare_rows(&app, &manager, &request.target, "target", &compare_id, &target_query_id, &target_fetch_cancellation, target_kind, &columns, &target_columns, &key_columns, batch_size),
                )?;
                if source_rows.len() as u64 != source_row_count
                    || target_rows.len() as u64 != target_row_count
                {
                    return Err(format!(
                        "Full data compare did not fetch every counted row (source: {}/{source_row_count}, target: {}/{target_row_count})",
                        source_rows.len(),
                        target_rows.len(),
                    ));
                }
                ensure_table_data_compare_not_cancelled(&compare_cancellation)?;
                emit_running_table_data_compare_progress(
                    &app,
                    &compare_id,
                    TableDataCompareProgressPhase::Comparing,
                    None,
                    source_rows.len().saturating_add(target_rows.len()) as u64,
                    Some(source_row_count),
                    Some(target_row_count),
                    Some("Comparing keys, values, and column checksums"),
                );
                build_table_data_compare_result(
                    source_rows,
                    target_rows,
                    &columns,
                    &key_columns,
                    source_row_count,
                    target_row_count,
                    batch_size,
                    TableDataCompareDegradationLevel::Full,
                    None,
                    1.0,
                    Some(1.0),
                    "full_keyset",
                    enable_checksum,
                    &compare_cancellation,
                )
            }
            TableDataCompareDegradationLevel::Sample => {
                emit_running_table_data_compare_progress(
                    &app,
                    &compare_id,
                    TableDataCompareProgressPhase::SelectingSampleKeys,
                    None,
                    0,
                    Some(source_row_count),
                    Some(target_row_count),
                    Some("Selecting the deterministic shared sample universe"),
                );
                let source_key_cancellation = compare_cancellation.clone();
                let target_key_cancellation = compare_cancellation.clone();
                let sample_progress = |endpoint, processed| emit_running_table_data_compare_progress(
                    &app, &compare_id, TableDataCompareProgressPhase::SelectingSampleKeys,
                    Some(endpoint), processed, Some(source_row_count), Some(target_row_count),
                    Some("Selecting bounded shared sample keys"),
                );
                let (source_keys, target_keys) = tokio::try_join!(
                    fetch_data_compare_sample_keys(
                        &manager, &request.source, &source_query_id, &source_key_cancellation,
                        source_kind, &key_columns, threshold.sample_size, source_row_count,
                        &sampling_strategy, |processed| sample_progress("source", processed),
                    ),
                    fetch_data_compare_sample_keys(
                        &manager, &request.target, &target_query_id, &target_key_cancellation,
                        target_kind, &key_columns, threshold.sample_size, target_row_count,
                        &sampling_strategy, |processed| sample_progress("target", processed),
                    ),
                )?;
                ensure_table_data_compare_not_cancelled(&compare_cancellation)?;
                let sampled_keys = merge_data_compare_sample_keys(source_keys, target_keys)?;
                let source_sample_cancellation = compare_cancellation.clone();
                let target_sample_cancellation = compare_cancellation.clone();
                let (source_rows, target_rows) = tokio::try_join!(
                    fetch_sampled_data_compare_rows(
                        &manager,
                        &request.source,
                        &source_sample_cancellation,
                        source_kind,
                        &columns,
                        &source_columns,
                        &key_columns,
                        &sampled_keys,
                        |processed| emit_running_table_data_compare_progress(
                            &app, &compare_id, TableDataCompareProgressPhase::FetchingRows,
                            Some("source"), processed, Some(source_row_count), Some(target_row_count),
                            Some("Reading rows for the shared sample keys"),
                        ),
                    ),
                    fetch_sampled_data_compare_rows(
                        &manager,
                        &request.target,
                        &target_sample_cancellation,
                        target_kind,
                        &columns,
                        &target_columns,
                        &key_columns,
                        &sampled_keys,
                        |processed| emit_running_table_data_compare_progress(
                            &app, &compare_id, TableDataCompareProgressPhase::FetchingRows,
                            Some("target"), processed, Some(source_row_count), Some(target_row_count),
                            Some("Reading rows for the shared sample keys"),
                        ),
                    ),
                )?;
                let sampling_rate = data_compare_sample_coverage(
                    source_rows.len(), target_rows.len(), source_row_count, target_row_count,
                );
                emit_running_table_data_compare_progress(
                    &app,
                    &compare_id,
                    TableDataCompareProgressPhase::Comparing,
                    None,
                    sampled_keys.len() as u64,
                    Some(source_row_count),
                    Some(target_row_count),
                    Some("Comparing sampled keys, values, and column checksums"),
                );
                build_table_data_compare_result(
                    source_rows,
                    target_rows,
                    &columns,
                    &key_columns,
                    source_row_count,
                    target_row_count,
                    batch_size,
                    TableDataCompareDegradationLevel::Sample,
                    Some(sampling_strategy),
                    sampling_rate,
                    None,
                    verification_method,
                    enable_checksum,
                    &compare_cancellation,
                )
            }
            TableDataCompareDegradationLevel::SkipWithRisk => Ok(
                skipped_table_data_compare_result(
                    source_row_count,
                    target_row_count,
                    batch_size,
                ),
            ),
        }
    }
    .await;
    cancellation_state.take(&compare_id).await;
    match result {
        Ok(result) => {
            emit_table_data_compare_progress(
                &app,
                TableDataCompareProgress {
                    compare_id,
                    phase: TableDataCompareProgressPhase::Completed,
                    endpoint: None,
                    processed_rows: result.compared_key_count,
                    source_row_count: Some(result.source_row_count),
                    target_row_count: Some(result.target_row_count),
                    status: TableDataCompareProgressStatus::Done,
                    terminal: true,
                    message: Some("Table data comparison completed".to_string()),
                },
            );
            Ok(Response::ok(result))
        }
        Err(error) if error.contains(TABLE_DATA_COMPARE_CANCELLED) => {
            emit_table_data_compare_progress(
                &app,
                TableDataCompareProgress {
                    compare_id,
                    phase: TableDataCompareProgressPhase::Completed,
                    endpoint: None,
                    processed_rows: 0,
                    source_row_count: None,
                    target_row_count: None,
                    status: TableDataCompareProgressStatus::Cancelled,
                    terminal: true,
                    message: Some("Table data comparison cancelled".to_string()),
                },
            );
            Ok(Response::err(
                TABLE_DATA_COMPARE_CANCELLED,
                "Table data comparison cancelled.",
            ))
        }
        Err(error) => {
            emit_table_data_compare_progress(
                &app,
                TableDataCompareProgress {
                    compare_id,
                    phase: TableDataCompareProgressPhase::Completed,
                    endpoint: None,
                    processed_rows: 0,
                    source_row_count: None,
                    target_row_count: None,
                    status: TableDataCompareProgressStatus::Error,
                    terminal: true,
                    message: Some(bounded_table_data_transfer_message(&error)),
                },
            );
            Ok(Response::err("COMPARE_TABLE_DATA_FULL_ERROR", &error))
        }
    }
}

#[tauri::command]
pub async fn cancel_table_data_compare(
    manager: State<'_, ConnectionManager>,
    cancellation: State<'_, TableDataCompareCancellationState>,
    compare_id: String,
) -> Result<Response<String>, String> {
    validate_table_data_compare_id(&compare_id)?;
    let Some(handle) = cancellation.request_cancel(&compare_id).await else {
        return Ok(Response::err(
            "TABLE_DATA_COMPARE_NOT_FOUND",
            &format!("Table data comparison is not active: {compare_id}"),
        ));
    };

    let source_cancelled = manager
        .cancel_query(&handle.source_connection_id, &handle.source_query_id)
        .await
        .unwrap_or(false);
    let target_cancelled = manager
        .cancel_query(&handle.target_connection_id, &handle.target_query_id)
        .await
        .unwrap_or(false);
    let _ = handle.sender.send(true);
    Ok(Response::ok(
        if source_cancelled || target_cancelled {
            "Comparison cancellation requested on the database backend"
        } else {
            "Comparison cancellation requested"
        }
        .to_string(),
    ))
}
