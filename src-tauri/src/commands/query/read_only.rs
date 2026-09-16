/// 查询执行相关 commands
use crate::core::{
    dialect::DatabaseKind,
    explain::{build_explain_statement, parse_explain_results},
    manager::ConnectionManager,
    protocol::{ExplainPlan, QueryResult, Response},
    statement::{validate_read_only_sql, StatementScanDialect},
};
use std::time::Instant;
use tauri::State;

use super::models::{extracted_database_error, query_error_context};
use super::state::{ExplainQueryRequest, QueryCancellationState};

/// Execute one assistant-approved SQL read behind a backend-enforced read-only
/// transaction. This command intentionally does not accept transaction ids.
#[tauri::command]
pub async fn execute_read_only_query(
    manager: State<'_, ConnectionManager>,
    cancellation: State<'_, QueryCancellationState>,
    connection_id: String,
    sql: String,
    schema: Option<String>,
    query_id: Option<String>,
    database: Option<String>,
) -> Result<Response<Vec<QueryResult>>, String> {
    let query_context = serde_json::json!({
        "connectionId": connection_id,
        "database": database,
        "schema": schema,
        "queryId": query_id,
    });
    let dialect = match manager.statement_scan_dialect(&connection_id).await {
        Ok(Some(dialect)) => dialect,
        Ok(None) => {
            return Ok(Response::err_with_details(
                "READ_ONLY_QUERY_UNSUPPORTED",
                "Read-only SQL execution is unsupported for this driver",
                false,
                Some(query_context),
            ));
        }
        Err(error) => {
            return Ok(Response::err_with_details(
                "QUERY_TARGET_RESOLUTION_FAILED",
                &error.to_string(),
                true,
                Some(query_context),
            ));
        }
    };
    let kind = match dialect {
        StatementScanDialect::Postgres => DatabaseKind::Postgres,
        StatementScanDialect::Mysql => DatabaseKind::Mysql,
        // SQL Server has no equivalent Host-generated read-only transaction
        // wrapper. A package may still expose an agent read endpoint when its
        // own runtime declares enforcement, but this generic command must not
        // pretend `BEGIN READ ONLY` is valid T-SQL.
        StatementScanDialect::SqlServer => {
            return Ok(Response::err_with_details(
                "READ_ONLY_QUERY_UNSUPPORTED",
                "SQL Server read-only execution requires a driver-enforced read-only endpoint",
                false,
                Some(query_context),
            ));
        }
    };
    if let Err(reason) = validate_read_only_sql(&sql, dialect) {
        return Ok(Response::err_with_details(
            "READ_ONLY_QUERY_REJECTED",
            reason,
            false,
            Some(query_context),
        ));
    }

    let script = read_only_transaction_script(kind, &sql);
    let mut response = execute_query_with_cancellation(
        &manager,
        &cancellation,
        connection_id,
        script,
        schema,
        None,
        query_id,
        database,
    )
    .await?;
    if let Some(results) = response.data.take() {
        response.data = Some(strip_read_only_transaction_results(results));
    }
    Ok(response)
}

/// Build and execute a driver-specific Explain Plan behind the same
/// backend-enforced read-only transaction and cancellation path as AI reads.
/// The source query is validated before the EXPLAIN prefix is generated, so a
/// frontend cannot smuggle transaction control or mutations into the plan.
#[tauri::command]
pub async fn explain_query(
    manager: State<'_, ConnectionManager>,
    cancellation: State<'_, QueryCancellationState>,
    request: ExplainQueryRequest,
) -> Result<Response<ExplainPlan>, String> {
    let query_id = request.query_id.trim().to_string();
    let database = request.database.filter(|value| !value.trim().is_empty());
    let schema = request.schema.filter(|value| !value.trim().is_empty());
    let context = serde_json::json!({
        "connectionId": request.connection_id,
        "database": database,
        "schema": schema,
        "queryId": query_id,
        "mode": request.mode,
    });
    if query_id.is_empty() {
        return Ok(Response::err_with_details(
            "EXPLAIN_QUERY_ID_REQUIRED",
            "Explain Plan requires a query id for cancellation and stable navigation",
            false,
            Some(context),
        ));
    }

    let dialect = match manager.statement_scan_dialect(&request.connection_id).await {
        Ok(Some(dialect)) => dialect,
        Ok(None) => {
            return Ok(Response::err_with_details(
                "EXPLAIN_UNSUPPORTED",
                "Explain Plan is unsupported for this driver",
                false,
                Some(context),
            ));
        }
        Err(error) => {
            return Ok(Response::err_with_details(
                "EXPLAIN_TARGET_RESOLUTION_FAILED",
                &error.to_string(),
                true,
                Some(context),
            ));
        }
    };
    let kind = match dialect {
        StatementScanDialect::Postgres => DatabaseKind::Postgres,
        StatementScanDialect::Mysql => DatabaseKind::Mysql,
        StatementScanDialect::SqlServer => {
            return Ok(Response::err_with_details(
                "EXPLAIN_UNSUPPORTED",
                "SQL Server Explain Plan requires a driver-specific implementation",
                false,
                Some(context),
            ));
        }
    };
    let (explain_sql, format) = match build_explain_statement(&request.sql, kind, request.mode) {
        Ok(statement) => statement,
        Err(error) => {
            return Ok(Response::err_with_details(
                "EXPLAIN_QUERY_REJECTED",
                &error.to_string(),
                false,
                Some(context),
            ));
        }
    };

    let started_at = Instant::now();
    let script = read_only_transaction_script(kind, &explain_sql);
    let mut response = execute_query_with_cancellation(
        &manager,
        &cancellation,
        request.connection_id,
        script,
        schema,
        None,
        Some(query_id.clone()),
        database,
    )
    .await?;
    if let Some(error) = response.error.take() {
        let code = if error.code == "QUERY_CANCELLED" {
            "QUERY_CANCELLED"
        } else {
            "EXPLAIN_EXECUTION_FAILED"
        };
        return Ok(Response::err_with_details(
            code,
            &error.message,
            error.retryable,
            Some(context),
        ));
    }

    let results = strip_read_only_transaction_results(response.data.take().unwrap_or_default());
    match parse_explain_results(
        query_id,
        kind,
        request.mode,
        format,
        started_at.elapsed().as_secs_f64() * 1_000.0,
        &results,
    ) {
        Ok(plan) => Ok(Response::ok(plan)),
        Err(error) => Ok(Response::err_with_details(
            "EXPLAIN_PLAN_PARSE_FAILED",
            &error.to_string(),
            false,
            Some(context),
        )),
    }
}

pub(super) fn read_only_transaction_script(kind: DatabaseKind, sql: &str) -> String {
    let begin = match kind {
        DatabaseKind::Postgres => "BEGIN READ ONLY;",
        DatabaseKind::Mysql => "START TRANSACTION READ ONLY;",
    };
    format!("{begin}\n{}\n;\nROLLBACK;", sql.trim())
}

pub(super) fn strip_read_only_transaction_results(
    mut results: Vec<QueryResult>,
) -> Vec<QueryResult> {
    let first = results
        .first()
        .and_then(|result| result.statement_type.as_deref());
    let last = results
        .last()
        .and_then(|result| result.statement_type.as_deref());
    if first.is_some_and(|kind| {
        kind.eq_ignore_ascii_case("BEGIN") || kind.eq_ignore_ascii_case("START")
    }) && last.is_some_and(|kind| kind.eq_ignore_ascii_case("ROLLBACK"))
    {
        results.remove(0);
        results.pop();
    }
    results
}

// Keep the execution inputs aligned with `execute_query` so the read-only
// wrapper can reuse the exact same cancellation and database routing path.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn execute_query_with_cancellation(
    manager: &ConnectionManager,
    cancellation: &QueryCancellationState,
    connection_id: String,
    sql: String,
    schema: Option<String>,
    transaction_id: Option<String>,
    query_id: Option<String>,
    database: Option<String>,
) -> Result<Response<Vec<QueryResult>>, String> {
    let database = database.filter(|value| !value.trim().is_empty());
    let query_context = serde_json::json!({
        "connectionId": connection_id,
        "database": database,
        "schema": schema,
        "queryId": query_id,
    });
    if database.is_some()
        && transaction_id
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
    {
        return Ok(Response::err_with_details(
            "CROSS_DATABASE_TRANSACTION_UNSUPPORTED",
            "Manual transactions are unavailable for a PostgreSQL database selected through the editor.",
            false,
            Some(query_context),
        ));
    }
    let query_id = query_id.filter(|value| !value.trim().is_empty());
    let mut cancel_rx = if let Some(query_id) = query_id.as_ref() {
        match cancellation.register(query_id, &connection_id).await {
            Ok(cancel_rx) => Some(cancel_rx),
            Err(error) => {
                return Ok(Response::err_with_details(
                    "DUPLICATE_QUERY_ID",
                    &error,
                    false,
                    Some(query_context),
                ));
            }
        }
    } else {
        None
    };

    let execute = || async {
        if let Some(database) = database.as_deref() {
            manager
                .query_database_with_context(
                    &connection_id,
                    database,
                    &sql,
                    schema.as_deref(),
                    query_id.as_deref(),
                )
                .await
        } else {
            manager
                .query(
                    &connection_id,
                    &sql,
                    schema.clone(),
                    transaction_id.clone(),
                    query_id.clone(),
                )
                .await
        }
    };

    let result = if let Some(cancel_rx) = cancel_rx.as_mut() {
        tokio::select! {
            result = execute() => {
                result.map(Response::ok)
            }
            _ = cancel_rx.changed() => {
                Ok(Response::err_with_details(
                    "QUERY_CANCELLED",
                    "Query cancelled",
                    false,
                    Some(query_context.clone()),
                ))
            }
        }
    } else {
        execute().await.map(Response::ok)
    };

    if let Some(query_id) = query_id {
        cancellation.take(&query_id).await;
    }

    match result {
        Ok(response) => Ok(response),
        Err(error) => {
            let database_error = extracted_database_error(&error);
            let message = database_error
                .as_ref()
                .map(|error| error.message.clone())
                .unwrap_or_else(|| error.to_string());
            if message.starts_with("Connection not found:") {
                Ok(Response::err_with_details(
                    "CONNECTION_SESSION_NOT_FOUND",
                    "The saved data source is available, but its live connection session is not active.",
                    true,
                    Some(query_context),
                ))
            } else {
                Ok(Response::err_with_details(
                    "QUERY_EXECUTION_FAILED",
                    &message,
                    false,
                    Some(query_error_context(
                        query_context,
                        database_error.as_ref().map(|error| &error.diagnostic),
                    )),
                ))
            }
        }
    }
}
