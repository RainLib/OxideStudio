use super::{
    catalog::{database_spec_for_driver, MYSQL_SPEC, POSTGRES_SPEC},
    types::{DatabaseCapabilities, DatabaseSpec},
};
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::str::FromStr;

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
        // MySQL's editable-view path must use ALTER for an existing object.
        // CREATE OR REPLACE can recreate the view and lose properties owned by
        // the existing object; PostgreSQL's reviewed replacement grammar is
        // still CREATE OR REPLACE.
        let action = match (self, replace) {
            (Self::Mysql, true) => "ALTER",
            (Self::Postgres, true) => "CREATE OR REPLACE",
            (_, false) => "CREATE",
        };
        format!(
            "{action} VIEW {} AS\n{};",
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

pub(super) fn normalize_where_clause(where_clause: Option<&str>) -> String {
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

pub(super) fn normalize_order_clause(order_clause: Option<&str>) -> String {
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

pub(super) fn normalize_data_type(value: &str) -> String {
    value.trim().to_ascii_uppercase()
}

pub(super) fn base_data_type(value: &str) -> String {
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

pub(super) fn postgres_identity_clause_for_type(data_type: &str) -> Result<Option<&'static str>> {
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

pub(super) fn mysql_auto_increment_type(data_type: &str) -> bool {
    matches!(
        base_data_type(data_type).as_str(),
        "TINYINT" | "SMALLINT" | "MEDIUMINT" | "INT" | "INTEGER" | "BIGINT"
    )
}

pub(super) fn mysql_default_needs_quotes(data_type: &str) -> bool {
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

pub(super) fn postgres_cast_type(data_type: &str) -> Option<String> {
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

pub(super) fn postgres_type_expression_is_safe(data_type: &str) -> bool {
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

pub(super) fn sql_string_literal(value: &str) -> String {
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
