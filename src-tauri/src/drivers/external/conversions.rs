use crate::core::{
    dialect::DatabaseKind,
    protocol::{ColumnDef, NativeQueryPage, QueryParameter, QueryResult},
    statement::StatementScanDialect,
};
use anyhow::{anyhow, Result};
use oxide_driver_protocol::{DriverQueryPage, DriverQueryParameter, DriverQueryResult};
use std::str::FromStr;

pub(super) fn redact_driver_error(error: &str, connection_url: &str) -> String {
    let mut redacted = error.replace(connection_url, "<redacted connection URL>");
    if let Some((prefix, _)) = connection_url.split_once('@') {
        redacted = redacted.replace(prefix, "<redacted credentials>");
    }
    redacted
}

pub(super) fn sidecar_parameters(parameters: &[QueryParameter]) -> Vec<DriverQueryParameter> {
    parameters
        .iter()
        .map(|parameter| DriverQueryParameter {
            value: parameter.value.clone(),
            data_type: parameter.data_type.clone(),
        })
        .collect()
}

pub(super) fn query_result_from_sidecar(result: DriverQueryResult) -> Result<QueryResult> {
    let row_limit = result
        .row_limit
        .map(|value| usize::try_from(value).map_err(|_| anyhow!("Driver row limit is too large")))
        .transpose()?;
    Ok(QueryResult {
        columns: result
            .columns
            .into_iter()
            .map(|column| ColumnDef {
                name: column.name,
                data_type: column.data_type,
            })
            .collect(),
        rows: result.rows,
        truncated: result.truncated,
        row_limit,
        rows_affected: result.rows_affected,
        statement_type: result.statement_type,
        message: result.message,
        response_meta: None,
    })
}

pub(super) fn native_query_page_from_sidecar(page: DriverQueryPage) -> Result<NativeQueryPage> {
    let next_cursor = match (page.session_id, page.has_more) {
        (Some(session_id), true) if !session_id.trim().is_empty() => Some(session_id),
        (None, false) => None,
        _ => {
            return Err(anyhow!(
                "External driver returned an invalid native query cursor state"
            ))
        }
    };
    Ok(NativeQueryPage {
        result: query_result_from_sidecar(page.result)?,
        next_cursor,
    })
}

/// External packages can introduce a SQL family that is not part of the
/// bundled `DatabaseKind` enum. The signed capability contract is therefore
/// the first source of truth for statement scanning. `sqlite` deliberately
/// uses the standard/PostgreSQL scanner: its quote/comment rules cover the
/// compatible SQL subset while preserving the package's own execution engine
/// as the authority for vendor-specific syntax.
pub(crate) fn external_statement_scan_dialect(
    driver_id: &str,
    lsp_language_id: Option<&str>,
) -> Option<StatementScanDialect> {
    // SQL Server packages intentionally keep the neutral `sql` editor
    // language until they earn a vendor parser. Their statement boundaries
    // are nevertheless T-SQL boundaries: bracket identifiers can contain a
    // semicolon and must never be split by the PostgreSQL-compatible scanner.
    if matches!(
        driver_id.trim().to_ascii_lowercase().as_str(),
        "sqlserver" | "mssql" | "sql-server" | "azure-sql"
    ) {
        return Some(StatementScanDialect::SqlServer);
    }
    match lsp_language_id
        .map(str::trim)
        .filter(|language| !language.is_empty())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        // ClickHouse accepts backtick-delimited identifiers and uses the same
        // non-nested comment/quote boundaries needed by the MySQL scanner.
        // This only selects the bounded statement-at-cursor scanner; the
        // ClickHouse sidecar remains authoritative for query syntax and
        // execution, so it does not claim MySQL SQL validation.
        Some("mysql") | Some("clickhouse") => Some(StatementScanDialect::Mysql),
        Some("postgres") | Some("sqlite") | Some("duckdb") | Some("sql") => {
            Some(StatementScanDialect::Postgres)
        }
        Some(_) => None,
        None => DatabaseKind::from_str(driver_id)
            .ok()
            .map(|kind| match kind {
                DatabaseKind::Postgres => StatementScanDialect::Postgres,
                DatabaseKind::Mysql => StatementScanDialect::Mysql,
            }),
    }
}

/// Creation is deliberately a two-party contract: the signed package says it
/// is part of the public feature surface, while the running sidecar says this
/// particular installed version has implemented it. Either missing signal
/// keeps the operation outside the process boundary.
pub(super) fn allows_database_creation(
    signed_capabilities: Option<&crate::core::dialect::DatabaseCapabilities>,
    runtime_capabilities: &oxide_driver_protocol::DriverRuntimeCapabilities,
) -> bool {
    signed_capabilities.is_some_and(|capabilities| capabilities.supports_create_database)
        && runtime_capabilities.database_creation
}

/// Database-scoped execution is also a two-party contract. A generic runtime
/// may know how to switch JDBC catalogs, but that must not expose a catalog
/// layer for products whose reviewed package models only schemas.
pub(super) fn allows_database_scoped_queries(
    signed_capabilities: Option<&crate::core::dialect::DatabaseCapabilities>,
    runtime_capabilities: &oxide_driver_protocol::DriverRuntimeCapabilities,
) -> bool {
    signed_capabilities.is_some_and(|capabilities| capabilities.supports_database_catalogs)
        && runtime_capabilities.database_scoped_queries
}
