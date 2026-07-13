use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::str::FromStr;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DatabaseDataModel {
    Relational,
    Document,
    KeyValue,
    Search,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseCapabilities {
    pub driver: String,
    pub display_name: String,
    pub data_model: DatabaseDataModel,
    pub lsp_language_id: String,
    pub namespace_label: String,
    pub identifier_quote: String,
    pub default_port: u16,
    pub supports_sql_query: bool,
    pub supports_table_browsing: bool,
    pub supports_collection_browsing: bool,
    pub supports_key_value_browsing: bool,
    pub supports_schemas: bool,
    pub supports_create_database: bool,
    pub supports_create_database_charset: bool,
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
    pub lsp_language_id: &'static str,
    pub namespace_label: &'static str,
    pub identifier_quote: char,
    pub default_port: u16,
    pub supports_sql_query: bool,
    pub supports_table_browsing: bool,
    pub supports_collection_browsing: bool,
    pub supports_key_value_browsing: bool,
    pub supports_schemas: bool,
    pub supports_create_database: bool,
    pub supports_create_database_charset: bool,
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
            lsp_language_id: self.lsp_language_id.to_string(),
            namespace_label: self.namespace_label.to_string(),
            identifier_quote: if self.identifier_quote == '\0' {
                String::new()
            } else {
                self.identifier_quote.to_string()
            },
            default_port: self.default_port,
            supports_sql_query: self.supports_sql_query,
            supports_table_browsing: self.supports_table_browsing,
            supports_collection_browsing: self.supports_collection_browsing,
            supports_key_value_browsing: self.supports_key_value_browsing,
            supports_schemas: self.supports_schemas,
            supports_create_database: self.supports_create_database,
            supports_create_database_charset: self.supports_create_database_charset,
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

const POSTGRES_COMMON_DATA_TYPES: &[&str] = &[
    "INTEGER",
    "BIGINT",
    "SERIAL",
    "BIGSERIAL",
    "VARCHAR",
    "TEXT",
    "BOOLEAN",
    "DATE",
    "TIMESTAMP",
    "DECIMAL",
    "REAL",
    "DOUBLE PRECISION",
    "JSONB",
    "UUID",
];

const MYSQL_COMMON_DATA_TYPES: &[&str] = &[
    "INT", "BIGINT", "VARCHAR", "TEXT", "DATE", "DATETIME", "BOOLEAN", "DECIMAL", "FLOAT",
    "DOUBLE", "TINYINT", "SMALLINT", "BLOB", "JSON",
];

const REDIS_COMMON_DATA_TYPES: &[&str] = &["string", "list", "set", "zset", "hash", "stream"];

const ELASTICSEARCH_COMMON_DATA_TYPES: &[&str] = &[
    "object",
    "keyword",
    "text",
    "long",
    "integer",
    "double",
    "boolean",
    "date",
    "nested",
    "geo_point",
];

const MONGODB_COMMON_DATA_TYPES: &[&str] = &[
    "objectId", "string", "int", "long", "double", "decimal", "bool", "date", "object", "array",
    "null",
];

const POSTGRES_SPEC: DatabaseSpec = DatabaseSpec {
    driver: "postgres",
    aliases: &["postgresql", "pgsql"],
    display_name: "PostgreSQL",
    data_model: DatabaseDataModel::Relational,
    lsp_language_id: "postgres",
    namespace_label: "schema",
    identifier_quote: '"',
    default_port: 5432,
    supports_sql_query: true,
    supports_table_browsing: true,
    supports_collection_browsing: false,
    supports_key_value_browsing: false,
    supports_schemas: true,
    supports_create_database: true,
    supports_create_database_charset: false,
    supports_column_comments: true,
    supports_inline_column_comments: false,
    supports_rename_database: true,
    supports_views: true,
    supports_replace_view: true,
    supports_materialized_views: true,
    supports_table_indexes: true,
    supports_table_constraints: true,
    supports_foreign_keys: true,
    supports_check_constraints: true,
    supports_functions: true,
    supports_transactions: true,
    supports_query_cancellation: true,
    auto_increment_keyword: None,
    default_primary_key_type: "SERIAL",
    common_data_types: POSTGRES_COMMON_DATA_TYPES,
};

const MYSQL_SPEC: DatabaseSpec = DatabaseSpec {
    driver: "mysql",
    aliases: &["mariadb"],
    display_name: "MySQL",
    data_model: DatabaseDataModel::Relational,
    lsp_language_id: "mysql",
    namespace_label: "database",
    identifier_quote: '`',
    default_port: 3306,
    supports_sql_query: true,
    supports_table_browsing: true,
    supports_collection_browsing: false,
    supports_key_value_browsing: false,
    supports_schemas: true,
    supports_create_database: true,
    supports_create_database_charset: true,
    supports_column_comments: true,
    supports_inline_column_comments: true,
    supports_rename_database: false,
    supports_views: true,
    supports_replace_view: true,
    supports_materialized_views: false,
    supports_table_indexes: true,
    supports_table_constraints: true,
    supports_foreign_keys: true,
    supports_check_constraints: true,
    supports_functions: true,
    supports_transactions: true,
    supports_query_cancellation: true,
    auto_increment_keyword: Some("AUTO_INCREMENT"),
    default_primary_key_type: "INT",
    common_data_types: MYSQL_COMMON_DATA_TYPES,
};

const REDIS_SPEC: DatabaseSpec = DatabaseSpec {
    driver: "redis",
    aliases: &[],
    display_name: "Redis",
    data_model: DatabaseDataModel::KeyValue,
    lsp_language_id: "redis",
    namespace_label: "database",
    identifier_quote: '\0',
    default_port: 6379,
    supports_sql_query: false,
    supports_table_browsing: false,
    supports_collection_browsing: false,
    supports_key_value_browsing: true,
    supports_schemas: true,
    supports_create_database: false,
    supports_create_database_charset: false,
    supports_column_comments: false,
    supports_inline_column_comments: false,
    supports_rename_database: false,
    supports_views: false,
    supports_replace_view: false,
    supports_materialized_views: false,
    supports_table_indexes: false,
    supports_table_constraints: false,
    supports_foreign_keys: false,
    supports_check_constraints: false,
    supports_functions: false,
    supports_transactions: false,
    supports_query_cancellation: false,
    auto_increment_keyword: None,
    default_primary_key_type: "",
    common_data_types: REDIS_COMMON_DATA_TYPES,
};

const ELASTICSEARCH_SPEC: DatabaseSpec = DatabaseSpec {
    driver: "elasticsearch",
    aliases: &["elastic"],
    display_name: "Elasticsearch",
    data_model: DatabaseDataModel::Search,
    lsp_language_id: "elasticsearch-dsl",
    namespace_label: "index",
    identifier_quote: '\0',
    default_port: 9200,
    supports_sql_query: false,
    supports_table_browsing: false,
    supports_collection_browsing: true,
    supports_key_value_browsing: false,
    supports_schemas: false,
    supports_create_database: false,
    supports_create_database_charset: false,
    supports_column_comments: false,
    supports_inline_column_comments: false,
    supports_rename_database: false,
    supports_views: false,
    supports_replace_view: false,
    supports_materialized_views: false,
    supports_table_indexes: false,
    supports_table_constraints: false,
    supports_foreign_keys: false,
    supports_check_constraints: false,
    supports_functions: false,
    supports_transactions: false,
    supports_query_cancellation: false,
    auto_increment_keyword: None,
    default_primary_key_type: "",
    common_data_types: ELASTICSEARCH_COMMON_DATA_TYPES,
};

const MONGODB_SPEC: DatabaseSpec = DatabaseSpec {
    driver: "mongodb",
    aliases: &["mongo"],
    display_name: "MongoDB",
    data_model: DatabaseDataModel::Document,
    lsp_language_id: "mongodb",
    namespace_label: "database",
    identifier_quote: '\0',
    default_port: 27017,
    supports_sql_query: false,
    supports_table_browsing: false,
    supports_collection_browsing: true,
    supports_key_value_browsing: false,
    supports_schemas: true,
    supports_create_database: false,
    supports_create_database_charset: false,
    supports_column_comments: false,
    supports_inline_column_comments: false,
    supports_rename_database: false,
    supports_views: false,
    supports_replace_view: false,
    supports_materialized_views: false,
    supports_table_indexes: false,
    supports_table_constraints: false,
    supports_foreign_keys: false,
    supports_check_constraints: false,
    supports_functions: false,
    supports_transactions: false,
    supports_query_cancellation: false,
    auto_increment_keyword: None,
    default_primary_key_type: "",
    common_data_types: MONGODB_COMMON_DATA_TYPES,
};

const DATABASE_SPECS: &[&DatabaseSpec] = &[
    &POSTGRES_SPEC,
    &MYSQL_SPEC,
    &ELASTICSEARCH_SPEC,
    &MONGODB_SPEC,
    &REDIS_SPEC,
];

pub fn redis_capabilities() -> DatabaseCapabilities {
    REDIS_SPEC.capabilities()
}

pub fn elasticsearch_capabilities() -> DatabaseCapabilities {
    ELASTICSEARCH_SPEC.capabilities()
}

pub fn mongodb_capabilities() -> DatabaseCapabilities {
    MONGODB_SPEC.capabilities()
}

pub fn all_database_capabilities() -> Vec<DatabaseCapabilities> {
    DATABASE_SPECS
        .iter()
        .map(|spec| spec.capabilities())
        .collect()
}

pub fn database_spec_for_driver(driver: &str) -> Option<&'static DatabaseSpec> {
    DATABASE_SPECS
        .iter()
        .copied()
        .find(|spec| spec.matches_driver(driver))
}

pub fn canonical_driver_name(driver: &str) -> Option<&'static str> {
    database_spec_for_driver(driver).map(|spec| spec.driver)
}

pub fn database_capabilities_for_driver(driver: &str) -> Result<DatabaseCapabilities> {
    database_spec_for_driver(driver)
        .map(DatabaseSpec::capabilities)
        .ok_or_else(|| anyhow!("Unsupported database driver: {}", driver.trim()))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseKind {
    Postgres,
    Mysql,
}

impl DatabaseKind {
    pub const fn all() -> &'static [DatabaseKind] {
        &[Self::Postgres, Self::Mysql]
    }

    pub const fn spec(self) -> &'static DatabaseSpec {
        match self {
            Self::Postgres => &POSTGRES_SPEC,
            Self::Mysql => &MYSQL_SPEC,
        }
    }

    pub fn as_str(self) -> &'static str {
        self.spec().driver
    }

    pub fn lsp_language_id(self) -> &'static str {
        self.spec().lsp_language_id
    }

    pub fn identifier_quote(self) -> char {
        self.spec().identifier_quote
    }

    pub fn display_name(self) -> &'static str {
        self.spec().display_name
    }

    pub fn default_port(self) -> u16 {
        self.spec().default_port
    }

    pub fn capabilities(self) -> DatabaseCapabilities {
        self.spec().capabilities()
    }

    pub fn common_data_types(self) -> &'static [&'static str] {
        self.spec().common_data_types
    }

    pub fn supports_data_type(self, data_type: &str) -> bool {
        let normalized = normalize_data_type(data_type);
        let common_types = self.common_data_types();
        if common_types
            .iter()
            .any(|value| normalize_data_type(value) == normalized)
        {
            return true;
        }

        let first_token = normalized.split_whitespace().next().unwrap_or("");
        if common_types
            .iter()
            .any(|value| normalize_data_type(value) == first_token)
        {
            return true;
        }

        let base_type = normalized.split('(').next().unwrap_or("").trim();
        if common_types
            .iter()
            .any(|value| normalize_data_type(value) == base_type)
        {
            return true;
        }

        matches!(
            (self, normalized.as_str()),
            (Self::Postgres, "CHARACTER VARYING")
                | (Self::Postgres, "CHARACTER")
                | (Self::Mysql, "INTEGER")
        )
    }

    pub fn auto_increment_clause_for_type(self, data_type: &str) -> Result<Option<&'static str>> {
        match self {
            Self::Mysql => {
                if mysql_auto_increment_type(data_type) {
                    Ok(self.spec().auto_increment_keyword)
                } else {
                    Err(anyhow!(
                        "Auto-increment is only supported for integer columns, got {}",
                        data_type
                    ))
                }
            }
            Self::Postgres => postgres_identity_clause_for_type(data_type),
        }
    }

    pub fn metadata_default_sql(self, data_type: &str, value: &str) -> String {
        let value = value.trim();
        match self {
            Self::Mysql if mysql_default_needs_quotes(data_type) => {
                let upper = value.to_ascii_uppercase();
                if value.starts_with('\'')
                    || value.starts_with('"')
                    || value.starts_with('(')
                    || upper == "NULL"
                    || upper.starts_with("CURRENT_")
                    || upper == "CURRENT_TIMESTAMP"
                {
                    value.to_string()
                } else {
                    sql_string_literal(value)
                }
            }
            _ => value.to_string(),
        }
    }

    pub fn parameter_placeholder(self, index: usize, data_type: &str) -> String {
        match self {
            Self::Mysql => "?".to_string(),
            Self::Postgres => {
                let placeholder = format!("${index}");
                if let Some(cast_type) = postgres_cast_type(data_type) {
                    format!("{placeholder}::{cast_type}")
                } else {
                    placeholder
                }
            }
        }
    }

    pub fn text_cast_expression(self, identifier: &str) -> String {
        match self {
            Self::Postgres => format!("CAST({identifier} AS text)"),
            Self::Mysql => format!("CAST({identifier} AS CHAR)"),
        }
    }

    pub fn quote_identifier(self, identifier: &str) -> String {
        let quote = self.identifier_quote();
        let escaped = identifier.replace(quote, &format!("{quote}{quote}"));
        format!("{quote}{escaped}{quote}")
    }

    pub fn qualified_table(self, schema: Option<&str>, table: &str) -> String {
        match schema.filter(|s| !s.trim().is_empty()) {
            Some(schema) => format!(
                "{}.{}",
                self.quote_identifier(schema),
                self.quote_identifier(table)
            ),
            None => self.quote_identifier(table),
        }
    }

    pub fn preview_query(self, schema: Option<&str>, table: &str, limit: u32) -> String {
        format!(
            "SELECT * FROM {} LIMIT {};",
            self.qualified_table(schema, table),
            limit
        )
    }

    pub fn paged_table_query(
        self,
        schema: Option<&str>,
        table: &str,
        where_clause: Option<&str>,
        limit: u32,
        offset: u64,
    ) -> String {
        self.paged_table_query_with_order(schema, table, where_clause, None, limit, offset)
    }

    pub fn paged_table_query_with_order(
        self,
        schema: Option<&str>,
        table: &str,
        where_clause: Option<&str>,
        order_clause: Option<&str>,
        limit: u32,
        offset: u64,
    ) -> String {
        let where_clause = normalize_where_clause(where_clause);
        let order_clause = normalize_order_clause(order_clause);
        format!(
            "SELECT * FROM {}{}{} LIMIT {} OFFSET {};",
            self.qualified_table(schema, table),
            where_clause,
            order_clause,
            limit,
            offset
        )
    }

    pub fn count_table_query(
        self,
        schema: Option<&str>,
        table: &str,
        where_clause: Option<&str>,
    ) -> String {
        let where_clause = normalize_where_clause(where_clause);
        format!(
            "SELECT COUNT(*) FROM {}{};",
            self.qualified_table(schema, table),
            where_clause
        )
    }

    pub fn truncate_table_query(self, schema: Option<&str>, table: &str) -> String {
        format!("TRUNCATE TABLE {};", self.qualified_table(schema, table))
    }

    pub fn drop_table_query(self, schema: Option<&str>, table: &str, cascade: bool) -> String {
        self.drop_relation_query(schema, table, false, cascade)
    }

    pub fn create_view_query(
        self,
        schema: Option<&str>,
        view: &str,
        select_sql: &str,
        replace: bool,
    ) -> String {
        let replace = if replace { " OR REPLACE" } else { "" };
        format!(
            "CREATE{replace} VIEW {} AS\n{};",
            self.qualified_table(schema, view),
            select_sql.trim().trim_end_matches(';').trim()
        )
    }

    pub fn create_materialized_view_query(
        self,
        schema: Option<&str>,
        view: &str,
        select_sql: &str,
        with_data: bool,
    ) -> Option<String> {
        match self {
            Self::Postgres => {
                let data_clause = if with_data {
                    "WITH DATA"
                } else {
                    "WITH NO DATA"
                };
                Some(format!(
                    "CREATE MATERIALIZED VIEW {} AS\n{}\n{data_clause};",
                    self.qualified_table(schema, view),
                    select_sql.trim().trim_end_matches(';').trim()
                ))
            }
            Self::Mysql => None,
        }
    }

    pub fn drop_relation_query(
        self,
        schema: Option<&str>,
        relation: &str,
        is_view: bool,
        cascade: bool,
    ) -> String {
        self.drop_relation_query_with_kind(schema, relation, is_view, false, false, cascade)
    }

    pub fn drop_relation_query_with_kind(
        self,
        schema: Option<&str>,
        relation: &str,
        is_view: bool,
        is_materialized_view: bool,
        is_foreign_table: bool,
        cascade: bool,
    ) -> String {
        match self {
            Self::Postgres => {
                let behavior = if cascade { " CASCADE" } else { "" };
                let object = if is_materialized_view {
                    "MATERIALIZED VIEW"
                } else if is_foreign_table {
                    "FOREIGN TABLE"
                } else if is_view {
                    "VIEW"
                } else {
                    "TABLE"
                };
                format!(
                    "DROP {object} {}{};",
                    self.qualified_table(schema, relation),
                    behavior
                )
            }
            Self::Mysql => {
                let object = if is_view { "VIEW" } else { "TABLE" };
                format!("DROP {object} {};", self.qualified_table(schema, relation))
            }
        }
    }

    pub fn create_index_query(
        self,
        schema: Option<&str>,
        table: &str,
        index: &str,
        columns: &[String],
        unique: bool,
    ) -> String {
        let unique = if unique { "UNIQUE " } else { "" };
        let columns = columns
            .iter()
            .map(|column| self.quote_identifier(column))
            .collect::<Vec<_>>()
            .join(", ");
        format!(
            "CREATE {unique}INDEX {} ON {} ({});",
            self.quote_identifier(index),
            self.qualified_table(schema, table),
            columns
        )
    }

    pub fn drop_index_query(self, schema: Option<&str>, table: &str, index: &str) -> String {
        match self {
            Self::Postgres => {
                let qualified_index = match schema.filter(|s| !s.trim().is_empty()) {
                    Some(schema) => format!(
                        "{}.{}",
                        self.quote_identifier(schema),
                        self.quote_identifier(index)
                    ),
                    None => self.quote_identifier(index),
                };
                format!("DROP INDEX {qualified_index};")
            }
            Self::Mysql => format!(
                "DROP INDEX {} ON {};",
                self.quote_identifier(index),
                self.qualified_table(schema, table)
            ),
        }
    }

    pub fn add_unique_constraint_query(
        self,
        schema: Option<&str>,
        table: &str,
        constraint: &str,
        columns: &[String],
    ) -> String {
        let columns = columns
            .iter()
            .map(|column| self.quote_identifier(column))
            .collect::<Vec<_>>()
            .join(", ");
        format!(
            "ALTER TABLE {} ADD CONSTRAINT {} UNIQUE ({});",
            self.qualified_table(schema, table),
            self.quote_identifier(constraint),
            columns
        )
    }

    pub fn add_primary_key_constraint_query(
        self,
        schema: Option<&str>,
        table: &str,
        constraint: &str,
        columns: &[String],
    ) -> String {
        let columns = columns
            .iter()
            .map(|column| self.quote_identifier(column))
            .collect::<Vec<_>>()
            .join(", ");
        format!(
            "ALTER TABLE {} ADD CONSTRAINT {} PRIMARY KEY ({});",
            self.qualified_table(schema, table),
            self.quote_identifier(constraint),
            columns
        )
    }

    pub fn add_check_constraint_query(
        self,
        schema: Option<&str>,
        table: &str,
        constraint: &str,
        expression: &str,
    ) -> String {
        format!(
            "ALTER TABLE {} ADD CONSTRAINT {} CHECK ({});",
            self.qualified_table(schema, table),
            self.quote_identifier(constraint),
            expression.trim()
        )
    }

    // Foreign keys have several independent SQL clauses; keeping them
    // explicit makes call sites type checked and avoids a loosely typed bag.
    #[allow(clippy::too_many_arguments)]
    pub fn add_foreign_key_constraint_query(
        self,
        schema: Option<&str>,
        table: &str,
        constraint: &str,
        columns: &[String],
        referenced_schema: Option<&str>,
        referenced_table: &str,
        referenced_columns: &[String],
        on_delete: Option<&str>,
        on_update: Option<&str>,
    ) -> String {
        let columns = columns
            .iter()
            .map(|column| self.quote_identifier(column))
            .collect::<Vec<_>>()
            .join(", ");
        let referenced_columns = referenced_columns
            .iter()
            .map(|column| self.quote_identifier(column))
            .collect::<Vec<_>>()
            .join(", ");
        let on_delete = on_delete
            .filter(|value| !value.trim().is_empty())
            .map(|value| format!(" ON DELETE {}", value.trim()))
            .unwrap_or_default();
        let on_update = on_update
            .filter(|value| !value.trim().is_empty())
            .map(|value| format!(" ON UPDATE {}", value.trim()))
            .unwrap_or_default();

        format!(
            "ALTER TABLE {} ADD CONSTRAINT {} FOREIGN KEY ({}) REFERENCES {} ({}){}{};",
            self.qualified_table(schema, table),
            self.quote_identifier(constraint),
            columns,
            self.qualified_table(referenced_schema, referenced_table),
            referenced_columns,
            on_delete,
            on_update
        )
    }

    pub fn drop_constraint_query(
        self,
        schema: Option<&str>,
        table: &str,
        constraint: &str,
        constraint_type: &str,
    ) -> String {
        match self {
            Self::Postgres => format!(
                "ALTER TABLE {} DROP CONSTRAINT {};",
                self.qualified_table(schema, table),
                self.quote_identifier(constraint)
            ),
            Self::Mysql => {
                let normalized = constraint_type.to_ascii_uppercase();
                if normalized.contains("FOREIGN") {
                    format!(
                        "ALTER TABLE {} DROP FOREIGN KEY {};",
                        self.qualified_table(schema, table),
                        self.quote_identifier(constraint)
                    )
                } else if normalized.contains("PRIMARY") {
                    format!(
                        "ALTER TABLE {} DROP PRIMARY KEY;",
                        self.qualified_table(schema, table)
                    )
                } else if normalized.contains("CHECK") {
                    format!(
                        "ALTER TABLE {} DROP CHECK {};",
                        self.qualified_table(schema, table),
                        self.quote_identifier(constraint)
                    )
                } else {
                    format!(
                        "ALTER TABLE {} DROP INDEX {};",
                        self.qualified_table(schema, table),
                        self.quote_identifier(constraint)
                    )
                }
            }
        }
    }

    pub fn rename_table_query(
        self,
        schema: Option<&str>,
        old_name: &str,
        new_name: &str,
    ) -> String {
        self.rename_relation_query(schema, old_name, new_name, false)
    }

    pub fn rename_relation_query(
        self,
        schema: Option<&str>,
        old_name: &str,
        new_name: &str,
        is_view: bool,
    ) -> String {
        self.rename_relation_query_with_kind(schema, old_name, new_name, is_view, false, false)
    }

    pub fn rename_relation_query_with_kind(
        self,
        schema: Option<&str>,
        old_name: &str,
        new_name: &str,
        is_view: bool,
        is_materialized_view: bool,
        is_foreign_table: bool,
    ) -> String {
        match self {
            Self::Postgres => {
                let object = if is_materialized_view {
                    "MATERIALIZED VIEW"
                } else if is_foreign_table {
                    "FOREIGN TABLE"
                } else if is_view {
                    "VIEW"
                } else {
                    "TABLE"
                };
                format!(
                    "ALTER {object} {} RENAME TO {};",
                    self.qualified_table(schema, old_name),
                    self.quote_identifier(new_name)
                )
            }
            Self::Mysql => {
                let old_table = self.qualified_table(schema, old_name);
                let new_table = self.qualified_table(schema, new_name);
                format!("RENAME TABLE {old_table} TO {new_table};")
            }
        }
    }

    pub fn rename_column_query(
        self,
        schema: Option<&str>,
        table: &str,
        old_name: &str,
        new_name: &str,
    ) -> String {
        format!(
            "ALTER TABLE {} RENAME COLUMN {} TO {};",
            self.qualified_table(schema, table),
            self.quote_identifier(old_name),
            self.quote_identifier(new_name)
        )
    }

    pub fn rename_index_query(
        self,
        schema: Option<&str>,
        table: &str,
        old_name: &str,
        new_name: &str,
    ) -> String {
        match self {
            Self::Postgres => {
                let old_index = match schema.filter(|s| !s.trim().is_empty()) {
                    Some(schema) => format!(
                        "{}.{}",
                        self.quote_identifier(schema),
                        self.quote_identifier(old_name)
                    ),
                    None => self.quote_identifier(old_name),
                };
                format!(
                    "ALTER INDEX {old_index} RENAME TO {};",
                    self.quote_identifier(new_name)
                )
            }
            Self::Mysql => format!(
                "ALTER TABLE {} RENAME INDEX {} TO {};",
                self.qualified_table(schema, table),
                self.quote_identifier(old_name),
                self.quote_identifier(new_name)
            ),
        }
    }

    pub fn drop_column_query(
        self,
        schema: Option<&str>,
        table: &str,
        column: &str,
        cascade: bool,
    ) -> String {
        match self {
            Self::Postgres => {
                let behavior = if cascade { " CASCADE" } else { "" };
                format!(
                    "ALTER TABLE {} DROP COLUMN {}{};",
                    self.qualified_table(schema, table),
                    self.quote_identifier(column),
                    behavior
                )
            }
            Self::Mysql => format!(
                "ALTER TABLE {} DROP COLUMN {};",
                self.qualified_table(schema, table),
                self.quote_identifier(column)
            ),
        }
    }

    pub fn show_create_table_query(self, schema: Option<&str>, table: &str) -> Option<String> {
        self.show_create_relation_query(schema, table, false)
    }

    pub fn show_create_relation_query(
        self,
        schema: Option<&str>,
        relation: &str,
        is_view: bool,
    ) -> Option<String> {
        match self {
            Self::Mysql if is_view => Some(format!(
                "SHOW CREATE VIEW {};",
                self.qualified_table(schema, relation)
            )),
            Self::Mysql => Some(format!(
                "SHOW CREATE TABLE {};",
                self.qualified_table(schema, relation)
            )),
            Self::Postgres => None,
        }
    }

    pub fn refresh_materialized_view_query(
        self,
        schema: Option<&str>,
        view: &str,
        concurrently: bool,
    ) -> Option<String> {
        match self {
            Self::Postgres => {
                let concurrently = if concurrently { " CONCURRENTLY" } else { "" };
                Some(format!(
                    "REFRESH MATERIALIZED VIEW{concurrently} {};",
                    self.qualified_table(schema, view)
                ))
            }
            Self::Mysql => None,
        }
    }
}

fn normalize_where_clause(where_clause: Option<&str>) -> String {
    let Some(where_clause) = where_clause
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return String::new();
    };

    if where_clause.to_ascii_uppercase().starts_with("WHERE ") {
        format!(" {}", where_clause)
    } else {
        format!(" WHERE {}", where_clause)
    }
}

fn normalize_order_clause(order_clause: Option<&str>) -> String {
    let Some(order_clause) = order_clause
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return String::new();
    };

    if order_clause.to_ascii_uppercase().starts_with("ORDER BY ") {
        format!(" {}", order_clause)
    } else {
        format!(" ORDER BY {}", order_clause)
    }
}

fn normalize_data_type(value: &str) -> String {
    value.trim().to_ascii_uppercase()
}

fn base_data_type(value: &str) -> String {
    normalize_data_type(value)
        .split('(')
        .next()
        .unwrap_or("")
        .split_whitespace()
        .next()
        .unwrap_or("")
        .trim()
        .to_string()
}

fn postgres_identity_clause_for_type(data_type: &str) -> Result<Option<&'static str>> {
    match base_data_type(data_type).as_str() {
        "SMALLSERIAL" | "SERIAL" | "BIGSERIAL" => Ok(None),
        "SMALLINT" | "INT2" | "INTEGER" | "INT" | "INT4" | "BIGINT" | "INT8" => {
            Ok(Some(" GENERATED BY DEFAULT AS IDENTITY"))
        }
        _ => Err(anyhow!(
            "Auto-increment is only supported for integer columns, got {}",
            data_type
        )),
    }
}

fn mysql_auto_increment_type(data_type: &str) -> bool {
    matches!(
        base_data_type(data_type).as_str(),
        "TINYINT" | "SMALLINT" | "MEDIUMINT" | "INT" | "INTEGER" | "BIGINT"
    )
}

fn mysql_default_needs_quotes(data_type: &str) -> bool {
    matches!(
        base_data_type(data_type).as_str(),
        "CHAR"
            | "VARCHAR"
            | "TINYTEXT"
            | "TEXT"
            | "MEDIUMTEXT"
            | "LONGTEXT"
            | "DATE"
            | "DATETIME"
            | "TIMESTAMP"
            | "TIME"
            | "YEAR"
            | "JSON"
            | "ENUM"
            | "SET"
    )
}

fn postgres_cast_type(data_type: &str) -> Option<String> {
    let data_type = data_type.trim();
    if data_type.is_empty() {
        return None;
    }
    if let Some(element_type) = data_type.strip_suffix("[]") {
        return postgres_cast_type(element_type).map(|element_type| format!("{element_type}[]"));
    }

    let normalized = data_type.to_ascii_lowercase();
    if normalized.starts_with("timestamp(") {
        return Some(
            if normalized.ends_with("with time zone") {
                "timestamptz"
            } else {
                "timestamp"
            }
            .to_string(),
        );
    }
    if normalized.starts_with("time(") {
        return Some(
            if normalized.ends_with("with time zone") {
                "timetz"
            } else {
                "time"
            }
            .to_string(),
        );
    }
    let base_type = normalized.split('(').next().unwrap_or("").trim();
    let canonical = match base_type {
        "smallint" | "int2" => Some("smallint"),
        "integer" | "int" | "int4" | "serial" => Some("integer"),
        "bigint" | "int8" | "bigserial" => Some("bigint"),
        "real" | "float4" => Some("real"),
        "double precision" | "float8" => Some("double precision"),
        "numeric" | "decimal" => Some("numeric"),
        "boolean" | "bool" => Some("boolean"),
        "text" => Some("text"),
        "character varying" | "varchar" => Some("character varying"),
        "character" | "char" => Some("character"),
        "date" => Some("date"),
        "timestamp" | "timestamp without time zone" => Some("timestamp"),
        "timestamp with time zone" | "timestamptz" => Some("timestamptz"),
        "time" | "time without time zone" => Some("time"),
        "time with time zone" | "timetz" => Some("timetz"),
        "json" => Some("json"),
        "jsonb" => Some("jsonb"),
        "uuid" => Some("uuid"),
        _ => None,
    };

    canonical
        .map(str::to_string)
        .or_else(|| postgres_type_expression_is_safe(data_type).then(|| data_type.to_string()))
}

fn postgres_type_expression_is_safe(data_type: &str) -> bool {
    let mut chars = data_type.chars().peekable();
    let mut quoted = false;
    let mut parentheses = 0_u32;

    while let Some(ch) = chars.next() {
        if quoted {
            if ch == '"' {
                if chars.peek() == Some(&'"') {
                    chars.next();
                } else {
                    quoted = false;
                }
            }
            continue;
        }

        match ch {
            '"' => quoted = true,
            '(' => parentheses = parentheses.saturating_add(1),
            ')' if parentheses > 0 => parentheses -= 1,
            ')' => return false,
            '[' if chars.next() == Some(']') => {}
            '[' => return false,
            ',' if parentheses > 0 => {}
            ',' => return false,
            ch if ch.is_whitespace() && parentheses > 0 => {}
            ch if ch.is_alphanumeric() || matches!(ch, '_' | '$' | '.') => {}
            _ => return false,
        }
    }

    !quoted && parentheses == 0
}

fn sql_string_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

impl FromStr for DatabaseKind {
    type Err = anyhow::Error;

    fn from_str(value: &str) -> Result<Self> {
        match database_spec_for_driver(value).map(|spec| spec.driver) {
            Some("postgres") => Ok(Self::Postgres),
            Some("mysql") => Ok(Self::Mysql),
            _ => Err(anyhow!("Unsupported database driver: {}", value.trim())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_query_uses_driver_quotes() {
        assert_eq!(
            DatabaseKind::Postgres.preview_query(Some("public"), "users", 100),
            r#"SELECT * FROM "public"."users" LIMIT 100;"#
        );
        assert_eq!(
            DatabaseKind::Mysql.preview_query(Some("app"), "users", 100),
            "SELECT * FROM `app`.`users` LIMIT 100;"
        );
    }

    #[test]
    fn identifiers_are_escaped() {
        assert_eq!(
            DatabaseKind::Postgres.quote_identifier(r#"a"b"#),
            r#""a""b""#
        );
        assert_eq!(DatabaseKind::Mysql.quote_identifier("a`b"), "`a``b`");
    }

    #[test]
    fn type_helpers_are_driver_specific() {
        assert!(DatabaseKind::Postgres.supports_data_type("character varying"));
        assert!(DatabaseKind::Postgres.supports_data_type("varchar(255)"));
        assert!(DatabaseKind::Mysql.supports_data_type("integer"));
        assert!(DatabaseKind::Mysql.supports_data_type("varchar(255)"));
        assert!(!DatabaseKind::Mysql.supports_data_type("uuid"));

        assert_eq!(
            DatabaseKind::Postgres
                .auto_increment_clause_for_type("integer")
                .unwrap(),
            Some(" GENERATED BY DEFAULT AS IDENTITY")
        );
        assert_eq!(
            DatabaseKind::Postgres
                .auto_increment_clause_for_type("serial")
                .unwrap(),
            None
        );
        assert_eq!(
            DatabaseKind::Mysql
                .auto_increment_clause_for_type("bigint unsigned")
                .unwrap(),
            Some("AUTO_INCREMENT")
        );
        assert!(DatabaseKind::Mysql
            .auto_increment_clause_for_type("varchar")
            .is_err());
    }

    #[test]
    fn value_rendering_helpers_are_driver_specific() {
        assert_eq!(
            DatabaseKind::Postgres.parameter_placeholder(2, "integer"),
            "$2::integer"
        );
        assert_eq!(
            DatabaseKind::Postgres.parameter_placeholder(1, "geometry"),
            "$1::geometry"
        );
        assert_eq!(
            DatabaseKind::Postgres.parameter_placeholder(3, "numeric(20, 8)[]"),
            "$3::numeric[]"
        );
        assert_eq!(
            DatabaseKind::Postgres.parameter_placeholder(4, r#""audit"."odd;type"[]"#),
            r#"$4::"audit"."odd;type"[]"#
        );
        assert_eq!(
            DatabaseKind::Postgres.parameter_placeholder(5, "timestamp(6) with time zone[]"),
            "$5::timestamptz[]"
        );
        assert_eq!(
            DatabaseKind::Postgres.parameter_placeholder(6, "text; DROP TABLE users"),
            "$6"
        );
        assert_eq!(
            DatabaseKind::Postgres.parameter_placeholder(7, "text, current_user"),
            "$7"
        );
        assert_eq!(DatabaseKind::Mysql.parameter_placeholder(3, "integer"), "?");
        assert_eq!(
            DatabaseKind::Postgres.text_cast_expression(r#""name""#),
            r#"CAST("name" AS text)"#
        );
        assert_eq!(
            DatabaseKind::Mysql.text_cast_expression("`name`"),
            "CAST(`name` AS CHAR)"
        );
        assert_eq!(
            DatabaseKind::Mysql.metadata_default_sql("varchar", "guest"),
            "'guest'"
        );
        assert_eq!(
            DatabaseKind::Mysql.metadata_default_sql("integer", "7"),
            "7"
        );
        assert_eq!(
            DatabaseKind::Mysql.metadata_default_sql("timestamp", "CURRENT_TIMESTAMP"),
            "CURRENT_TIMESTAMP"
        );
    }

    #[test]
    fn table_operations_use_driver_specific_sql() {
        assert_eq!(
            DatabaseKind::Postgres.rename_table_query(Some("public"), "old", "new"),
            r#"ALTER TABLE "public"."old" RENAME TO "new";"#
        );
        assert_eq!(
            DatabaseKind::Postgres.rename_relation_query(
                Some("public"),
                "old_view",
                "new_view",
                true
            ),
            r#"ALTER VIEW "public"."old_view" RENAME TO "new_view";"#
        );
        assert_eq!(
            DatabaseKind::Postgres.rename_relation_query_with_kind(
                Some("public"),
                "old_mv",
                "new_mv",
                true,
                true,
                false
            ),
            r#"ALTER MATERIALIZED VIEW "public"."old_mv" RENAME TO "new_mv";"#
        );
        assert_eq!(
            DatabaseKind::Postgres.rename_relation_query_with_kind(
                Some("public"),
                "remote_users",
                "remote_people",
                false,
                false,
                true
            ),
            r#"ALTER FOREIGN TABLE "public"."remote_users" RENAME TO "remote_people";"#
        );
        assert_eq!(
            DatabaseKind::Mysql.rename_table_query(Some("app"), "old", "new"),
            "RENAME TABLE `app`.`old` TO `app`.`new`;"
        );
        assert_eq!(
            DatabaseKind::Postgres.rename_column_query(Some("public"), "users", "old", "new"),
            r#"ALTER TABLE "public"."users" RENAME COLUMN "old" TO "new";"#
        );
        assert_eq!(
            DatabaseKind::Mysql.rename_column_query(Some("app"), "users", "old", "new"),
            "ALTER TABLE `app`.`users` RENAME COLUMN `old` TO `new`;"
        );
        assert_eq!(
            DatabaseKind::Postgres.rename_index_query(
                Some("public"),
                "users",
                "users_email_idx",
                "users_login_idx"
            ),
            r#"ALTER INDEX "public"."users_email_idx" RENAME TO "users_login_idx";"#
        );
        assert_eq!(
            DatabaseKind::Mysql.rename_index_query(
                Some("app"),
                "users",
                "users_email_idx",
                "users_login_idx"
            ),
            "ALTER TABLE `app`.`users` RENAME INDEX `users_email_idx` TO `users_login_idx`;"
        );
        assert_eq!(
            DatabaseKind::Postgres.drop_table_query(Some("public"), "users", true),
            r#"DROP TABLE "public"."users" CASCADE;"#
        );
        assert_eq!(
            DatabaseKind::Postgres.drop_relation_query(Some("public"), "active_users", true, true),
            r#"DROP VIEW "public"."active_users" CASCADE;"#
        );
        assert_eq!(
            DatabaseKind::Postgres.drop_relation_query_with_kind(
                Some("public"),
                "active_users_mv",
                true,
                true,
                false,
                true
            ),
            r#"DROP MATERIALIZED VIEW "public"."active_users_mv" CASCADE;"#
        );
        assert_eq!(
            DatabaseKind::Postgres.drop_relation_query_with_kind(
                Some("public"),
                "remote_users",
                false,
                false,
                true,
                true
            ),
            r#"DROP FOREIGN TABLE "public"."remote_users" CASCADE;"#
        );
        assert_eq!(
            DatabaseKind::Mysql.drop_table_query(Some("app"), "users", true),
            "DROP TABLE `app`.`users`;"
        );
        assert_eq!(
            DatabaseKind::Mysql.drop_relation_query(Some("app"), "active_users", true, true),
            "DROP VIEW `app`.`active_users`;"
        );
        assert_eq!(
            DatabaseKind::Postgres.create_view_query(
                Some("public"),
                "active_users",
                "SELECT * FROM users",
                true
            ),
            r#"CREATE OR REPLACE VIEW "public"."active_users" AS
SELECT * FROM users;"#
        );
        assert_eq!(
            DatabaseKind::Mysql.create_view_query(
                Some("app"),
                "active_users",
                "SELECT * FROM users",
                false
            ),
            "CREATE VIEW `app`.`active_users` AS\nSELECT * FROM users;"
        );
        assert_eq!(
            DatabaseKind::Postgres.refresh_materialized_view_query(
                Some("public"),
                "active_users_mv",
                true
            ),
            Some(
                r#"REFRESH MATERIALIZED VIEW CONCURRENTLY "public"."active_users_mv";"#.to_string()
            )
        );
        assert_eq!(
            DatabaseKind::Postgres.create_materialized_view_query(
                Some("public"),
                "active_users_mv",
                "SELECT * FROM users WHERE active",
                false
            ),
            Some(
                r#"CREATE MATERIALIZED VIEW "public"."active_users_mv" AS
SELECT * FROM users WHERE active
WITH NO DATA;"#
                    .to_string()
            )
        );
        assert_eq!(
            DatabaseKind::Mysql.create_materialized_view_query(
                Some("app"),
                "active_users_mv",
                "SELECT * FROM users",
                true
            ),
            None
        );
        assert_eq!(
            DatabaseKind::Postgres.drop_column_query(Some("public"), "users", "old_name", true),
            r#"ALTER TABLE "public"."users" DROP COLUMN "old_name" CASCADE;"#
        );
        assert_eq!(
            DatabaseKind::Mysql.drop_column_query(Some("app"), "users", "old_name", true),
            "ALTER TABLE `app`.`users` DROP COLUMN `old_name`;"
        );
        assert_eq!(
            DatabaseKind::Postgres.create_index_query(
                Some("public"),
                "users",
                "users_email_idx",
                &["email".to_string()],
                true
            ),
            r#"CREATE UNIQUE INDEX "users_email_idx" ON "public"."users" ("email");"#
        );
        assert_eq!(
            DatabaseKind::Mysql.create_index_query(
                Some("app"),
                "users",
                "users_email_idx",
                &["email".to_string(), "tenant_id".to_string()],
                false
            ),
            "CREATE INDEX `users_email_idx` ON `app`.`users` (`email`, `tenant_id`);"
        );
        assert_eq!(
            DatabaseKind::Postgres.drop_index_query(Some("public"), "users", "users_email_idx"),
            r#"DROP INDEX "public"."users_email_idx";"#
        );
        assert_eq!(
            DatabaseKind::Mysql.drop_index_query(Some("app"), "users", "users_email_idx"),
            "DROP INDEX `users_email_idx` ON `app`.`users`;"
        );
        assert_eq!(
            DatabaseKind::Mysql.show_create_relation_query(Some("app"), "active_users", true),
            Some("SHOW CREATE VIEW `app`.`active_users`;".to_string())
        );
        assert_eq!(
            DatabaseKind::Postgres.add_unique_constraint_query(
                Some("public"),
                "users",
                "users_email_key",
                &["email".to_string()]
            ),
            r#"ALTER TABLE "public"."users" ADD CONSTRAINT "users_email_key" UNIQUE ("email");"#
        );
        assert_eq!(
            DatabaseKind::Postgres.add_primary_key_constraint_query(
                Some("public"),
                "users",
                "users_pkey",
                &["id".to_string()]
            ),
            r#"ALTER TABLE "public"."users" ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");"#
        );
        assert_eq!(
            DatabaseKind::Mysql.add_check_constraint_query(
                Some("app"),
                "orders",
                "orders_amount_check",
                "amount >= 0"
            ),
            "ALTER TABLE `app`.`orders` ADD CONSTRAINT `orders_amount_check` CHECK (amount >= 0);"
        );
        assert_eq!(
            DatabaseKind::Mysql.add_foreign_key_constraint_query(
                Some("app"),
                "orders",
                "orders_user_id_fkey",
                &["user_id".to_string()],
                Some("app"),
                "users",
                &["id".to_string()],
                Some("CASCADE"),
                Some("RESTRICT")
            ),
            "ALTER TABLE `app`.`orders` ADD CONSTRAINT `orders_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `app`.`users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT;"
        );
        assert_eq!(
            DatabaseKind::Postgres.drop_constraint_query(
                Some("public"),
                "orders",
                "orders_user_id_fkey",
                "FOREIGN KEY"
            ),
            r#"ALTER TABLE "public"."orders" DROP CONSTRAINT "orders_user_id_fkey";"#
        );
        assert_eq!(
            DatabaseKind::Mysql.drop_constraint_query(
                Some("app"),
                "orders",
                "orders_user_id_fkey",
                "FOREIGN KEY"
            ),
            "ALTER TABLE `app`.`orders` DROP FOREIGN KEY `orders_user_id_fkey`;"
        );
        assert_eq!(
            DatabaseKind::Mysql.drop_constraint_query(
                Some("app"),
                "users",
                "users_email_key",
                "UNIQUE"
            ),
            "ALTER TABLE `app`.`users` DROP INDEX `users_email_key`;"
        );
        assert_eq!(
            DatabaseKind::Mysql.drop_constraint_query(
                Some("app"),
                "users",
                "PRIMARY",
                "PRIMARY KEY"
            ),
            "ALTER TABLE `app`.`users` DROP PRIMARY KEY;"
        );
    }

    #[test]
    fn capabilities_describe_driver_differences() {
        assert_eq!(
            DatabaseKind::all(),
            &[DatabaseKind::Postgres, DatabaseKind::Mysql]
        );
        assert_eq!(DatabaseKind::Postgres.spec().driver, "postgres");
        assert_eq!(DatabaseKind::Mysql.spec().driver, "mysql");

        let postgres = DatabaseKind::Postgres.capabilities();
        assert_eq!(postgres.data_model, DatabaseDataModel::Relational);
        assert_eq!(postgres.namespace_label, "schema");
        assert_eq!(postgres.identifier_quote, "\"");
        assert_eq!(postgres.default_port, 5432);
        assert!(postgres.supports_sql_query);
        assert!(postgres.supports_table_browsing);
        assert!(!postgres.supports_collection_browsing);
        assert!(!postgres.supports_key_value_browsing);
        assert_eq!(
            postgres.display_name,
            DatabaseKind::Postgres.spec().display_name
        );
        assert_eq!(
            postgres.common_data_types,
            DatabaseKind::Postgres
                .spec()
                .common_data_types
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        );
        assert!(!postgres.supports_create_database_charset);
        assert!(postgres.supports_column_comments);
        assert!(!postgres.supports_inline_column_comments);
        assert!(postgres.supports_rename_database);
        assert!(postgres.supports_views);
        assert!(postgres.supports_replace_view);
        assert!(postgres.supports_materialized_views);
        assert!(postgres.supports_table_indexes);
        assert!(postgres.supports_table_constraints);
        assert!(postgres.supports_foreign_keys);
        assert!(postgres.supports_check_constraints);
        assert!(postgres.supports_functions);
        assert!(postgres.supports_transactions);
        assert!(postgres.supports_query_cancellation);
        assert_eq!(postgres.default_primary_key_type, "SERIAL");

        let mysql = DatabaseKind::Mysql.capabilities();
        assert_eq!(mysql.data_model, DatabaseDataModel::Relational);
        assert_eq!(mysql.namespace_label, "database");
        assert_eq!(mysql.identifier_quote, "`");
        assert_eq!(mysql.default_port, 3306);
        assert!(mysql.supports_sql_query);
        assert!(mysql.supports_table_browsing);
        assert!(!mysql.supports_collection_browsing);
        assert!(!mysql.supports_key_value_browsing);
        assert_eq!(mysql.display_name, DatabaseKind::Mysql.spec().display_name);
        assert_eq!(
            mysql.common_data_types,
            DatabaseKind::Mysql
                .spec()
                .common_data_types
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        );
        assert!(mysql.supports_create_database_charset);
        assert!(!mysql.supports_rename_database);
        assert!(mysql.supports_views);
        assert!(mysql.supports_replace_view);
        assert!(!mysql.supports_materialized_views);
        assert!(mysql.supports_table_indexes);
        assert!(mysql.supports_table_constraints);
        assert!(mysql.supports_foreign_keys);
        assert!(mysql.supports_check_constraints);
        assert!(mysql.supports_functions);
        assert!(mysql.supports_transactions);
        assert!(mysql.supports_query_cancellation);
        assert_eq!(
            mysql.auto_increment_keyword.as_deref(),
            Some("AUTO_INCREMENT")
        );
        assert!(mysql.supports_inline_column_comments);
        assert_eq!(mysql.default_primary_key_type, "INT");
    }

    #[test]
    fn redis_capabilities_describe_key_value_driver() {
        let redis = database_capabilities_for_driver("redis").unwrap();

        assert_eq!(redis.driver, "redis");
        assert_eq!(redis.display_name, "Redis");
        assert_eq!(redis.data_model, DatabaseDataModel::KeyValue);
        assert_eq!(redis.lsp_language_id, "redis");
        assert_eq!(redis.default_port, 6379);
        assert!(redis.supports_key_value_browsing);
        assert!(redis.supports_schemas);
        assert!(!redis.supports_sql_query);
        assert!(!redis.supports_table_browsing);
        assert!(!redis.supports_collection_browsing);
        assert!(!redis.supports_create_database);
        assert!(!redis.supports_transactions);
        assert!(all_database_capabilities()
            .iter()
            .any(|capabilities| capabilities.driver == "redis"));
    }

    #[test]
    fn elasticsearch_capabilities_describe_search_driver() {
        let elasticsearch = database_capabilities_for_driver("elastic").unwrap();

        assert_eq!(elasticsearch.driver, "elasticsearch");
        assert_eq!(elasticsearch.display_name, "Elasticsearch");
        assert_eq!(elasticsearch.data_model, DatabaseDataModel::Search);
        assert_eq!(elasticsearch.lsp_language_id, "elasticsearch-dsl");
        assert_eq!(elasticsearch.namespace_label, "index");
        assert_eq!(elasticsearch.default_port, 9200);
        assert!(elasticsearch.supports_collection_browsing);
        assert!(!elasticsearch.supports_schemas);
        assert!(!elasticsearch.supports_sql_query);
        assert!(!elasticsearch.supports_table_browsing);
        assert!(!elasticsearch.supports_key_value_browsing);
        assert!(!elasticsearch.supports_create_database);
        assert!(!elasticsearch.supports_transactions);
        assert!(all_database_capabilities()
            .iter()
            .any(|capabilities| capabilities.driver == "elasticsearch"));
    }

    #[test]
    fn mongodb_capabilities_describe_document_driver() {
        let mongodb = database_capabilities_for_driver("mongo").unwrap();

        assert_eq!(mongodb.driver, "mongodb");
        assert_eq!(mongodb.display_name, "MongoDB");
        assert_eq!(mongodb.data_model, DatabaseDataModel::Document);
        assert_eq!(mongodb.lsp_language_id, "mongodb");
        assert_eq!(mongodb.namespace_label, "database");
        assert_eq!(mongodb.default_port, 27017);
        assert!(mongodb.supports_collection_browsing);
        assert!(mongodb.supports_schemas);
        assert!(!mongodb.supports_sql_query);
        assert!(!mongodb.supports_table_browsing);
        assert!(!mongodb.supports_key_value_browsing);
        assert!(!mongodb.supports_create_database);
        assert!(!mongodb.supports_transactions);
        assert!(all_database_capabilities()
            .iter()
            .any(|capabilities| capabilities.driver == "mongodb"));
    }

    #[test]
    fn driver_specs_centralize_aliases_and_capability_listing() {
        assert_eq!(canonical_driver_name("postgresql"), Some("postgres"));
        assert_eq!(canonical_driver_name("pgsql"), Some("postgres"));
        assert_eq!(canonical_driver_name("mariadb"), Some("mysql"));
        assert_eq!(canonical_driver_name("elastic"), Some("elasticsearch"));
        assert_eq!(canonical_driver_name("mongo"), Some("mongodb"));
        assert_eq!(canonical_driver_name("unknown"), None);

        assert_eq!(
            database_capabilities_for_driver("POSTGRESQL")
                .unwrap()
                .driver,
            "postgres"
        );
        assert_eq!(
            database_capabilities_for_driver("elastic").unwrap().driver,
            "elasticsearch"
        );

        let drivers = all_database_capabilities()
            .into_iter()
            .map(|capabilities| capabilities.driver)
            .collect::<Vec<_>>();
        assert_eq!(
            drivers,
            vec!["postgres", "mysql", "elasticsearch", "mongodb", "redis"]
        );

        assert!(DatabaseKind::from_str("redis").is_err());
        assert_eq!(
            DatabaseKind::from_str("mariadb").unwrap(),
            DatabaseKind::Mysql
        );
    }

    #[test]
    fn paged_queries_include_where_limit_and_offset() {
        assert_eq!(
            DatabaseKind::Postgres.paged_table_query(
                Some("public"),
                "users",
                Some("id > 10"),
                50,
                100
            ),
            r#"SELECT * FROM "public"."users" WHERE id > 10 LIMIT 50 OFFSET 100;"#
        );
        assert_eq!(
            DatabaseKind::Mysql.count_table_query(Some("app"), "users", Some("WHERE active = 1")),
            "SELECT COUNT(*) FROM `app`.`users` WHERE active = 1;"
        );
    }

    #[test]
    fn paged_queries_include_safe_order_clause() {
        assert_eq!(
            DatabaseKind::Postgres.paged_table_query_with_order(
                Some("public"),
                "users",
                Some("active = true"),
                Some(r#""id" DESC"#),
                25,
                50
            ),
            r#"SELECT * FROM "public"."users" WHERE active = true ORDER BY "id" DESC LIMIT 25 OFFSET 50;"#
        );
    }
}
