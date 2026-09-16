//! Row commands for table operations.

use super::access::{
    ensure_target_relation_operation_allowed, execute_target_parameterized_batch,
    get_target_columns, query_target, query_target_parameterized,
};
use super::compare_rows::preview_metadata_required;
use super::limits::{DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE};
use super::policy::{
    default_time_series_preview_filter, schema_option, table_data_dialect_for_connection,
    validated_raw_filter_sql, RelationOperation,
};
use super::row_sql::{
    build_delete_mutation, build_insert_mutation, build_structured_filter_where,
    build_table_order_by, build_update_mutation, column_lookup, summarize_mutation_affected,
};
use super::row_types::{
    should_calculate_table_total, TableFilter, TableMutationResult, TablePageResult,
    TableRowDelete, TableRowUpdate, TableSort,
};
use super::values::value_to_u64;
use crate::core::manager::ConnectionManager;
use crate::core::protocol::ParameterizedStatement;
use crate::core::protocol::QueryResult;
use crate::core::protocol::Response;
use serde_json::Value;
use std::collections::BTreeMap;
use tauri::State;

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn preview_table_page(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    database: Option<String>,
    page: Option<u32>,
    page_size: Option<u32>,
    filter_sql: Option<String>,
    filters: Option<Vec<TableFilter>>,
    sort: Option<TableSort>,
    include_total: Option<bool>,
) -> Result<Response<TablePageResult>, String> {
    let error_context = serde_json::json!({
        "connectionId": connection_id,
        "driver": driver,
        "database": database,
        "schema": schema,
        "table": table,
        "page": page,
        "pageSize": page_size,
        "includeTotal": include_total,
    });
    let result: Result<TablePageResult, String> = async {
        let kind =
            table_data_dialect_for_connection(&manager, &connection_id, &driver, false).await?;
        let database = database.as_deref();
        let page = page.unwrap_or(0);
        let page_size = page_size
            .unwrap_or(DEFAULT_PAGE_SIZE)
            .clamp(1, MAX_PAGE_SIZE);
        let offset = page as u64 * page_size as u64;
        let include_total = should_calculate_table_total(include_total);
        let structured_filters = filters
            .as_deref()
            .map(|filters| {
                filters
                    .iter()
                    .filter(|filter| !filter.column.trim().is_empty())
                    .cloned()
                    .collect::<Vec<_>>()
            })
            .filter(|filters| !filters.is_empty());
        let requested_sort = sort.as_ref().filter(|sort| !sort.column.trim().is_empty());
        let metadata_required =
            preview_metadata_required(structured_filters.as_deref(), requested_sort);
        let columns = if metadata_required {
            Some(
                get_target_columns(&manager, &connection_id, database, &schema, &table)
                    .await
                    .map(column_lookup)
                    .map_err(|error| error.to_string())?,
            )
        } else {
            None
        };
        let order_clause = if let Some(columns) = columns.as_ref() {
            build_table_order_by(kind, columns, requested_sort)?
        } else {
            None
        };
        let order = order_clause.as_deref();

        let (total_rows, mut results) = if let Some(filters) = structured_filters {
            let columns = columns
                .as_ref()
                .ok_or_else(|| "Missing column metadata".to_string())?;
            let (where_clause, params) = build_structured_filter_where(kind, columns, &filters)?;
            let filter = if where_clause.is_empty() {
                None
            } else {
                Some(where_clause.as_str())
            };

            let total_rows = if include_total {
                let count_sql = kind.count_table_query(schema_option(&schema), &table, filter);
                query_target_parameterized(&manager, &connection_id, database, &count_sql, &params)
                    .await
                    .ok()
                    .and_then(|results| results.first().cloned())
                    .and_then(|result| result.rows.first().cloned())
                    .and_then(|row| row.first().cloned())
                    .and_then(|value| value_to_u64(&value))
            } else {
                None
            };

            let page_sql = kind.paged_table_query_with_order(
                schema_option(&schema),
                &table,
                filter,
                order,
                page_size,
                offset,
            );
            let results =
                query_target_parameterized(&manager, &connection_id, database, &page_sql, &params)
                    .await
                    .map_err(|e| e.to_string())?;

            (total_rows, results)
        } else {
            let validated_filter = validated_raw_filter_sql(kind, filter_sql.as_deref())?;
            // The default is only for the unfiltered grid quick-open. A
            // caller-provided filter always wins, and the helper is scoped to
            // InfluxDB 3 so other SQL-compatible drivers retain their exact
            // historical query shape.
            let default_time_filter = validated_filter
                .is_none()
                .then(|| default_time_series_preview_filter(&driver))
                .flatten();
            let filter = validated_filter.as_deref().or(default_time_filter);

            let total_rows = if include_total {
                let count_sql = kind.count_table_query(schema_option(&schema), &table, filter);
                query_target(&manager, &connection_id, database, &count_sql)
                    .await
                    .ok()
                    .and_then(|results| results.first().cloned())
                    .and_then(|result| result.rows.first().cloned())
                    .and_then(|row| row.first().cloned())
                    .and_then(|value| value_to_u64(&value))
            } else {
                None
            };

            let page_sql = kind.paged_table_query_with_order(
                schema_option(&schema),
                &table,
                filter,
                order,
                page_size,
                offset,
            );
            let results = query_target(&manager, &connection_id, database, &page_sql)
                .await
                .map_err(|e| e.to_string())?;

            (total_rows, results)
        };
        let result = results
            .drain(..)
            .next()
            .unwrap_or_else(|| QueryResult::rows(Vec::new(), Vec::new()));

        Ok(TablePageResult {
            result,
            page,
            page_size,
            total_rows,
        })
    }
    .await;

    match result {
        Ok(page) => Ok(Response::ok(page)),
        Err(error) => Ok(Response::err_with_details(
            "PREVIEW_TABLE_PAGE_ERROR",
            &error,
            true,
            Some(error_context),
        )),
    }
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn mutate_table_rows(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    database: Option<String>,
    inserts: Vec<BTreeMap<String, Value>>,
    updates: Vec<TableRowUpdate>,
    deletes: Vec<TableRowDelete>,
) -> Result<Response<TableMutationResult>, String> {
    let result: Result<TableMutationResult, String> = async {
        let kind =
            table_data_dialect_for_connection(&manager, &connection_id, &driver, true).await?;
        let database = database.as_deref();
        ensure_target_relation_operation_allowed(
            &manager,
            &connection_id,
            database,
            &schema,
            &table,
            RelationOperation::DataMutation,
        )
        .await?;
        let columns = get_target_columns(&manager, &connection_id, database, &schema, &table)
            .await
            .map(column_lookup)
            .map_err(|e| e.to_string())?;

        if columns.is_empty() {
            return Err("Table has no column metadata".to_string());
        }

        let insert_count = inserts.len();
        let update_count = updates.len();
        let delete_count = deletes.len();
        let mut statements = Vec::with_capacity(insert_count + update_count + delete_count);

        for insert in &inserts {
            let (sql, params) = build_insert_mutation(kind, &schema, &table, &columns, insert)?;
            statements.push(ParameterizedStatement { sql, params });
        }

        for update in &updates {
            let (sql, params) = build_update_mutation(kind, &schema, &table, &columns, update)?;
            statements.push(ParameterizedStatement { sql, params });
        }

        for delete in &deletes {
            let (sql, params) = build_delete_mutation(kind, &schema, &table, &columns, delete)?;
            statements.push(ParameterizedStatement { sql, params });
        }

        let affected =
            execute_target_parameterized_batch(&manager, &connection_id, database, &statements)
                .await
                .map_err(|e| e.to_string())?;

        Ok(summarize_mutation_affected(
            &affected,
            insert_count,
            update_count,
            delete_count,
        ))
    }
    .await;

    match result {
        Ok(mutation) => Ok(Response::ok(mutation)),
        Err(error) => Ok(Response::err("MUTATE_TABLE_ROWS_ERROR", &error)),
    }
}
