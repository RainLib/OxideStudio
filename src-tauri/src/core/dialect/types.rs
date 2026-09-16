use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DatabaseDataModel {
    Relational,
    Document,
    KeyValue,
    Search,
    /// A graph store requires its own traversal/query workspace; it must not
    /// inherit the relational Table Editor merely because a package can list
    /// metadata.
    Graph,
    /// Column-family stores are neither SQL tables nor document collections.
    WideColumn,
    /// Measurements, retention and time windows require a dedicated editor.
    TimeSeries,
    /// Coordination/configuration systems expose administrative objects.
    Coordination,
    /// Broker/topic administration has a separate safety model from records.
    Queue,
}

/// Addressing mode is a signed driver capability: external packages must be
/// able to declare local-file data sources without renderer-side ID checks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum DatabaseConnectionMode {
    #[default]
    Network,
    File,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseCapabilities {
    pub driver: String,
    pub display_name: String,
    pub data_model: DatabaseDataModel,
    #[serde(default)]
    pub connection_mode: DatabaseConnectionMode,
    pub lsp_language_id: String,
    /// The parser identity used by the bundled language server. This may be
    /// more specific than the editor language: a compatible product can keep
    /// `lspLanguageId: "sql"` in the UI while using a reviewed MySQL or
    /// PostgreSQL completion baseline.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lsp_server_dialect: Option<String>,
    pub namespace_label: String,
    pub identifier_quote: String,
    pub default_port: u16,
    pub supports_sql_query: bool,
    pub supports_table_browsing: bool,
    /// Host-owned table export encodings enabled for this driver. The list is
    /// explicit because binary analytical formats require a reviewed type
    /// mapping; table browsing alone must not make Parquet or Arrow appear.
    #[serde(default)]
    pub table_export_formats: Vec<String>,
    /// Whether table rows can be inserted, updated, and deleted through the
    /// bounded Data Editor command surface.
    #[serde(default)]
    pub supports_table_row_mutation: bool,
    /// Whether this driver has a reviewed table-to-table transfer contract.
    /// This is intentionally stricter than Grid editing: transfer also relies
    /// on stable paging, identifier quoting, parameter binding, and a clear
    /// partial-commit report across two independent connections.
    #[serde(default)]
    pub supports_table_data_transfer: bool,
    /// Whether the driver implements the Table Editor's DDL actions. Metadata
    /// support alone must never make Create/Rename/Drop controls executable.
    #[serde(default)]
    pub supports_table_ddl: bool,
    /// Whether the bounded Table Editor supports ALTER COLUMN operations for
    /// this driver. Generic DDL support alone is not enough to expose it.
    #[serde(default)]
    pub supports_column_alteration: bool,
    /// Whether the bounded Table Editor can rename an existing index.
    #[serde(default)]
    pub supports_index_rename: bool,
    /// Whether the bounded Table Editor can alter existing constraints.
    #[serde(default)]
    pub supports_constraint_alteration: bool,
    pub supports_collection_browsing: bool,
    pub supports_key_value_browsing: bool,
    pub supports_schemas: bool,
    /// Whether the Explorer may enumerate multiple catalogs/databases beneath
    /// one connection. This is deliberately separate from schemas: DuckDB
    /// attachments, for example, are catalog-scoped even though they are
    /// local files rather than separate network connections.
    #[serde(default)]
    pub supports_database_catalogs: bool,
    /// Whether the connection accepts a database/catalog segment in its URL
    /// and should render that field in the connection form. HTTP engines with
    /// one physical database per endpoint explicitly disable it. Existing
    /// packages default to true to preserve their established URL behavior.
    #[serde(default = "default_true")]
    pub supports_connection_database: bool,
    pub supports_create_database: bool,
    /// Whether database creation accepts an owner / authorization principal.
    /// Optional so packages written before this field existed safely hide it.
    #[serde(default)]
    pub supports_create_database_owner: bool,
    pub supports_create_database_charset: bool,
    /// Whether database creation accepts an explicit collation. This is kept
    /// independent from character sets because several engines support one
    /// but not the other.
    #[serde(default)]
    pub supports_create_database_collation: bool,
    pub supports_column_comments: bool,
    pub supports_inline_column_comments: bool,
    pub supports_rename_database: bool,
    pub supports_views: bool,
    pub supports_replace_view: bool,
    pub supports_materialized_views: bool,
    pub supports_table_indexes: bool,
    pub supports_table_constraints: bool,
    pub supports_foreign_keys: bool,
    pub supports_check_constraints: bool,
    pub supports_functions: bool,
    pub supports_transactions: bool,
    pub supports_query_cancellation: bool,
    pub supports_explain_plan: bool,
    pub auto_increment_keyword: Option<String>,
    pub default_primary_key_type: String,
    pub common_data_types: Vec<String>,
}

#[derive(Debug, Clone, Copy)]
pub struct DatabaseSpec {
    pub driver: &'static str,
    pub aliases: &'static [&'static str],
    pub display_name: &'static str,
    pub data_model: DatabaseDataModel,
    pub connection_mode: DatabaseConnectionMode,
    pub lsp_language_id: &'static str,
    pub namespace_label: &'static str,
    pub identifier_quote: char,
    pub default_port: u16,
    pub supports_sql_query: bool,
    pub supports_table_browsing: bool,
    pub supports_table_row_mutation: bool,
    pub supports_table_ddl: bool,
    pub supports_column_alteration: bool,
    pub supports_index_rename: bool,
    pub supports_constraint_alteration: bool,
    pub supports_collection_browsing: bool,
    pub supports_key_value_browsing: bool,
    pub supports_schemas: bool,
    pub supports_database_catalogs: bool,
    pub supports_connection_database: bool,
    pub supports_create_database: bool,
    pub supports_create_database_owner: bool,
    pub supports_create_database_charset: bool,
    pub supports_create_database_collation: bool,
    pub supports_column_comments: bool,
    pub supports_inline_column_comments: bool,
    pub supports_rename_database: bool,
    pub supports_views: bool,
    pub supports_replace_view: bool,
    pub supports_materialized_views: bool,
    pub supports_table_indexes: bool,
    pub supports_table_constraints: bool,
    pub supports_foreign_keys: bool,
    pub supports_check_constraints: bool,
    pub supports_functions: bool,
    pub supports_transactions: bool,
    pub supports_query_cancellation: bool,
    pub supports_explain_plan: bool,
    pub auto_increment_keyword: Option<&'static str>,
    pub default_primary_key_type: &'static str,
    pub common_data_types: &'static [&'static str],
}

impl DatabaseSpec {
    pub fn matches_driver(&self, driver: &str) -> bool {
        let driver = driver.trim();
        self.driver.eq_ignore_ascii_case(driver)
            || self
                .aliases
                .iter()
                .any(|alias| alias.eq_ignore_ascii_case(driver))
    }

    pub fn capabilities(&self) -> DatabaseCapabilities {
        DatabaseCapabilities {
            driver: self.driver.to_string(),
            display_name: self.display_name.to_string(),
            data_model: self.data_model,
            connection_mode: self.connection_mode,
            lsp_language_id: self.lsp_language_id.to_string(),
            lsp_server_dialect: None,
            namespace_label: self.namespace_label.to_string(),
            identifier_quote: if self.identifier_quote == '\0' {
                String::new()
            } else {
                self.identifier_quote.to_string()
            },
            default_port: self.default_port,
            supports_sql_query: self.supports_sql_query,
            supports_table_browsing: self.supports_table_browsing,
            table_export_formats: if self.supports_table_browsing {
                host_table_export_formats()
            } else {
                Vec::new()
            },
            supports_table_row_mutation: self.supports_table_row_mutation,
            // The bundled table engines share the reviewed bounded transfer
            // implementation. External packages must opt in explicitly in
            // their signed capability contract instead of inheriting this
            // merely by supporting ordinary Grid edits.
            supports_table_data_transfer: matches!(self.driver, "postgres" | "mysql" | "sqlite"),
            supports_table_ddl: self.supports_table_ddl,
            supports_column_alteration: self.supports_column_alteration,
            supports_index_rename: self.supports_index_rename,
            supports_constraint_alteration: self.supports_constraint_alteration,
            supports_collection_browsing: self.supports_collection_browsing,
            supports_key_value_browsing: self.supports_key_value_browsing,
            supports_schemas: self.supports_schemas,
            supports_database_catalogs: self.supports_database_catalogs,
            supports_connection_database: self.supports_connection_database,
            supports_create_database: self.supports_create_database,
            supports_create_database_owner: self.supports_create_database_owner,
            supports_create_database_charset: self.supports_create_database_charset,
            supports_create_database_collation: self.supports_create_database_collation,
            supports_column_comments: self.supports_column_comments,
            supports_inline_column_comments: self.supports_inline_column_comments,
            supports_rename_database: self.supports_rename_database,
            supports_views: self.supports_views,
            supports_replace_view: self.supports_replace_view,
            supports_materialized_views: self.supports_materialized_views,
            supports_table_indexes: self.supports_table_indexes,
            supports_table_constraints: self.supports_table_constraints,
            supports_foreign_keys: self.supports_foreign_keys,
            supports_check_constraints: self.supports_check_constraints,
            supports_functions: self.supports_functions,
            supports_transactions: self.supports_transactions,
            supports_query_cancellation: self.supports_query_cancellation,
            supports_explain_plan: self.supports_explain_plan,
            auto_increment_keyword: self.auto_increment_keyword.map(ToString::to_string),
            default_primary_key_type: self.default_primary_key_type.to_string(),
            common_data_types: self
                .common_data_types
                .iter()
                .map(ToString::to_string)
                .collect(),
        }
    }
}

fn default_true() -> bool {
    true
}

pub const HOST_TABLE_EXPORT_FORMATS: &[&str] = &[
    "csv", "json", "jsonl", "markdown", "sql", "tsv", "xlsx", "parquet", "arrow",
];
pub const DECLARED_TABLE_EXPORT_FORMATS: &[&str] = &[
    "csv", "json", "jsonl", "markdown", "sql", "tsv", "xlsx", "parquet", "arrow",
];

pub fn host_table_export_formats() -> Vec<String> {
    HOST_TABLE_EXPORT_FORMATS
        .iter()
        .map(|format| (*format).to_string())
        .collect()
}

pub fn retain_host_table_export_formats(capabilities: &mut DatabaseCapabilities) {
    capabilities
        .table_export_formats
        .retain(|format| HOST_TABLE_EXPORT_FORMATS.contains(&format.as_str()));
}
