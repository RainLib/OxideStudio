use crate::core::protocol::{
    ColumnDef, QueryParameter, QueryResult, DEFAULT_QUERY_RESULT_ROW_LIMIT,
};
use crate::core::statement::execution_statement_kind;
use anyhow::{anyhow, bail, Result};
use oxide_sqlite_worker::{WorkerErrorCode, WorkerParameter, WorkerResponseBody};
use sqlx::sqlite::{SqliteConnectOptions, SqliteConnection};
use sqlx::{ConnectOptions, Connection};
use std::path::Path;
use std::str::FromStr;

pub(super) fn worker_parameters(parameters: &[QueryParameter]) -> Vec<WorkerParameter> {
    parameters
        .iter()
        .map(|parameter| WorkerParameter {
            value: parameter.value.clone(),
            data_type: parameter.data_type.clone(),
        })
        .collect()
}

pub(super) fn worker_body_result(body: WorkerResponseBody) -> Result<WorkerResponseBody> {
    match body {
        WorkerResponseBody::Error { code, message } => {
            Err(anyhow!(worker_error_message(code, &message)))
        }
        body => Ok(body),
    }
}

pub(super) fn worker_error_message(code: WorkerErrorCode, message: &str) -> String {
    format!("sqlite_worker_{code:?}: {message}")
}

pub(super) fn expect_ok(body: WorkerResponseBody) -> Result<()> {
    match body {
        WorkerResponseBody::Ok => Ok(()),
        _ => bail!("SQLite worker returned an unexpected response"),
    }
}

pub(super) fn expect_file(body: WorkerResponseBody) -> Result<(u64, String)> {
    match body {
        WorkerResponseBody::File {
            byte_len,
            integrity_check,
        } if byte_len > 0 && integrity_check.eq_ignore_ascii_case("ok") => {
            Ok((byte_len, integrity_check))
        }
        _ => bail!("SQLite worker returned an invalid file receipt"),
    }
}

pub(super) fn worker_query_result(sql: &str, body: WorkerResponseBody) -> Result<QueryResult> {
    let WorkerResponseBody::Result {
        columns,
        mut rows,
        rows_affected,
        truncated,
    } = body
    else {
        bail!("SQLite worker returned an unexpected query response");
    };
    if columns.is_empty() {
        return Ok(QueryResult::execution(
            execution_statement_kind(sql).as_str(),
            rows_affected,
        ));
    }
    let sentinel_truncated = rows.len() > DEFAULT_QUERY_RESULT_ROW_LIMIT;
    if sentinel_truncated {
        rows.truncate(DEFAULT_QUERY_RESULT_ROW_LIMIT);
    }
    Ok(QueryResult {
        columns: columns
            .into_iter()
            .map(|column| ColumnDef {
                name: column.name,
                data_type: column.data_type,
            })
            .collect(),
        rows,
        truncated: truncated || sentinel_truncated,
        row_limit: (truncated || sentinel_truncated).then_some(DEFAULT_QUERY_RESULT_ROW_LIMIT),
        rows_affected: None,
        statement_type: None,
        message: None,
        response_meta: None,
    })
}

pub(super) async fn verify_local_sqlite_file(path: &Path) -> Result<String> {
    if !path.is_file() {
        bail!("SQLite file is missing");
    }
    let options = SqliteConnectOptions::from_str(&format!("sqlite://{}", path.to_string_lossy()))?
        .read_only(true)
        .disable_statement_logging();
    let mut connection = SqliteConnection::connect_with(&options).await?;
    let integrity: String = sqlx::query_scalar("PRAGMA main.integrity_check")
        .fetch_one(&mut connection)
        .await?;
    connection.close().await?;
    if !integrity.eq_ignore_ascii_case("ok") {
        bail!("SQLite file failed its integrity check");
    }
    Ok(integrity)
}
