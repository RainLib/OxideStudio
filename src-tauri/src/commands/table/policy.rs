//! Policy for table operations.

use super::export_analytical::AnalyticalTypePolicy;
use super::export_sql::sql_export_dialect;
use super::export_types::{TableExportDialect, TableExportFormat};
use super::transfer_types::TableDataTransferEndpoint;
use crate::core::dialect::canonical_driver_name;
use crate::core::dialect::database_spec_for_driver;
use crate::core::dialect::DatabaseKind;
use crate::core::manager::ConnectionManager;
use crate::core::statement::validate_sql_filter_expression;
use crate::core::statement::StatementScanDialect;
use std::str::FromStr;

pub(super) fn schema_option(schema: &str) -> Option<&str> {
    let schema = schema.trim();
    if schema.is_empty() {
        None
    } else {
        Some(schema)
    }
}

/// Keep the initial InfluxDB 3 data-grid open bounded. A time-series table
/// without a predicate can otherwise scan every shard merely because it was
/// opened from the sidebar. This is deliberately limited to the data-grid's
/// no-filter quick-open path: explicit user filters, exports, and editor SQL
/// retain their requested semantics.
pub(super) fn default_time_series_preview_filter(driver: &str) -> Option<&'static str> {
    matches!(
        driver.trim().to_ascii_lowercase().as_str(),
        "influxdb3" | "influxdb-3"
    )
    .then_some("time > now() - INTERVAL '5 minutes'")
}

/// SQLite and DuckDB accept the ANSI/PostgreSQL-style quoted identifiers,
/// `LIMIT/OFFSET`, and numbered bind markers used by the bounded data-grid
/// path. Keep this adapter deliberately narrow: it enables data preview and
/// row mutations. SQLite relation DDL is routed through its native builders
/// below rather than through this PostgreSQL-compatible data-grid dialect.
pub(super) fn table_data_dialect(driver: &str) -> Result<DatabaseKind, String> {
    if matches!(
        driver.trim().to_ascii_lowercase().as_str(),
        // InfluxDB 3 uses DataFusion SQL: its identifier quoting and bounded
        // LIMIT/OFFSET data-grid grammar match the PostgreSQL-compatible
        // builder. InfluxDB 1/2 remains intentionally excluded because it
        // uses InfluxQL/Flux rather than this SQL contract.
        "sqlite" | "sqlite3" | "duckdb" | "influxdb3" | "influxdb-3"
    ) {
        return Ok(DatabaseKind::Postgres);
    }
    DatabaseKind::from_str(driver).map_err(|error| error.to_string())
}

pub(super) fn reviewed_table_data_dialect(
    capabilities: &crate::core::dialect::DatabaseCapabilities,
    requires_mutation: bool,
) -> Result<DatabaseKind, String> {
    if !capabilities.supports_table_browsing {
        return Err(format!(
            "{} does not provide a reviewed table browsing contract",
            capabilities.display_name
        ));
    }
    if requires_mutation && !capabilities.supports_table_row_mutation {
        return Err(format!(
            "{} does not provide a reviewed table row-mutation contract",
            capabilities.display_name
        ));
    }

    match capabilities
        .lsp_language_id
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "postgres" | "sqlite" | "duckdb" => Ok(DatabaseKind::Postgres),
        "mysql" => Ok(DatabaseKind::Mysql),
        _ => Err(format!(
            "{} does not declare a reviewed table SQL dialect",
            capabilities.display_name
        )),
    }
}

pub(super) async fn table_data_dialect_for_connection(
    manager: &ConnectionManager,
    connection_id: &str,
    driver: &str,
    requires_mutation: bool,
) -> Result<DatabaseKind, String> {
    let capabilities = manager
        .package_capabilities(connection_id)
        .await
        .map_err(|error| error.to_string())?;
    match capabilities {
        Some(capabilities) => reviewed_table_data_dialect(&capabilities, requires_mutation),
        None => table_data_dialect(driver),
    }
}

pub(super) fn ensure_table_export_format(
    capabilities: &crate::core::dialect::DatabaseCapabilities,
    format: TableExportFormat,
) -> Result<(), String> {
    if capabilities
        .table_export_formats
        .iter()
        .any(|candidate| candidate == format.as_str())
    {
        return Ok(());
    }
    Err(format!(
        "{} does not declare {} table export support",
        capabilities.display_name,
        format.as_str().to_ascii_uppercase()
    ))
}

pub(super) async fn table_export_dialect_for_connection(
    manager: &ConnectionManager,
    connection_id: &str,
    driver: &str,
    format: TableExportFormat,
) -> Result<TableExportDialect, String> {
    let package_capabilities = manager
        .package_capabilities(connection_id)
        .await
        .map_err(|error| error.to_string())?;
    if let Some(capabilities) = package_capabilities {
        ensure_table_export_format(&capabilities, format)?;
        let kind = reviewed_table_data_dialect(&capabilities, false)?;
        let analytical_type_policy = if capabilities.driver.trim().eq_ignore_ascii_case("duckdb") {
            AnalyticalTypePolicy::DuckDb
        } else {
            AnalyticalTypePolicy::ExternalText
        };
        return Ok(TableExportDialect {
            kind,
            analytical_type_policy,
            sql_dialect: sql_export_dialect(&capabilities.driver, kind),
        });
    }

    let capabilities = database_spec_for_driver(driver)
        .map(|spec| spec.capabilities())
        .ok_or_else(|| format!("Unsupported database driver: {}", driver.trim()))?;
    ensure_table_export_format(&capabilities, format)?;
    let analytical_type_policy = match canonical_driver_name(driver) {
        Some("sqlite") => AnalyticalTypePolicy::SqliteDynamic,
        Some("duckdb") => AnalyticalTypePolicy::DuckDb,
        _ => AnalyticalTypePolicy::Native,
    };
    let kind = table_data_dialect(driver)?;
    Ok(TableExportDialect {
        kind,
        analytical_type_policy,
        sql_dialect: sql_export_dialect(driver, kind),
    })
}

/// Resolve the dialect used by the bounded table-to-table transfer path.
///
/// A signed external package is not automatically safe for this operation:
/// generic SQL has no reliable pagination or parameter convention. Packages
/// can opt in only through the reviewed transfer capability and one of the
/// two host implementations whose generated SQL is exercised here.
pub(super) async fn table_data_transfer_dialect(
    manager: &ConnectionManager,
    endpoint: &TableDataTransferEndpoint,
) -> Result<DatabaseKind, String> {
    // Check the live package contract before the built-in driver-name route.
    // A package may intentionally reuse `postgres` or `mysql` while not
    // implementing the reviewed paging/type-mapping/batch-write transfer
    // contract. Its signed explicit false must never be widened by an alias.
    if let Some(capabilities) = manager
        .package_capabilities(&endpoint.connection_id)
        .await
        .map_err(|error| error.to_string())?
    {
        if !capabilities.supports_table_data_transfer {
            return Err(format!(
                "{} does not provide a reviewed bounded table-data transfer path",
                capabilities.display_name
            ));
        }

        return match capabilities.lsp_language_id.trim() {
            "postgres" | "sqlite" | "duckdb" => Ok(DatabaseKind::Postgres),
            "mysql" => Ok(DatabaseKind::Mysql),
            _ => Err(format!(
                "{} does not declare a reviewed transfer dialect",
                capabilities.display_name
            )),
        };
    }

    table_data_dialect(&endpoint.driver).map_err(|_| {
        format!(
            "{} does not provide a reviewed bounded table-data transfer path",
            endpoint.driver.trim()
        )
    })
}

pub(super) async fn resolve_transfer_target_column_quoting(
    manager: &ConnectionManager,
    endpoint: &TableDataTransferEndpoint,
    requested: bool,
) -> Result<bool, String> {
    if requested {
        return Ok(true);
    }

    // This is a product-specific opt-out, so keep the selected product id
    // instead of canonicalizing it to the bundled PostgreSQL transport.
    let driver = endpoint.driver.trim().to_ascii_lowercase();
    if !matches!(driver.as_str(), "gaussdb" | "opengauss") {
        return Err(
            "Unquoted transfer target columns are available only for GaussDB/openGauss targets."
                .to_string(),
        );
    }
    let connected_driver = manager
        .connection_driver_id(&endpoint.connection_id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "Unquoted transfer target columns require a live, identified driver package."
                .to_string()
        })?;
    if connected_driver != driver {
        return Err(
            "The connected driver changed before the unquoted transfer plan was reviewed."
                .to_string(),
        );
    }
    let capabilities = manager
        .package_capabilities(&endpoint.connection_id)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            "Unquoted transfer target columns require a signed external driver package.".to_string()
        })?;
    if !capabilities.supports_table_data_transfer
        || capabilities.lsp_language_id.trim() != "postgres"
    {
        return Err(format!(
            "{} does not provide the reviewed PostgreSQL-compatible transfer contract required for unquoted target columns.",
            capabilities.display_name
        ));
    }

    Ok(false)
}

/// Table DDL currently has host-owned, dialect-specific builders only. A
/// sidecar may share a built-in driver id (for example `postgres`) while using
/// different DDL grammar, so never send those generated statements through an
/// external runtime. Packages keep metadata and query support, and can expose
/// semantic DDL later through an explicit protocol capability.
pub(super) fn ensure_host_table_ddl_capability(
    capabilities: Option<&crate::core::dialect::DatabaseCapabilities>,
    operation: &str,
) -> Result<(), String> {
    if let Some(capabilities) = capabilities {
        return Err(format!(
            "{} does not provide a verified semantic table {operation} operation",
            capabilities.display_name
        ));
    }
    Ok(())
}

pub(super) async fn ensure_host_table_ddl_allowed(
    manager: &ConnectionManager,
    connection_id: &str,
    operation: &str,
) -> Result<(), String> {
    let capabilities = manager
        .package_capabilities(connection_id)
        .await
        .map_err(|error| error.to_string())?;
    ensure_host_table_ddl_capability(capabilities.as_ref(), operation)
}

pub(super) fn validated_raw_filter_sql(
    kind: DatabaseKind,
    filter_sql: Option<&str>,
) -> Result<Option<String>, String> {
    let Some(filter_sql) = filter_sql.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };

    let dialect = match kind {
        DatabaseKind::Postgres => StatementScanDialect::Postgres,
        DatabaseKind::Mysql => StatementScanDialect::Mysql,
    };
    validate_sql_filter_expression(filter_sql, dialect)?;

    Ok(Some(filter_sql.to_string()))
}

pub(super) fn object_type_is_view(object_type: Option<&str>) -> bool {
    object_type
        .map(str::trim)
        .map(|value| value.to_ascii_uppercase())
        .is_some_and(|value| value.contains("VIEW"))
}

pub(super) fn object_type_is_materialized_view(object_type: Option<&str>) -> bool {
    object_type
        .map(str::trim)
        .map(|value| value.to_ascii_uppercase())
        .is_some_and(|value| value.contains("MATERIALIZED") && value.contains("VIEW"))
}

pub(super) fn object_type_is_foreign_table(object_type: Option<&str>) -> bool {
    object_type
        .map(str::trim)
        .map(|value| value.to_ascii_uppercase())
        .is_some_and(|value| value.contains("FOREIGN TABLE"))
}

pub(super) fn object_label_from_type(object_type: Option<&str>) -> &'static str {
    if object_type_is_materialized_view(object_type) {
        "Materialized view"
    } else if object_type_is_foreign_table(object_type) {
        "Foreign table"
    } else if object_type_is_view(object_type) {
        "View"
    } else {
        "Table"
    }
}

#[derive(Debug, Clone, Copy)]
pub(super) enum RelationOperation {
    DataMutation,
    Truncate,
    ColumnChange,
    IndexChange,
    ConstraintChange,
}

impl RelationOperation {
    pub(super) fn description(self) -> &'static str {
        match self {
            Self::DataMutation => "Changing rows",
            Self::Truncate => "Truncating",
            Self::ColumnChange => "Changing columns",
            Self::IndexChange => "Changing indexes",
            Self::ConstraintChange => "Changing constraints",
        }
    }
}

pub(super) fn relation_operation_allowed(
    operation: RelationOperation,
    object_type: Option<&str>,
) -> bool {
    match operation {
        RelationOperation::DataMutation
        | RelationOperation::Truncate
        | RelationOperation::ColumnChange
        | RelationOperation::ConstraintChange => {
            !object_type_is_view(object_type) && !object_type_is_foreign_table(object_type)
        }
        RelationOperation::IndexChange => {
            !object_type_is_foreign_table(object_type)
                && (!object_type_is_view(object_type)
                    || object_type_is_materialized_view(object_type))
        }
    }
}

pub(super) fn ensure_relation_operation_allowed(
    object_name: &str,
    object_type: Option<&str>,
    operation: RelationOperation,
) -> Result<(), String> {
    if relation_operation_allowed(operation, object_type) {
        return Ok(());
    }

    Err(format!(
        "{} is not available for {} {}",
        operation.description(),
        object_label_from_type(object_type).to_ascii_lowercase(),
        object_name.trim()
    ))
}
