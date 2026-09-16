use super::types::DriverPackageSchemaMigrationContract;
use crate::core::dialect::{DatabaseCapabilities, DECLARED_TABLE_EXPORT_FORMATS};
use oxide_driver_protocol::SchemaMigrationMode;

pub(super) fn validate_capability_contract(
    expected_driver_id: &str,
    capabilities: &DatabaseCapabilities,
) -> Result<(), String> {
    if !capabilities.driver.eq_ignore_ascii_case(expected_driver_id) {
        return Err("Driver capability contract must use the package driverId".to_string());
    }
    if capabilities.display_name.trim().is_empty()
        || capabilities.lsp_language_id.trim().is_empty()
        || capabilities.namespace_label.trim().is_empty()
        || capabilities.common_data_types.len() > 256
        || capabilities
            .common_data_types
            .iter()
            .any(|value| value.len() > 160)
    {
        return Err("Invalid driver capability contract".to_string());
    }
    // Identifier quoting is interpolated into generated completion and table
    // SQL. A signed package may select only the delimiter families supported
    // by the host; arbitrary text here must never become a code-generation
    // surface in the renderer.
    if !matches!(
        capabilities.identifier_quote.as_str(),
        "" | "\"" | "`" | "["
    ) {
        return Err("Driver identifier quote is not supported by this build".to_string());
    }
    let export_formats = capabilities
        .table_export_formats
        .iter()
        .map(String::as_str)
        .collect::<std::collections::HashSet<_>>();
    if capabilities.table_export_formats.len() > DECLARED_TABLE_EXPORT_FORMATS.len()
        || export_formats.len() != capabilities.table_export_formats.len()
        || capabilities.table_export_formats.iter().any(|format| {
            format.trim() != format || !DECLARED_TABLE_EXPORT_FORMATS.contains(&format.as_str())
        })
    {
        return Err(
            "Driver table export formats contain an unsupported or duplicate value".to_string(),
        );
    }
    if !capabilities.table_export_formats.is_empty()
        && (!capabilities.supports_table_browsing
            || !matches!(
                capabilities.data_model,
                crate::core::dialect::DatabaseDataModel::Relational
            )
            || !matches!(
                capabilities.lsp_language_id.trim(),
                "postgres" | "mysql" | "sqlite" | "duckdb"
            ))
    {
        return Err(
            "Table export formats require relational browsing and a reviewed postgres, mysql, sqlite, or duckdb paging dialect"
                .to_string(),
        );
    }
    if let Some(server_dialect) = capabilities.lsp_server_dialect.as_deref() {
        let server_dialect = server_dialect.trim();
        if server_dialect.is_empty() {
            return Err("Driver LSP server dialect must not be empty".to_string());
        }
        if !matches!(
            server_dialect,
            "postgres"
                | "mysql"
                | "sqlite"
                | "duckdb"
                | "hive"
                | "clickhouse"
                | "access"
                | "argo"
                | "cockroachdb"
                | "dameng"
                | "databend"
                | "doris"
                | "exasol"
                | "firebird"
                | "gaussdb"
                | "gbase"
                | "goldendb"
                | "greenplum"
                | "h2"
                | "highgo"
                | "informix"
                | "iris"
                | "kingbase"
                | "kwdb"
                | "manticoresearch"
                | "oceanbase-oracle"
                | "opengauss"
                | "oracle"
                | "questdb"
                | "redshift"
                | "sqlserver"
                | "starrocks"
                | "sundb"
                | "tidb"
                | "timescaledb"
                | "turso"
                | "vastbase"
                | "vertica"
                | "cloudflare-d1"
                | "xugu"
                | "yashandb"
                | "yugabytedb"
        ) {
            return Err("Driver LSP server dialect is not supported by this build".to_string());
        }
        let document_language = capabilities.lsp_language_id.trim();
        if document_language != "sql" && document_language != server_dialect {
            return Err(
                "Driver LSP server dialect must match its document language or use generic sql"
                    .to_string(),
            );
        }
    }
    if capabilities.supports_table_row_mutation && !capabilities.supports_transactions {
        return Err(
            "Table row mutation requires the driver capability contract to declare transactions"
                .to_string(),
        );
    }
    if !matches!(
        capabilities.data_model,
        crate::core::dialect::DatabaseDataModel::Relational
    ) && (capabilities.supports_table_browsing
        || capabilities.supports_table_row_mutation
        || capabilities.supports_table_data_transfer
        || capabilities.supports_table_ddl
        || capabilities.supports_column_alteration
        || capabilities.supports_index_rename
        || capabilities.supports_constraint_alteration)
    {
        return Err(
            "Only relational driver packages may declare the relational Table Editor contract"
                .to_string(),
        );
    }
    if capabilities.supports_table_data_transfer
        && (!capabilities.supports_table_browsing || !capabilities.supports_transactions)
    {
        return Err("Table data transfer requires table browsing and transactions".to_string());
    }
    if capabilities.supports_table_data_transfer
        && !matches!(
            capabilities.lsp_language_id.trim(),
            "postgres" | "mysql" | "sqlite" | "duckdb"
        )
    {
        return Err(
            "Table data transfer requires a reviewed postgres, mysql, sqlite, or duckdb dialect profile"
                .to_string(),
        );
    }
    Ok(())
}

pub(super) fn validate_schema_migration_contract(
    capabilities: Option<&DatabaseCapabilities>,
    contract: Option<&DriverPackageSchemaMigrationContract>,
) -> Result<(), String> {
    let Some(contract) = contract else {
        return Ok(());
    };
    if contract.snapshot_version != 1 {
        return Err("Semantic schema migration requires snapshotVersion 1".to_string());
    }
    let Some(capabilities) = capabilities else {
        return Err(
            "Semantic schema migration requires a signed database capability contract".to_string(),
        );
    };
    if !matches!(
        capabilities.data_model,
        crate::core::dialect::DatabaseDataModel::Relational
    ) || !capabilities.supports_table_browsing
        || !capabilities.supports_table_ddl
    {
        return Err(
            "Semantic schema migration requires relational metadata browsing and table DDL capabilities"
                .to_string(),
        );
    }
    if contract.mode == SchemaMigrationMode::Transactional && !capabilities.supports_transactions {
        return Err(
            "Transactional semantic schema migration requires transaction capability".to_string(),
        );
    }
    Ok(())
}
