use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::dialect::DatabaseCapabilities;

const TEXT_TYPES: &[&str] = &[
    "char",
    "text",
    "clob",
    "varchar",
    "nvarchar",
    "nchar",
    "uuid",
    "uniqueidentifier",
    "enum",
];
const NUMBER_TYPES: &[&str] = &[
    "int", "serial", "number", "numeric", "decimal", "float", "double", "real", "money",
];
const SKIPPED_TYPES: &[&str] = &["blob", "binary", "bytea", "image", "geometry", "geography"];
const MAX_SEARCH_TERM_CHARS: usize = 512;
const MAX_SEARCH_COLUMNS: usize = 2_048;
const MAX_IDENTIFIER_CHARS: usize = 512;
const MAX_DATA_TYPE_CHARS: usize = 256;
const MAX_RESULT_LOCATOR_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseSearchColumn {
    pub name: String,
    pub data_type: String,
    #[serde(default)]
    pub is_primary_key: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseSearchSqlOptions {
    pub schema: Option<String>,
    pub table_name: String,
    #[serde(default)]
    pub columns: Vec<DatabaseSearchColumn>,
    pub term: String,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseSearchSql {
    pub sql: String,
    pub searchable_columns: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResultWhereOptions {
    #[serde(default)]
    pub columns: Vec<DatabaseSearchColumn>,
    #[serde(default)]
    pub result_columns: Vec<String>,
    #[serde(default)]
    pub row: Vec<Value>,
    #[serde(default)]
    pub matched_columns: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResultWhereBatchOptions {
    #[serde(default)]
    pub columns: Vec<DatabaseSearchColumn>,
    #[serde(default)]
    pub result_columns: Vec<String>,
    #[serde(default)]
    pub rows: Vec<Vec<Value>>,
    #[serde(default)]
    pub matched_columns: Vec<Vec<String>>,
}

fn valid_bounded_text(value: &str, max_chars: usize) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty()
        && trimmed.chars().count() <= max_chars
        && !trimmed.chars().any(char::is_control)
}

fn validate_columns(columns: &[DatabaseSearchColumn]) -> Result<(), String> {
    if columns.len() > MAX_SEARCH_COLUMNS {
        return Err(format!(
            "Database search supports at most {MAX_SEARCH_COLUMNS} columns per table"
        ));
    }
    if columns.iter().any(|column| {
        !valid_bounded_text(&column.name, MAX_IDENTIFIER_CHARS)
            || !valid_bounded_text(&column.data_type, MAX_DATA_TYPE_CHARS)
    }) {
        return Err("Database search received an invalid column descriptor".into());
    }
    Ok(())
}

pub fn validate_database_search_options(options: &DatabaseSearchSqlOptions) -> Result<(), String> {
    if !valid_bounded_text(&options.table_name, MAX_IDENTIFIER_CHARS)
        || !valid_bounded_text(&options.term, MAX_SEARCH_TERM_CHARS)
        || options
            .schema
            .as_deref()
            .is_some_and(|schema| !valid_bounded_text(schema, MAX_IDENTIFIER_CHARS))
    {
        return Err("Database search received an invalid table, schema, or search term".into());
    }
    validate_columns(&options.columns)
}

pub fn validate_search_result_where_options(
    options: &SearchResultWhereOptions,
) -> Result<(), String> {
    validate_columns(&options.columns)?;
    if options.result_columns.len() > MAX_SEARCH_COLUMNS
        || options
            .result_columns
            .iter()
            .any(|name| !valid_bounded_text(name, MAX_IDENTIFIER_CHARS))
    {
        return Err("Database search received invalid result columns".into());
    }
    let encoded = serde_json::to_vec(&options.row).map_err(|error| error.to_string())?;
    if encoded.len() > MAX_RESULT_LOCATOR_BYTES {
        return Err("Database search result locator exceeds the 8 MiB safety budget".into());
    }
    Ok(())
}

pub fn validate_search_result_batch_options(
    options: &SearchResultWhereBatchOptions,
) -> Result<(), String> {
    validate_columns(&options.columns)?;
    if options.rows.len() > 100 || options.rows.len() != options.matched_columns.len() {
        return Err(
            "Database search result locator batches must contain 100 or fewer aligned rows".into(),
        );
    }
    if options.result_columns.len() > MAX_SEARCH_COLUMNS
        || options
            .result_columns
            .iter()
            .any(|name| !valid_bounded_text(name, MAX_IDENTIFIER_CHARS))
    {
        return Err("Database search received invalid result columns".into());
    }
    let encoded = serde_json::to_vec(&options.rows).map_err(|error| error.to_string())?;
    if encoded.len() > MAX_RESULT_LOCATOR_BYTES {
        return Err("Database search result locator batch exceeds the 8 MiB safety budget".into());
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PaginationStyle {
    Limit,
    Top,
    First,
    Rows,
    FetchFirst,
    Rownum,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DatabaseSearchDialect {
    driver: String,
    effective_sql_dialect: String,
    identifier_quote: String,
    pagination: PaginationStyle,
}

impl DatabaseSearchDialect {
    pub fn from_connection(
        driver: &str,
        capabilities: &DatabaseCapabilities,
    ) -> Result<Self, String> {
        if !capabilities.supports_sql_query || !capabilities.supports_table_browsing {
            return Err(
                "Database search requires SQL query and table metadata capabilities".into(),
            );
        }
        let driver = driver.trim().to_ascii_lowercase();
        if driver.is_empty() {
            return Err("Database search requires a connected driver identity".into());
        }
        let identifier_quote = capabilities.identifier_quote.trim();
        if !matches!(identifier_quote, "\"" | "`" | "[") {
            return Err("Database search requires a reviewed identifier quote contract".into());
        }
        let effective_sql_dialect = capabilities
            .lsp_server_dialect
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(&capabilities.lsp_language_id)
            .trim()
            .to_ascii_lowercase();
        let dialect_family = effective_sql_dialect.as_str();
        let pagination = match (driver.as_str(), dialect_family) {
            ("sqlserver" | "iris", _) | (_, "sqlserver" | "tsql") => PaginationStyle::Top,
            ("informix", _) | (_, "informix") => PaginationStyle::First,
            ("firebird", _) | (_, "firebird") => PaginationStyle::Rows,
            ("db2" | "dameng", _) | (_, "db2" | "dameng") => PaginationStyle::FetchFirst,
            ("oracle" | "oceanbase-oracle" | "oscar" | "shentong" | "sundb", _)
            | (_, "oracle" | "plsql") => PaginationStyle::Rownum,
            _ => PaginationStyle::Limit,
        };
        Ok(Self {
            driver,
            effective_sql_dialect,
            identifier_quote: identifier_quote.to_string(),
            pagination,
        })
    }

    fn quote_identifier(&self, value: &str) -> String {
        if self.identifier_quote == "[" {
            return format!("[{}]", value.replace(']', "]]"));
        }
        let quote = self.identifier_quote.as_str();
        format!(
            "{quote}{}{quote}",
            value.replace(quote, &format!("{quote}{quote}"))
        )
    }

    fn qualified_table(&self, schema: Option<&str>, table: &str) -> String {
        match schema.map(str::trim).filter(|value| !value.is_empty()) {
            Some(schema) => format!(
                "{}.{}",
                self.quote_identifier(schema),
                self.quote_identifier(table)
            ),
            None => self.quote_identifier(table),
        }
    }

    fn text_cast_expression(&self, identifier: &str) -> String {
        if self.driver == "sqlserver"
            || matches!(self.effective_sql_dialect.as_str(), "sqlserver" | "tsql")
        {
            return format!("LOWER(CAST({identifier} AS NVARCHAR(MAX)))");
        }
        if matches!(
            self.driver.as_str(),
            "oracle" | "oceanbase-oracle" | "oscar" | "shentong" | "sundb"
        ) {
            return format!("LOWER(CAST({identifier} AS VARCHAR2(4000)))");
        }
        if self.driver == "clickhouse" || self.effective_sql_dialect == "clickhouse" {
            return format!("lower(toString({identifier}))");
        }
        if self.driver == "mysql" || self.effective_sql_dialect == "mysql" {
            return format!("LOWER(CAST({identifier} AS CHAR))");
        }
        format!("LOWER(CAST({identifier} AS TEXT))")
    }

    fn bounded_select(
        &self,
        projection: &str,
        table: &str,
        where_clause: &str,
        limit: usize,
    ) -> String {
        match self.pagination {
            PaginationStyle::Top => {
                format!("SELECT TOP {limit} {projection} FROM {table} WHERE ({where_clause})")
            }
            PaginationStyle::First => {
                format!("SELECT FIRST {limit} {projection} FROM {table} WHERE ({where_clause})")
            }
            PaginationStyle::Rows => {
                format!("SELECT {projection} FROM {table} WHERE ({where_clause}) ROWS {limit}")
            }
            PaginationStyle::FetchFirst => format!(
                "SELECT {projection} FROM {table} WHERE ({where_clause}) FETCH FIRST {limit} ROWS ONLY"
            ),
            PaginationStyle::Rownum => format!(
                "SELECT {projection} FROM (SELECT {projection} FROM {table} WHERE ({where_clause})) WHERE ROWNUM <= {limit}"
            ),
            PaginationStyle::Limit => {
                format!("SELECT {projection} FROM {table} WHERE ({where_clause}) LIMIT {limit};")
            }
        }
    }
}

pub fn is_text_search_column(column: &DatabaseSearchColumn) -> bool {
    let data_type = column.data_type.to_ascii_lowercase();
    !SKIPPED_TYPES
        .iter()
        .any(|skipped| data_type.contains(skipped))
        && TEXT_TYPES
            .iter()
            .any(|text_type| data_type.contains(text_type))
}

pub fn is_numeric_search_column(column: &DatabaseSearchColumn) -> bool {
    let data_type = column.data_type.to_ascii_lowercase();
    !SKIPPED_TYPES
        .iter()
        .any(|skipped| data_type.contains(skipped))
        && NUMBER_TYPES
            .iter()
            .any(|number_type| data_type.contains(number_type))
}

pub fn build_database_search_sql(
    dialect: &DatabaseSearchDialect,
    options: DatabaseSearchSqlOptions,
) -> Option<DatabaseSearchSql> {
    let term = options.term.trim();
    if term.is_empty() || options.table_name.trim().is_empty() {
        return None;
    }
    let numeric_term = parse_numeric_term(term);
    let text_columns = options
        .columns
        .iter()
        .filter(|column| is_text_search_column(column))
        .collect::<Vec<_>>();
    let numeric_columns = numeric_term
        .as_ref()
        .map(|_| {
            options
                .columns
                .iter()
                .filter(|column| is_numeric_search_column(column))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let mut conditions = Vec::with_capacity(text_columns.len() + numeric_columns.len());
    for column in &text_columns {
        let identifier = dialect.quote_identifier(&column.name);
        conditions.push(format!(
            "{} LIKE {} ESCAPE '~'",
            dialect.text_cast_expression(&identifier),
            sql_string_literal(&like_pattern(term))
        ));
    }
    if let Some(numeric_term) = numeric_term.as_deref() {
        for column in &numeric_columns {
            conditions.push(format!(
                "{} = {numeric_term}",
                dialect.quote_identifier(&column.name)
            ));
        }
    }
    if conditions.is_empty() {
        return None;
    }
    let searchable_columns = text_columns
        .iter()
        .chain(numeric_columns.iter())
        .map(|column| column.name.clone())
        .collect::<Vec<_>>();
    let mut selected_name_keys = std::collections::HashSet::new();
    let selected_names = options
        .columns
        .iter()
        .filter(|column| column.is_primary_key)
        .map(|column| column.name.as_str())
        .chain(searchable_columns.iter().map(String::as_str))
        .filter(|name| selected_name_keys.insert(name.to_ascii_lowercase()))
        .collect::<Vec<_>>();
    let projection = selected_names
        .into_iter()
        .map(|name| dialect.quote_identifier(name))
        .collect::<Vec<_>>()
        .join(", ");
    let table = dialect.qualified_table(options.schema.as_deref(), &options.table_name);
    let sql = dialect.bounded_select(
        &projection,
        &table,
        &conditions.join(" OR "),
        options.limit.unwrap_or(20).clamp(1, 100),
    );
    Some(DatabaseSearchSql {
        sql,
        searchable_columns,
    })
}

pub fn build_search_result_where(
    dialect: &DatabaseSearchDialect,
    options: SearchResultWhereOptions,
) -> String {
    let value_by_column = options
        .result_columns
        .iter()
        .enumerate()
        .filter_map(|(index, column)| {
            options
                .row
                .get(index)
                .map(|value| (column.to_ascii_lowercase(), value))
        })
        .collect::<HashMap<_, _>>();
    let primary_columns = options
        .columns
        .iter()
        .filter(|column| {
            column.is_primary_key && value_by_column.contains_key(&column.name.to_ascii_lowercase())
        })
        .collect::<Vec<_>>();
    let fallback_columns = options
        .columns
        .iter()
        .filter(|column| {
            options
                .matched_columns
                .iter()
                .any(|name| name.eq_ignore_ascii_case(&column.name))
                && value_by_column.contains_key(&column.name.to_ascii_lowercase())
        })
        .collect::<Vec<_>>();
    let selected_columns = if primary_columns.is_empty() {
        fallback_columns
    } else {
        primary_columns
    };

    selected_columns
        .into_iter()
        .take(3)
        .map(|column| {
            let identifier = dialect.quote_identifier(&column.name);
            let value = value_by_column
                .get(&column.name.to_ascii_lowercase())
                .copied()
                .unwrap_or(&Value::Null);
            if value.is_null() {
                format!("{identifier} IS NULL")
            } else {
                format!(
                    "{identifier} = {}",
                    sql_value_literal(dialect, column, value)
                )
            }
        })
        .collect::<Vec<_>>()
        .join(" AND ")
}

fn parse_numeric_term(term: &str) -> Option<String> {
    let trimmed = term.trim();
    let number = trimmed.strip_prefix(['+', '-']).unwrap_or(trimmed);
    let mut dots = 0;
    let mut digits = 0;
    for character in number.chars() {
        if character == '.' {
            dots += 1;
            if dots > 1 {
                return None;
            }
        } else if character.is_ascii_digit() {
            digits += 1;
        } else {
            return None;
        }
    }
    (digits > 0).then(|| trimmed.to_string())
}

fn like_pattern(term: &str) -> String {
    let mut pattern = String::from("%");
    for character in term.trim().to_lowercase().chars() {
        if matches!(character, '~' | '%' | '_') {
            pattern.push('~');
        }
        pattern.push(character);
    }
    pattern.push('%');
    pattern
}

fn sql_string_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn sql_value_literal(
    dialect: &DatabaseSearchDialect,
    column: &DatabaseSearchColumn,
    value: &Value,
) -> String {
    match value {
        Value::Null => "NULL".into(),
        Value::Number(value) => value.to_string(),
        Value::Bool(value) => {
            if matches!(dialect.effective_sql_dialect.as_str(), "sqlserver" | "tsql") {
                if *value {
                    "1".into()
                } else {
                    "0".into()
                }
            } else if *value {
                "TRUE".into()
            } else {
                "FALSE".into()
            }
        }
        Value::String(value)
            if is_numeric_search_column(column) && parse_numeric_term(value).is_some() =>
        {
            value.trim().to_string()
        }
        Value::String(value)
            if dialect.driver == "sqlserver"
                || matches!(dialect.effective_sql_dialect.as_str(), "sqlserver" | "tsql") =>
        {
            format!("N{}", sql_string_literal(value))
        }
        Value::String(value) => sql_string_literal(value),
        value => sql_string_literal(&value.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn column(name: &str, data_type: &str, is_primary_key: bool) -> DatabaseSearchColumn {
        DatabaseSearchColumn {
            name: name.into(),
            data_type: data_type.into(),
            is_primary_key,
        }
    }

    fn capabilities(driver: &str, dialect: &str, quote: &str) -> DatabaseCapabilities {
        let mut capabilities = super::super::dialect::database_capabilities_for_driver("postgres")
            .expect("postgres capabilities");
        capabilities.driver = driver.into();
        capabilities.lsp_language_id = dialect.into();
        capabilities.identifier_quote = quote.into();
        capabilities
    }

    #[test]
    fn builds_bounded_mysql_search_and_escapes_like_terms() {
        let dialect =
            DatabaseSearchDialect::from_connection("mysql", &capabilities("mysql", "mysql", "`"))
                .unwrap();
        let query = build_database_search_sql(
            &dialect,
            DatabaseSearchSqlOptions {
                schema: Some("app".into()),
                table_name: "users".into(),
                columns: vec![
                    column("id", "bigint", true),
                    column("email", "varchar", false),
                    column("avatar", "blob", false),
                ],
                term: "A_50%'".into(),
                limit: Some(500),
            },
        )
        .unwrap();
        assert_eq!(query.searchable_columns, vec!["email"]);
        assert_eq!(
            query.sql,
            "SELECT `id`, `email` FROM `app`.`users` WHERE (LOWER(CAST(`email` AS CHAR)) LIKE '%a~_50~%''%' ESCAPE '~') LIMIT 100;"
        );
    }

    #[test]
    fn adds_numeric_predicates_only_for_numeric_terms() {
        let capabilities = capabilities("postgres", "postgres", "\"");
        let dialect = DatabaseSearchDialect::from_connection("postgres", &capabilities).unwrap();
        let query = build_database_search_sql(
            &dialect,
            DatabaseSearchSqlOptions {
                schema: Some("public".into()),
                table_name: "orders".into(),
                columns: vec![column("id", "integer", true), column("note", "text", false)],
                term: "42".into(),
                limit: Some(10),
            },
        )
        .unwrap();
        assert!(query.sql.contains("\"id\" = 42"));
        assert!(query.sql.contains("FROM \"public\".\"orders\""));
    }

    #[test]
    fn uses_product_specific_limits_and_result_identity() {
        let capabilities = capabilities("sqlserver", "sqlserver", "[");
        let dialect = DatabaseSearchDialect::from_connection("sqlserver", &capabilities).unwrap();
        let query = build_database_search_sql(
            &dialect,
            DatabaseSearchSqlOptions {
                schema: Some("dbo".into()),
                table_name: "users".into(),
                columns: vec![column("name", "nvarchar", false)],
                term: "alice".into(),
                limit: Some(20),
            },
        )
        .unwrap();
        assert!(query.sql.starts_with("SELECT TOP 20"));
        assert!(query.sql.contains("NVARCHAR(MAX)"));

        let where_clause = build_search_result_where(
            &dialect,
            SearchResultWhereOptions {
                columns: vec![
                    column("id", "integer", true),
                    column("email", "varchar", false),
                ],
                result_columns: vec!["id".into(), "email".into()],
                row: vec![Value::from(42), Value::from("alice@example.com")],
                matched_columns: vec!["email".into()],
            },
        );
        assert_eq!(where_clause, "[id] = 42");
    }

    #[test]
    fn rejects_non_sql_capabilities_and_unsearchable_tables() {
        let mut mongodb_capabilities = capabilities("mongodb", "mongodb", "\"");
        mongodb_capabilities.supports_sql_query = false;
        assert!(DatabaseSearchDialect::from_connection("mongodb", &mongodb_capabilities).is_err());

        let capabilities = capabilities("sqlite", "sqlite", "\"");
        let dialect = DatabaseSearchDialect::from_connection("sqlite", &capabilities).unwrap();
        assert_eq!(
            build_database_search_sql(
                &dialect,
                DatabaseSearchSqlOptions {
                    schema: None,
                    table_name: "files".into(),
                    columns: vec![column("payload", "blob", false)],
                    term: "needle".into(),
                    limit: None,
                },
            ),
            None
        );
    }

    #[test]
    fn validates_untrusted_search_and_locator_bounds() {
        let oversized_term = "x".repeat(MAX_SEARCH_TERM_CHARS + 1);
        assert!(validate_database_search_options(&DatabaseSearchSqlOptions {
            schema: Some("public".into()),
            table_name: "users".into(),
            columns: vec![column("email", "text", false)],
            term: oversized_term,
            limit: Some(20),
        })
        .is_err());

        let rows = vec![vec![Value::from(1)]; 101];
        assert!(
            validate_search_result_batch_options(&SearchResultWhereBatchOptions {
                columns: vec![column("id", "integer", true)],
                result_columns: vec!["id".into()],
                matched_columns: vec![Vec::new(); rows.len()],
                rows,
            },)
            .is_err()
        );
    }
}
