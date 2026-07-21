use crate::core::{
    dialect::DatabaseKind,
    manager::ConnectionManager,
    protocol::{
        ColumnInfo, ConstraintInfo, IndexInfo, ParameterizedStatement, QueryParameter, QueryResult,
        Response,
    },
    statement::{validate_sql_filter_expression, StatementScanDialect},
};
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{
    collections::{BTreeMap, HashSet},
    fs::{create_dir_all, metadata, File},
    io::{BufReader, BufWriter, Read, Write},
    path::{Path, PathBuf},
    str::FromStr,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State};

const DEFAULT_PAGE_SIZE: u32 = 500;
const MAX_PAGE_SIZE: u32 = 5_000;
const MAX_IMPORT_FILE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_IMPORT_ROWS: usize = 100_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TablePageResult {
    pub result: QueryResult,
    pub page: u32,
    pub page_size: u32,
    pub total_rows: Option<u64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TableExportFormat {
    Csv,
    Json,
    Sql,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableExportResult {
    pub file_path: String,
    pub rows_exported: u64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TableImportFormat {
    Csv,
    Json,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableImportResult {
    pub file_path: String,
    pub rows_imported: u64,
    pub batches: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableRowUpdate {
    pub key: BTreeMap<String, Value>,
    pub values: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableRowDelete {
    pub key: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableMutationResult {
    pub inserted: u64,
    pub updated: u64,
    pub deleted: u64,
    pub rows_affected: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableFilter {
    pub column: String,
    pub operator: String,
    pub value: String,
    pub logic: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableSort {
    pub column: String,
    pub direction: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTableColumn {
    pub name: String,
    pub data_type: String,
    pub length: Option<String>,
    pub is_primary_key: bool,
    pub is_not_null: bool,
    pub is_auto_increment: bool,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AlterColumnValueMode {
    Keep,
    Set,
    Drop,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlterTableColumn {
    pub name: String,
    pub data_type: Option<String>,
    pub length: Option<String>,
    pub is_not_null: Option<bool>,
    pub default_mode: Option<AlterColumnValueMode>,
    pub default_value: Option<String>,
    pub comment_mode: Option<AlterColumnValueMode>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTableResult {
    pub table: String,
    pub statements: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateViewResult {
    pub view: String,
    pub statement: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMaterializedViewResult {
    pub view: String,
    pub statement: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableColumnChangeResult {
    pub table: String,
    pub column: String,
    pub statements: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableIndexChangeResult {
    pub table: String,
    pub index: String,
    pub statements: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableConstraintChangeResult {
    pub table: String,
    pub constraint: String,
    pub statements: Vec<String>,
}

fn schema_option(schema: &str) -> Option<&str> {
    let schema = schema.trim();
    if schema.is_empty() {
        None
    } else {
        Some(schema)
    }
}

fn validated_raw_filter_sql(
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

fn object_type_is_view(object_type: Option<&str>) -> bool {
    object_type
        .map(str::trim)
        .map(|value| value.to_ascii_uppercase())
        .is_some_and(|value| value.contains("VIEW"))
}

fn object_type_is_materialized_view(object_type: Option<&str>) -> bool {
    object_type
        .map(str::trim)
        .map(|value| value.to_ascii_uppercase())
        .is_some_and(|value| value.contains("MATERIALIZED") && value.contains("VIEW"))
}

fn object_type_is_foreign_table(object_type: Option<&str>) -> bool {
    object_type
        .map(str::trim)
        .map(|value| value.to_ascii_uppercase())
        .is_some_and(|value| value.contains("FOREIGN TABLE"))
}

fn object_label_from_type(object_type: Option<&str>) -> &'static str {
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
enum RelationOperation {
    DataMutation,
    Truncate,
    ColumnChange,
    IndexChange,
    ConstraintChange,
}

impl RelationOperation {
    fn description(self) -> &'static str {
        match self {
            Self::DataMutation => "Changing rows",
            Self::Truncate => "Truncating",
            Self::ColumnChange => "Changing columns",
            Self::IndexChange => "Changing indexes",
            Self::ConstraintChange => "Changing constraints",
        }
    }
}

fn relation_operation_allowed(operation: RelationOperation, object_type: Option<&str>) -> bool {
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

fn ensure_relation_operation_allowed(
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

fn value_to_string(value: &serde_json::Value) -> Option<String> {
    match value {
        serde_json::Value::String(value) => Some(value.clone()),
        serde_json::Value::Number(value) => Some(value.to_string()),
        serde_json::Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }
}

fn value_to_u64(value: &serde_json::Value) -> Option<u64> {
    match value {
        serde_json::Value::Number(value) => {
            value.as_u64().or_else(|| value.as_i64().map(|v| v as u64))
        }
        serde_json::Value::String(value) => value.parse::<u64>().ok(),
        _ => None,
    }
}

fn value_to_export_string(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(value) => value.clone(),
        Value::Number(value) => value.to_string(),
        Value::Bool(value) => value.to_string(),
        Value::Array(_) | Value::Object(_) => serde_json::to_string(value).unwrap_or_default(),
    }
}

fn csv_escape(value: &Value) -> String {
    let value = value_to_export_string(value);
    if value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value
    }
}

fn sanitize_file_part(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.') {
                ch
            } else {
                '_'
            }
        })
        .collect();
    let sanitized = sanitized.trim_matches('_');
    if sanitized.is_empty() {
        "table".to_string()
    } else {
        sanitized.to_string()
    }
}

fn export_file_path(
    app: &AppHandle,
    schema: &str,
    table: &str,
    format: TableExportFormat,
) -> Result<PathBuf, String> {
    let mut dir = app.path().download_dir().map_err(|e| e.to_string())?;
    create_dir_all(&dir).map_err(|e| e.to_string())?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    let extension = match format {
        TableExportFormat::Csv => "csv",
        TableExportFormat::Json => "json",
        TableExportFormat::Sql => "sql",
    };
    let schema = sanitize_file_part(schema);
    let table = sanitize_file_part(table);
    dir.push(format!("{schema}_{table}_{timestamp}.{extension}"));
    Ok(dir)
}

fn row_to_object(columns: &[String], row: &[Value]) -> Value {
    let mut object = Map::new();
    for (index, column) in columns.iter().enumerate() {
        object.insert(
            column.clone(),
            row.get(index).cloned().unwrap_or(Value::Null),
        );
    }
    Value::Object(object)
}

fn sql_export_literal(value: &Value) -> String {
    match value {
        Value::Null => "NULL".to_string(),
        Value::Bool(value) => {
            if *value {
                "TRUE".to_string()
            } else {
                "FALSE".to_string()
            }
        }
        Value::Number(value) => value.to_string(),
        Value::String(value) => sql_string_literal(value),
        Value::Array(_) | Value::Object(_) => {
            sql_string_literal(&serde_json::to_string(value).unwrap_or_default())
        }
    }
}

fn sql_insert_statement(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    columns: &[String],
    row: &[Value],
) -> String {
    let columns = columns
        .iter()
        .map(|column| kind.quote_identifier(column))
        .collect::<Vec<_>>()
        .join(", ");
    let values = row
        .iter()
        .map(sql_export_literal)
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "INSERT INTO {} ({columns}) VALUES ({values});",
        kind.qualified_table(schema_option(schema), table),
    )
}

fn sql_string_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn postgres_view_definition_query(kind: DatabaseKind, schema: &str, view: &str) -> String {
    let qualified = kind.qualified_table(schema_option(schema), view);
    format!(
        "SELECT pg_get_viewdef(to_regclass({}), true) AS definition;",
        sql_string_literal(&qualified)
    )
}

fn view_definition_query(kind: DatabaseKind, schema: &str, view: &str) -> String {
    match kind {
        DatabaseKind::Postgres => postgres_view_definition_query(kind, schema, view),
        DatabaseKind::Mysql => format!(
            "SELECT VIEW_DEFINITION AS definition FROM information_schema.VIEWS WHERE TABLE_SCHEMA = {} AND TABLE_NAME = {};",
            sql_string_literal(schema),
            sql_string_literal(view)
        ),
    }
}

fn generate_postgres_view_ddl(
    kind: DatabaseKind,
    schema: &str,
    view: &str,
    definition: &str,
) -> String {
    format!(
        "CREATE OR REPLACE VIEW {} AS\n{};",
        kind.qualified_table(schema_option(schema), view),
        definition.trim().trim_end_matches(';')
    )
}

fn generate_postgres_materialized_view_ddl(
    kind: DatabaseKind,
    schema: &str,
    view: &str,
    definition: &str,
) -> String {
    format!(
        "CREATE MATERIALIZED VIEW {} AS\n{};",
        kind.qualified_table(schema_option(schema), view),
        definition.trim().trim_end_matches(';')
    )
}

fn mysql_comment_literal(value: &str) -> String {
    format!("'{}'", value.replace('\\', "\\\\").replace('\'', "\\'"))
}

fn normalize_data_type(value: &str) -> String {
    value.trim().to_ascii_uppercase()
}

fn validate_column_length(value: &str) -> Result<(), String> {
    let value = value.trim();
    if value.is_empty() {
        return Ok(());
    }

    if value
        .chars()
        .all(|ch| ch.is_ascii_digit() || ch == ',' || ch.is_ascii_whitespace())
        && value.split(',').all(|part| !part.trim().is_empty())
    {
        Ok(())
    } else {
        Err(format!("Invalid column length: {value}"))
    }
}

fn render_column_type(column: &CreateTableColumn) -> Result<String, String> {
    let data_type = column.data_type.trim();
    if data_type.is_empty() {
        return Err(format!("Column {} has no data type", column.name));
    }

    let mut rendered = data_type.to_string();
    if let Some(length) = column
        .length
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        validate_column_length(length)?;
        let normalized = normalize_data_type(data_type);
        if matches!(
            normalized.as_str(),
            "VARCHAR" | "CHAR" | "DECIMAL" | "NUMERIC"
        ) {
            rendered.push('(');
            rendered.push_str(length);
            rendered.push(')');
        }
    }

    Ok(rendered)
}

fn render_table_column_definition(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    column: &CreateTableColumn,
    inline_primary_key: bool,
    comment_statements: &mut Vec<String>,
) -> Result<(String, String), String> {
    let column_name = column.name.trim();
    if column_name.is_empty() {
        return Err("All columns must have a name".to_string());
    }

    let data_type = normalize_data_type(&column.data_type);
    if !kind.supports_data_type(&data_type) {
        return Err(format!("Unsupported data type: {}", column.data_type));
    }

    let capabilities = kind.capabilities();
    let mut definition = format!(
        "{} {}",
        kind.quote_identifier(column_name),
        render_column_type(column)?
    );

    if column.is_auto_increment {
        if let Some(clause) = kind
            .auto_increment_clause_for_type(&data_type)
            .map_err(|err| err.to_string())?
        {
            definition.push(' ');
            definition.push_str(clause.trim());
        }
    }

    if column.is_not_null {
        definition.push_str(" NOT NULL");
    }

    if inline_primary_key && column.is_primary_key {
        definition.push_str(" PRIMARY KEY");
    }

    if let Some(comment) = column
        .comment
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if capabilities.supports_inline_column_comments {
            definition.push_str(" COMMENT ");
            definition.push_str(&mysql_comment_literal(comment));
        } else if capabilities.supports_column_comments {
            comment_statements.push(format!(
                "COMMENT ON COLUMN {}.{} IS {};",
                kind.qualified_table(schema_option(schema), table),
                kind.quote_identifier(column_name),
                sql_string_literal(comment)
            ));
        }
    }

    Ok((definition, column_name.to_string()))
}

fn build_create_table_statements(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    columns: &[CreateTableColumn],
) -> Result<Vec<String>, String> {
    let table = table.trim();
    if table.is_empty() {
        return Err("Table name is required".to_string());
    }
    if columns.is_empty() {
        return Err("At least one column is required".to_string());
    }

    let mut definitions = Vec::new();
    let mut primary_keys = Vec::new();
    let mut comment_statements = Vec::new();

    for column in columns {
        let (definition, column_name) = render_table_column_definition(
            kind,
            schema,
            table,
            column,
            false,
            &mut comment_statements,
        )?;
        if column.is_primary_key {
            primary_keys.push(column_name.to_string());
        }

        definitions.push(definition);
    }

    if !primary_keys.is_empty() {
        let quoted_keys = primary_keys
            .iter()
            .map(|column| kind.quote_identifier(column))
            .collect::<Vec<_>>()
            .join(", ");
        definitions.push(format!("PRIMARY KEY ({quoted_keys})"));
    }

    let create_statement = format!(
        "CREATE TABLE {} (\n  {}\n);",
        kind.qualified_table(schema_option(schema), table),
        definitions.join(",\n  ")
    );

    let mut statements = vec![create_statement];
    statements.extend(comment_statements);
    Ok(statements)
}

fn strip_leading_view_query_comments(mut sql: &str) -> Result<&str, String> {
    loop {
        let trimmed = sql.trim_start();
        if let Some(rest) = trimmed.strip_prefix("--") {
            if let Some(index) = rest.find('\n') {
                sql = &rest[index + 1..];
                continue;
            }
            return Ok("");
        }

        if let Some(rest) = trimmed.strip_prefix("/*") {
            if let Some(index) = rest.find("*/") {
                sql = &rest[index + 2..];
                continue;
            }
            return Err("View query has an unterminated block comment".to_string());
        }

        return Ok(trimmed);
    }
}

fn normalize_view_select_sql(sql: &str) -> Result<String, String> {
    let sql = sql.trim();
    if sql.is_empty() {
        return Err("View query is required".to_string());
    }

    let sql = sql.strip_suffix(';').unwrap_or(sql).trim();
    if sql.is_empty() {
        return Err("View query is required".to_string());
    }
    if sql.contains(';') {
        return Err("View query must be a single SELECT statement".to_string());
    }

    let body = strip_leading_view_query_comments(sql)?;
    let keyword: String = body
        .chars()
        .take_while(|ch| ch.is_ascii_alphabetic())
        .collect();
    match keyword.to_ascii_uppercase().as_str() {
        "SELECT" | "WITH" => Ok(sql.to_string()),
        _ => Err("View query must start with SELECT or WITH".to_string()),
    }
}

fn build_create_view_statement(
    kind: DatabaseKind,
    schema: &str,
    view: &str,
    select_sql: &str,
    replace: bool,
) -> Result<String, String> {
    let view = view.trim();
    if view.is_empty() {
        return Err("View name is required".to_string());
    }

    let select_sql = normalize_view_select_sql(select_sql)?;
    Ok(kind.create_view_query(schema_option(schema), view, &select_sql, replace))
}

fn build_create_materialized_view_statement(
    kind: DatabaseKind,
    schema: &str,
    view: &str,
    select_sql: &str,
    with_data: bool,
) -> Result<String, String> {
    let view = view.trim();
    if view.is_empty() {
        return Err("Materialized view name is required".to_string());
    }

    let select_sql = normalize_view_select_sql(select_sql)?;
    kind.create_materialized_view_query(schema_option(schema), view, &select_sql, with_data)
        .ok_or_else(|| "Materialized views are not supported by this driver".to_string())
}

fn build_add_table_column_statements(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    column: &CreateTableColumn,
) -> Result<Vec<String>, String> {
    let table = table.trim();
    if table.is_empty() {
        return Err("Table name is required".to_string());
    }

    let mut comment_statements = Vec::new();
    let (definition, _) =
        render_table_column_definition(kind, schema, table, column, true, &mut comment_statements)?;

    let mut statements = vec![format!(
        "ALTER TABLE {} ADD COLUMN {};",
        kind.qualified_table(schema_option(schema), table),
        definition
    )];
    statements.extend(comment_statements);
    Ok(statements)
}

fn build_drop_table_column_statement(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    column: &str,
    cascade: bool,
) -> Result<String, String> {
    let table = table.trim();
    if table.is_empty() {
        return Err("Table name is required".to_string());
    }

    let column = column.trim();
    if column.is_empty() {
        return Err("Column name is required".to_string());
    }

    Ok(kind.drop_column_query(schema_option(schema), table, column, cascade))
}

fn build_rename_table_column_statement(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    old_name: &str,
    new_name: &str,
    existing_columns: &BTreeMap<String, ColumnInfo>,
) -> Result<String, String> {
    let table = table.trim();
    if table.is_empty() {
        return Err("Table name is required".to_string());
    }

    let old_name = old_name.trim();
    let new_name = new_name.trim();
    if old_name.is_empty() || new_name.is_empty() {
        return Err("Column names are required".to_string());
    }
    if old_name == new_name {
        return Err("New column name must be different".to_string());
    }
    if !existing_columns.contains_key(old_name) {
        return Err(format!("Unknown column: {old_name}"));
    }
    if existing_columns.contains_key(new_name) {
        return Err(format!("Column already exists: {new_name}"));
    }

    Ok(kind.rename_column_query(schema_option(schema), table, old_name, new_name))
}

fn parse_data_type_input(value: &str) -> (String, Option<String>) {
    let value = value.trim();
    if let Some(start) = value.find('(') {
        if value.ends_with(')') && start + 1 < value.len() {
            let base = value[..start].trim().to_string();
            let length = value[start + 1..value.len() - 1].trim().to_string();
            return (base, (!length.is_empty()).then_some(length));
        }
    }

    (value.to_string(), None)
}

fn render_alter_column_type(
    kind: DatabaseKind,
    column_name: &str,
    data_type: Option<&str>,
    length: Option<&str>,
) -> Result<Option<String>, String> {
    let data_type = data_type.map(str::trim).filter(|value| !value.is_empty());
    let length = length.map(str::trim).filter(|value| !value.is_empty());

    let Some(data_type) = data_type else {
        if length.is_some() {
            return Err("Data type is required when length is changed".to_string());
        }
        return Ok(None);
    };

    let (base_type, inline_length) = parse_data_type_input(data_type);
    let base_type = base_type.trim();
    if base_type.is_empty() {
        return Err("Column data type is required".to_string());
    }
    if !kind.supports_data_type(base_type) {
        return Err(format!("Unsupported data type: {base_type}"));
    }

    let column = CreateTableColumn {
        name: column_name.to_string(),
        data_type: base_type.to_string(),
        length: length
            .map(ToString::to_string)
            .or(inline_length)
            .filter(|value| !value.trim().is_empty()),
        is_primary_key: false,
        is_not_null: false,
        is_auto_increment: false,
        comment: None,
    };

    render_column_type(&column).map(Some)
}

fn validate_default_expression(value: &str) -> Result<&str, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("Default value is required when default mode is set".to_string());
    }
    if value.contains(';') || value.contains("--") || value.contains("/*") || value.contains("*/") {
        return Err("Default value cannot contain statement separators or comments".to_string());
    }
    Ok(value)
}

fn build_alter_table_column_statements(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    changes: &AlterTableColumn,
    existing_columns: &BTreeMap<String, ColumnInfo>,
) -> Result<Vec<String>, String> {
    let table = table.trim();
    if table.is_empty() {
        return Err("Table name is required".to_string());
    }

    let column_name = changes.name.trim();
    if column_name.is_empty() {
        return Err("Column name is required".to_string());
    }

    let existing = column_for(existing_columns, column_name)?;
    if existing.is_primary_key && matches!(changes.is_not_null, Some(false)) {
        return Err("Primary key columns cannot be nullable".to_string());
    }
    if existing.is_auto_increment && changes.default_mode == Some(AlterColumnValueMode::Set) {
        return Err("Auto-increment columns cannot use an explicit default".to_string());
    }

    let requested_type = render_alter_column_type(
        kind,
        column_name,
        changes.data_type.as_deref(),
        changes.length.as_deref(),
    )?;
    let default_mode = changes.default_mode.unwrap_or(AlterColumnValueMode::Keep);
    let comment_mode = changes.comment_mode.unwrap_or(AlterColumnValueMode::Keep);
    let qualified_table = kind.qualified_table(schema_option(schema), table);
    let quoted_column = kind.quote_identifier(column_name);
    let mut statements = Vec::new();

    match kind {
        DatabaseKind::Postgres => {
            if let Some(data_type) = requested_type {
                statements.push(format!(
                    "ALTER TABLE {qualified_table} ALTER COLUMN {quoted_column} TYPE {data_type};"
                ));
            }

            if let Some(is_not_null) = changes.is_not_null {
                if is_not_null == existing.is_nullable {
                    let action = if is_not_null {
                        "SET NOT NULL"
                    } else {
                        "DROP NOT NULL"
                    };
                    statements.push(format!(
                        "ALTER TABLE {qualified_table} ALTER COLUMN {quoted_column} {action};"
                    ));
                }
            }

            match default_mode {
                AlterColumnValueMode::Keep => {}
                AlterColumnValueMode::Set => {
                    let default_value = validate_default_expression(
                        changes.default_value.as_deref().unwrap_or(""),
                    )?;
                    statements.push(format!(
                        "ALTER TABLE {qualified_table} ALTER COLUMN {quoted_column} SET DEFAULT {default_value};"
                    ));
                }
                AlterColumnValueMode::Drop => {
                    statements.push(format!(
                        "ALTER TABLE {qualified_table} ALTER COLUMN {quoted_column} DROP DEFAULT;"
                    ));
                }
            }

            match comment_mode {
                AlterColumnValueMode::Keep => {}
                AlterColumnValueMode::Set => {
                    statements.push(format!(
                        "COMMENT ON COLUMN {qualified_table}.{quoted_column} IS {};",
                        sql_string_literal(changes.comment.as_deref().unwrap_or(""))
                    ));
                }
                AlterColumnValueMode::Drop => {
                    statements.push(format!(
                        "COMMENT ON COLUMN {qualified_table}.{quoted_column} IS NULL;"
                    ));
                }
            }
        }
        DatabaseKind::Mysql => {
            let should_modify = requested_type.is_some()
                || changes.is_not_null.is_some()
                || default_mode != AlterColumnValueMode::Keep
                || comment_mode != AlterColumnValueMode::Keep;

            if should_modify {
                let data_type =
                    requested_type.unwrap_or_else(|| existing.data_type.trim().to_string());
                if data_type.trim().is_empty() {
                    return Err("Column data type is required".to_string());
                }

                let is_not_null = changes.is_not_null.unwrap_or(!existing.is_nullable);
                let mut definition = format!("{quoted_column} {data_type}");
                definition.push_str(if is_not_null { " NOT NULL" } else { " NULL" });

                if existing.is_auto_increment {
                    definition.push_str(" AUTO_INCREMENT");
                }

                let default_sql = match default_mode {
                    AlterColumnValueMode::Keep if !existing.is_auto_increment => existing
                        .default_value
                        .as_deref()
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(|value| kind.metadata_default_sql(&data_type, value)),
                    AlterColumnValueMode::Keep => None,
                    AlterColumnValueMode::Set => Some(
                        validate_default_expression(
                            changes.default_value.as_deref().unwrap_or(""),
                        )?
                        .to_string(),
                    ),
                    AlterColumnValueMode::Drop => None,
                };
                if let Some(default_sql) = default_sql {
                    definition.push_str(" DEFAULT ");
                    definition.push_str(&default_sql);
                }

                let comment = match comment_mode {
                    AlterColumnValueMode::Keep => existing.comment.as_deref(),
                    AlterColumnValueMode::Set => changes.comment.as_deref(),
                    AlterColumnValueMode::Drop => None,
                };
                if let Some(comment) = comment {
                    definition.push_str(" COMMENT ");
                    definition.push_str(&mysql_comment_literal(comment));
                }

                statements.push(format!(
                    "ALTER TABLE {qualified_table} MODIFY COLUMN {definition};"
                ));
            }
        }
    }

    if statements.is_empty() {
        Err("No column changes requested".to_string())
    } else {
        Ok(statements)
    }
}

fn build_create_table_index_statement(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    index: &str,
    columns: &[String],
    existing_columns: &BTreeMap<String, ColumnInfo>,
    unique: bool,
) -> Result<String, String> {
    let table = table.trim();
    if table.is_empty() {
        return Err("Table name is required".to_string());
    }

    let index = index.trim();
    if index.is_empty() {
        return Err("Index name is required".to_string());
    }

    let mut seen = HashSet::new();
    let mut validated_columns = Vec::new();
    for column in columns {
        let column = column.trim();
        if column.is_empty() {
            continue;
        }
        if !existing_columns.contains_key(column) {
            return Err(format!("Unknown column: {column}"));
        }
        if seen.insert(column.to_string()) {
            validated_columns.push(column.to_string());
        }
    }

    if validated_columns.is_empty() {
        return Err("At least one index column is required".to_string());
    }

    Ok(kind.create_index_query(
        schema_option(schema),
        table,
        index,
        &validated_columns,
        unique,
    ))
}

fn build_drop_table_index_statement(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    index: &str,
) -> Result<String, String> {
    let table = table.trim();
    if table.is_empty() {
        return Err("Table name is required".to_string());
    }

    let index = index.trim();
    if index.is_empty() {
        return Err("Index name is required".to_string());
    }
    if index.eq_ignore_ascii_case("PRIMARY") {
        return Err("Primary key indexes must be changed through constraints".to_string());
    }

    Ok(kind.drop_index_query(schema_option(schema), table, index))
}

fn build_rename_table_index_statement(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    old_name: &str,
    new_name: &str,
    existing_indexes: &[IndexInfo],
) -> Result<String, String> {
    let table = table.trim();
    if table.is_empty() {
        return Err("Table name is required".to_string());
    }

    let old_name = old_name.trim();
    let new_name = new_name.trim();
    if old_name.is_empty() || new_name.is_empty() {
        return Err("Index names are required".to_string());
    }
    if old_name == new_name {
        return Err("New index name must be different".to_string());
    }

    let old_index = existing_indexes
        .iter()
        .find(|index| index.name == old_name)
        .ok_or_else(|| format!("Unknown index: {old_name}"))?;
    if old_index.is_primary {
        return Err("Primary indexes are managed through constraints".to_string());
    }
    if existing_indexes.iter().any(|index| index.name == new_name) {
        return Err(format!("Index already exists: {new_name}"));
    }

    Ok(kind.rename_index_query(schema_option(schema), table, old_name, new_name))
}

fn validate_constraint_name(constraint: &str) -> Result<&str, String> {
    let constraint = constraint.trim();
    if constraint.is_empty() {
        Err("Constraint name is required".to_string())
    } else {
        Ok(constraint)
    }
}

fn validate_existing_columns(
    columns: &[String],
    existing_columns: &BTreeMap<String, ColumnInfo>,
) -> Result<Vec<String>, String> {
    let mut seen = HashSet::new();
    let mut validated = Vec::new();

    for column in columns {
        let column = column.trim();
        if column.is_empty() {
            continue;
        }
        if !existing_columns.contains_key(column) {
            return Err(format!("Unknown column: {column}"));
        }
        if seen.insert(column.to_string()) {
            validated.push(column.to_string());
        }
    }

    if validated.is_empty() {
        Err("At least one column is required".to_string())
    } else {
        Ok(validated)
    }
}

fn validate_referential_action(value: Option<&str>) -> Result<Option<String>, String> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let normalized = value.to_ascii_uppercase().replace('_', " ");
    match normalized.as_str() {
        "NO ACTION" | "RESTRICT" | "CASCADE" | "SET NULL" => Ok(Some(normalized)),
        _ => Err(format!("Unsupported referential action: {value}")),
    }
}

fn build_create_unique_constraint_statement(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    constraint: &str,
    columns: &[String],
    existing_columns: &BTreeMap<String, ColumnInfo>,
) -> Result<String, String> {
    let table = table.trim();
    if table.is_empty() {
        return Err("Table name is required".to_string());
    }
    let constraint = validate_constraint_name(constraint)?;
    let columns = validate_existing_columns(columns, existing_columns)?;

    Ok(kind.add_unique_constraint_query(schema_option(schema), table, constraint, &columns))
}

fn build_create_primary_key_statement(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    constraint: &str,
    columns: &[String],
    existing_columns: &BTreeMap<String, ColumnInfo>,
) -> Result<String, String> {
    let table = table.trim();
    if table.is_empty() {
        return Err("Table name is required".to_string());
    }
    let constraint = validate_constraint_name(constraint)?;
    let columns = validate_existing_columns(columns, existing_columns)?;

    for column in &columns {
        let column_info = column_for(existing_columns, column)?;
        if column_info.is_nullable {
            return Err(format!("Primary key column must be NOT NULL: {column}"));
        }
    }

    Ok(kind.add_primary_key_constraint_query(schema_option(schema), table, constraint, &columns))
}

fn validate_check_expression(expression: &str) -> Result<&str, String> {
    let expression = expression.trim();
    if expression.is_empty() {
        return Err("Check expression is required".to_string());
    }
    if expression.contains(';')
        || expression.contains("--")
        || expression.contains("/*")
        || expression.contains("*/")
    {
        return Err("Check expression cannot contain statement separators or comments".to_string());
    }
    Ok(expression)
}

fn build_create_check_constraint_statement(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    constraint: &str,
    expression: &str,
) -> Result<String, String> {
    let table = table.trim();
    if table.is_empty() {
        return Err("Table name is required".to_string());
    }
    let constraint = validate_constraint_name(constraint)?;
    let expression = validate_check_expression(expression)?;

    Ok(kind.add_check_constraint_query(schema_option(schema), table, constraint, expression))
}

#[allow(clippy::too_many_arguments)]
fn build_create_foreign_key_statement(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    constraint: &str,
    columns: &[String],
    existing_columns: &BTreeMap<String, ColumnInfo>,
    referenced_schema: &str,
    referenced_table: &str,
    referenced_columns: &[String],
    existing_referenced_columns: &BTreeMap<String, ColumnInfo>,
    on_delete: Option<&str>,
    on_update: Option<&str>,
) -> Result<String, String> {
    let table = table.trim();
    if table.is_empty() {
        return Err("Table name is required".to_string());
    }
    let referenced_table = referenced_table.trim();
    if referenced_table.is_empty() {
        return Err("Referenced table is required".to_string());
    }

    let constraint = validate_constraint_name(constraint)?;
    let columns = validate_existing_columns(columns, existing_columns)?;
    let referenced_columns =
        validate_existing_columns(referenced_columns, existing_referenced_columns)?;
    if columns.len() != referenced_columns.len() {
        return Err("Foreign key column count must match referenced column count".to_string());
    }

    let referenced_schema = referenced_schema.trim();
    let referenced_schema = if referenced_schema.is_empty() {
        schema_option(schema)
    } else {
        Some(referenced_schema)
    };
    let on_delete = validate_referential_action(on_delete)?;
    let on_update = validate_referential_action(on_update)?;

    Ok(kind.add_foreign_key_constraint_query(
        schema_option(schema),
        table,
        constraint,
        &columns,
        referenced_schema,
        referenced_table,
        &referenced_columns,
        on_delete.as_deref(),
        on_update.as_deref(),
    ))
}

fn build_drop_table_constraint_statement(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    constraint: &ConstraintInfo,
) -> Result<String, String> {
    let table = table.trim();
    if table.is_empty() {
        return Err("Table name is required".to_string());
    }
    let constraint_name = validate_constraint_name(&constraint.name)?;

    Ok(kind.drop_constraint_query(
        schema_option(schema),
        table,
        constraint_name,
        &constraint.constraint_type,
    ))
}

fn column_lookup(columns: Vec<ColumnInfo>) -> BTreeMap<String, ColumnInfo> {
    columns
        .into_iter()
        .map(|column| (column.name.clone(), column))
        .collect()
}

fn column_for<'a>(
    columns: &'a BTreeMap<String, ColumnInfo>,
    column: &str,
) -> Result<&'a ColumnInfo, String> {
    columns
        .get(column)
        .ok_or_else(|| format!("Unknown column: {column}"))
}

fn query_parameter(column: &ColumnInfo, value: &Value) -> QueryParameter {
    QueryParameter {
        value: value.clone(),
        data_type: Some(column.data_type.clone()),
    }
}

fn text_query_parameter(value: String) -> QueryParameter {
    QueryParameter {
        value: Value::String(value),
        data_type: Some("text".to_string()),
    }
}

fn escape_like_value(value: &str) -> String {
    let mut escaped = String::new();
    for ch in value.chars() {
        if matches!(ch, '=' | '%' | '_') {
            escaped.push('=');
        }
        escaped.push(ch);
    }
    escaped
}

fn build_structured_filter_where(
    kind: DatabaseKind,
    columns: &BTreeMap<String, ColumnInfo>,
    filters: &[TableFilter],
) -> Result<(String, Vec<QueryParameter>), String> {
    if filters.is_empty() {
        return Ok((String::new(), Vec::new()));
    }

    let mut predicates = Vec::new();
    let mut params = Vec::new();

    for filter in filters {
        let column_name = filter.column.trim();
        if column_name.is_empty() {
            return Err("Filter column is required".to_string());
        }

        let column = column_for(columns, column_name)?;
        let identifier = kind.quote_identifier(column_name);
        let logic = match filter.logic.as_deref() {
            Some(value) if value.eq_ignore_ascii_case("OR") => "OR",
            _ => "AND",
        };
        let prefix = if predicates.is_empty() {
            String::new()
        } else {
            format!("{logic} ")
        };

        let operator = filter.operator.trim();
        let predicate = match operator {
            "equals" => {
                let placeholder = kind.parameter_placeholder(params.len() + 1, &column.data_type);
                params.push(query_parameter(
                    column,
                    &Value::String(filter.value.clone()),
                ));
                format!("{prefix}{identifier} = {placeholder}")
            }
            ">" | "<" | ">=" | "<=" => {
                let placeholder = kind.parameter_placeholder(params.len() + 1, &column.data_type);
                params.push(query_parameter(
                    column,
                    &Value::String(filter.value.clone()),
                ));
                format!("{prefix}{identifier} {operator} {placeholder}")
            }
            "contains" | "startsWith" | "endsWith" => {
                let escaped = escape_like_value(&filter.value);
                let pattern = match operator {
                    "contains" => format!("%{escaped}%"),
                    "startsWith" => format!("{escaped}%"),
                    "endsWith" => format!("%{escaped}"),
                    _ => unreachable!(),
                };
                let placeholder = kind.parameter_placeholder(params.len() + 1, "text");
                params.push(text_query_parameter(pattern));
                format!(
                    "{prefix}{} LIKE {placeholder} ESCAPE '='",
                    kind.text_cast_expression(&identifier)
                )
            }
            _ => return Err(format!("Unsupported filter operator: {operator}")),
        };

        predicates.push(predicate);
    }

    Ok((predicates.join(" "), params))
}

fn build_table_order_by(
    kind: DatabaseKind,
    columns: &BTreeMap<String, ColumnInfo>,
    sort: Option<&TableSort>,
) -> Result<Option<String>, String> {
    let mut order = Vec::new();
    let mut requested_column = None;

    if let Some(sort) = sort {
        let column_name = sort.column.trim();
        if !column_name.is_empty() {
            column_for(columns, column_name)?;
            let direction = match sort.direction.trim().to_ascii_lowercase().as_str() {
                "asc" => Some("ASC"),
                "desc" => Some("DESC"),
                "" => None,
                other => return Err(format!("Unsupported sort direction: {other}")),
            };
            if let Some(direction) = direction {
                order.push(format!(
                    "{} {direction}",
                    kind.quote_identifier(column_name)
                ));
                requested_column = Some(column_name);
            }
        }
    }

    for column in columns.values().filter(|column| column.is_primary_key) {
        if requested_column == Some(column.name.as_str()) {
            continue;
        }
        order.push(format!("{} ASC", kind.quote_identifier(&column.name)));
    }

    Ok((!order.is_empty()).then(|| order.join(", ")))
}

fn build_insert_mutation(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    columns: &BTreeMap<String, ColumnInfo>,
    values: &BTreeMap<String, Value>,
) -> Result<(String, Vec<QueryParameter>), String> {
    if values.is_empty() {
        let table = kind.qualified_table(schema_option(schema), table);
        let sql = match kind {
            DatabaseKind::Postgres => format!("INSERT INTO {table} DEFAULT VALUES;"),
            DatabaseKind::Mysql => format!("INSERT INTO {table} () VALUES ();"),
        };
        return Ok((sql, Vec::new()));
    }

    let mut names = Vec::new();
    let mut placeholders = Vec::new();
    let mut params = Vec::new();

    for (column_name, value) in values {
        let column = column_for(columns, column_name)?;
        names.push(kind.quote_identifier(column_name));
        placeholders.push(kind.parameter_placeholder(params.len() + 1, &column.data_type));
        params.push(query_parameter(column, value));
    }

    let sql = format!(
        "INSERT INTO {} ({}) VALUES ({});",
        kind.qualified_table(schema_option(schema), table),
        names.join(", "),
        placeholders.join(", ")
    );
    Ok((sql, params))
}

fn build_update_mutation(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    columns: &BTreeMap<String, ColumnInfo>,
    update: &TableRowUpdate,
) -> Result<(String, Vec<QueryParameter>), String> {
    if update.values.is_empty() {
        return Err("Update row has no values".to_string());
    }
    if update.key.is_empty() {
        return Err("Update row has no key".to_string());
    }

    let mut params = Vec::new();
    let mut assignments = Vec::new();
    for (column_name, value) in &update.values {
        let column = column_for(columns, column_name)?;
        let placeholder = kind.parameter_placeholder(params.len() + 1, &column.data_type);
        assignments.push(format!(
            "{} = {}",
            kind.quote_identifier(column_name),
            placeholder
        ));
        params.push(query_parameter(column, value));
    }

    let where_clause = build_key_predicate(kind, columns, &update.key, &mut params)?;
    let sql = format!(
        "UPDATE {} SET {} WHERE {};",
        kind.qualified_table(schema_option(schema), table),
        assignments.join(", "),
        where_clause
    );
    Ok((sql, params))
}

fn build_delete_mutation(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    columns: &BTreeMap<String, ColumnInfo>,
    delete: &TableRowDelete,
) -> Result<(String, Vec<QueryParameter>), String> {
    if delete.key.is_empty() {
        return Err("Delete row has no key".to_string());
    }

    let mut params = Vec::new();
    let where_clause = build_key_predicate(kind, columns, &delete.key, &mut params)?;
    let sql = format!(
        "DELETE FROM {} WHERE {};",
        kind.qualified_table(schema_option(schema), table),
        where_clause
    );
    Ok((sql, params))
}

fn build_key_predicate(
    kind: DatabaseKind,
    columns: &BTreeMap<String, ColumnInfo>,
    key: &BTreeMap<String, Value>,
    params: &mut Vec<QueryParameter>,
) -> Result<String, String> {
    let mut predicates = Vec::new();

    for (column_name, value) in key {
        let column = column_for(columns, column_name)?;
        let identifier = kind.quote_identifier(column_name);
        if value.is_null() {
            predicates.push(format!("{identifier} IS NULL"));
        } else {
            let placeholder = kind.parameter_placeholder(params.len() + 1, &column.data_type);
            predicates.push(format!("{identifier} = {placeholder}"));
            params.push(query_parameter(column, value));
        }
    }

    if predicates.is_empty() {
        Err("Mutation key produced no predicates".to_string())
    } else {
        Ok(predicates.join(" AND "))
    }
}

fn summarize_mutation_affected(
    affected: &[u64],
    insert_count: usize,
    update_count: usize,
    delete_count: usize,
) -> TableMutationResult {
    let inserted: u64 = affected.iter().take(insert_count).sum();
    let updated: u64 = affected.iter().skip(insert_count).take(update_count).sum();
    let deleted: u64 = affected
        .iter()
        .skip(insert_count + update_count)
        .take(delete_count)
        .sum();

    TableMutationResult {
        inserted,
        updated,
        deleted,
        rows_affected: inserted + updated + deleted,
    }
}

fn postgres_column_definition(kind: DatabaseKind, column: &ColumnInfo) -> String {
    let mut definition = format!(
        "  {} {}",
        kind.quote_identifier(&column.name),
        column.data_type
    );

    if let Some(default_value) = &column.default_value {
        if !default_value.trim().is_empty() {
            definition.push_str(" DEFAULT ");
            definition.push_str(default_value);
        }
    }

    if !column.is_nullable {
        definition.push_str(" NOT NULL");
    }

    definition
}

fn postgres_constraint_definition(
    kind: DatabaseKind,
    constraint: &ConstraintInfo,
) -> Option<String> {
    let definition = constraint.definition.as_deref()?.trim();
    if definition.is_empty() {
        return None;
    }

    Some(format!(
        "  CONSTRAINT {} {}",
        kind.quote_identifier(&constraint.name),
        definition
    ))
}

fn generate_postgres_table_ddl(
    schema: &str,
    table: &str,
    columns: &[ColumnInfo],
    constraints: &[ConstraintInfo],
    indexes: &[IndexInfo],
) -> String {
    let kind = DatabaseKind::Postgres;
    let mut lines: Vec<String> = columns
        .iter()
        .map(|column| postgres_column_definition(kind, column))
        .collect();

    let constraint_names: std::collections::HashSet<&str> = constraints
        .iter()
        .map(|constraint| constraint.name.as_str())
        .collect();

    for constraint in constraints {
        if let Some(definition) = postgres_constraint_definition(kind, constraint) {
            lines.push(definition);
        }
    }

    if !constraints
        .iter()
        .any(|constraint| constraint.constraint_type == "PRIMARY KEY")
    {
        let primary_keys: Vec<String> = columns
            .iter()
            .filter(|column| column.is_primary_key)
            .map(|column| kind.quote_identifier(&column.name))
            .collect();

        if !primary_keys.is_empty() {
            lines.push(format!("  PRIMARY KEY ({})", primary_keys.join(", ")));
        }
    }

    let mut ddl = format!(
        "CREATE TABLE {} (\n{}\n);",
        kind.qualified_table(Some(schema), table),
        lines.join(",\n")
    );

    let extra_indexes: Vec<String> = indexes
        .iter()
        .filter(|index| !index.is_primary && !constraint_names.contains(index.name.as_str()))
        .filter_map(|index| index.definition.as_deref())
        .map(str::trim)
        .filter(|definition| !definition.is_empty())
        .map(ToString::to_string)
        .collect();

    if !extra_indexes.is_empty() {
        ddl.push_str("\n\n");
        ddl.push_str(&extra_indexes.join(";\n"));
        ddl.push(';');
    }

    ddl
}

async fn resolve_object_type(
    manager: &ConnectionManager,
    connection_id: &str,
    schema: &str,
    object_name: &str,
    object_type: Option<String>,
) -> Result<Option<String>, String> {
    if let Some(object_type) = object_type
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        return Ok(Some(object_type));
    }

    let object_name = object_name.trim();
    if object_name.is_empty() {
        return Ok(None);
    }

    let tables = manager
        .get_tables(connection_id, schema)
        .await
        .map_err(|e| e.to_string())?;

    Ok(tables
        .into_iter()
        .find(|table| table.name == object_name)
        .and_then(|table| table.table_type))
}

async fn ensure_resolved_relation_operation_allowed(
    manager: &ConnectionManager,
    connection_id: &str,
    schema: &str,
    object_name: &str,
    operation: RelationOperation,
) -> Result<Option<String>, String> {
    let object_type =
        resolve_object_type(manager, connection_id, schema, object_name, None).await?;
    ensure_relation_operation_allowed(object_name, object_type.as_deref(), operation)?;
    Ok(object_type)
}

async fn ensure_target_relation_operation_allowed(
    manager: &ConnectionManager,
    connection_id: &str,
    database: Option<&str>,
    schema: &str,
    object_name: &str,
    operation: RelationOperation,
) -> Result<Option<String>, String> {
    if let Some(database) = database {
        let object_type = manager
            .get_database_tables(connection_id, database, schema)
            .await
            .map_err(|error| error.to_string())?
            .into_iter()
            .find(|table| table.name == object_name)
            .and_then(|table| table.table_type);
        ensure_relation_operation_allowed(object_name, object_type.as_deref(), operation)?;
        return Ok(object_type);
    }

    ensure_resolved_relation_operation_allowed(
        manager,
        connection_id,
        schema,
        object_name,
        operation,
    )
    .await
}

async fn get_target_columns(
    manager: &ConnectionManager,
    connection_id: &str,
    database: Option<&str>,
    schema: &str,
    table: &str,
) -> Result<Vec<ColumnInfo>, anyhow::Error> {
    match database {
        Some(database) => {
            manager
                .get_database_columns(connection_id, database, schema, table)
                .await
        }
        None => manager.get_columns(connection_id, schema, table).await,
    }
}

async fn query_target(
    manager: &ConnectionManager,
    connection_id: &str,
    database: Option<&str>,
    sql: &str,
) -> Result<Vec<QueryResult>, anyhow::Error> {
    match database {
        Some(database) => manager.query_database(connection_id, database, sql).await,
        None => manager.query(connection_id, sql, None, None, None).await,
    }
}

async fn query_target_parameterized(
    manager: &ConnectionManager,
    connection_id: &str,
    database: Option<&str>,
    sql: &str,
    params: &[QueryParameter],
) -> Result<Vec<QueryResult>, anyhow::Error> {
    match database {
        Some(database) => {
            manager
                .query_database_parameterized(connection_id, database, sql, params)
                .await
        }
        None => {
            manager
                .query_parameterized(connection_id, sql, params)
                .await
        }
    }
}

async fn execute_target_parameterized_batch(
    manager: &ConnectionManager,
    connection_id: &str,
    database: Option<&str>,
    statements: &[ParameterizedStatement],
) -> Result<Vec<u64>, anyhow::Error> {
    match database {
        Some(database) => {
            manager
                .execute_database_parameterized_batch(connection_id, database, statements)
                .await
        }
        None => {
            manager
                .execute_parameterized_batch(connection_id, statements)
                .await
        }
    }
}

fn preview_metadata_required(
    structured_filters: Option<&[TableFilter]>,
    requested_sort: Option<&TableSort>,
) -> bool {
    structured_filters.is_some() || requested_sort.is_some()
}

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
) -> Result<Response<TablePageResult>, String> {
    let error_context = serde_json::json!({
        "connectionId": connection_id,
        "driver": driver,
        "database": database,
        "schema": schema,
        "table": table,
        "page": page,
        "pageSize": page_size,
    });
    let result: Result<TablePageResult, String> = async {
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        let database = database.as_deref();
        let page = page.unwrap_or(0);
        let page_size = page_size
            .unwrap_or(DEFAULT_PAGE_SIZE)
            .clamp(1, MAX_PAGE_SIZE);
        let offset = page as u64 * page_size as u64;
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

            let count_sql = kind.count_table_query(schema_option(&schema), &table, filter);
            let total_rows =
                query_target_parameterized(&manager, &connection_id, database, &count_sql, &params)
                    .await
                    .ok()
                    .and_then(|results| results.first().cloned())
                    .and_then(|result| result.rows.first().cloned())
                    .and_then(|row| row.first().cloned())
                    .and_then(|value| value_to_u64(&value));

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
            let filter = validated_filter.as_deref();

            let count_sql = kind.count_table_query(schema_option(&schema), &table, filter);
            let total_rows = query_target(&manager, &connection_id, database, &count_sql)
                .await
                .ok()
                .and_then(|results| results.first().cloned())
                .and_then(|result| result.rows.first().cloned())
                .and_then(|row| row.first().cloned())
                .and_then(|value| value_to_u64(&value));

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
pub async fn export_table_data(
    app: AppHandle,
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    format: TableExportFormat,
    filter_sql: Option<String>,
    filters: Option<Vec<TableFilter>>,
    sort: Option<TableSort>,
    page_size: Option<u32>,
    max_rows: Option<u64>,
) -> Result<Response<TableExportResult>, String> {
    let result: Result<TableExportResult, String> = async {
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        let page_size = page_size
            .unwrap_or(DEFAULT_PAGE_SIZE)
            .clamp(1, MAX_PAGE_SIZE);
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
        let metadata_required = structured_filters.is_some() || requested_sort.is_some();
        let columns_metadata = match manager.get_columns(&connection_id, &schema, &table).await {
            Ok(columns) => Some(column_lookup(columns)),
            Err(error) if metadata_required => return Err(error.to_string()),
            Err(_) => None,
        };
        let order_clause = if let Some(columns) = columns_metadata.as_ref() {
            build_table_order_by(kind, columns, requested_sort)?
        } else {
            None
        };
        let order = order_clause.as_deref();
        let (filter_clause, params, use_parameterized_query) = if let Some(filters) =
            structured_filters
        {
            let columns = columns_metadata
                .as_ref()
                .ok_or_else(|| "Missing column metadata".to_string())?;
            let (where_clause, params) = build_structured_filter_where(kind, columns, &filters)?;
            let filter_clause = if where_clause.is_empty() {
                None
            } else {
                Some(where_clause)
            };
            (filter_clause, params, true)
        } else {
            (
                validated_raw_filter_sql(kind, filter_sql.as_deref())?,
                Vec::new(),
                false,
            )
        };
        let filter = filter_clause.as_deref();
        let file_path = export_file_path(&app, &schema, &table, format)?;
        let file = File::create(&file_path).map_err(|e| e.to_string())?;
        let mut writer = BufWriter::new(file);

        let mut offset = 0_u64;
        let mut rows_exported = 0_u64;
        let mut columns: Vec<String> = Vec::new();
        let mut wrote_json_row = false;
        let mut wrote_csv_header = false;

        if matches!(format, TableExportFormat::Json) {
            writer.write_all(b"[").map_err(|e| e.to_string())?;
        } else if matches!(format, TableExportFormat::Sql) {
            writeln!(
                writer,
                "-- OxideStudio data export for {}",
                kind.qualified_table(schema_option(&schema), &table)
            )
            .map_err(|e| e.to_string())?;
        }

        loop {
            let limit = match max_rows {
                Some(max_rows) => {
                    let remaining = max_rows.saturating_sub(rows_exported);
                    if remaining == 0 {
                        break;
                    }
                    (page_size as u64).min(remaining) as u32
                }
                None => page_size,
            };

            let page_sql = kind.paged_table_query_with_order(
                schema_option(&schema),
                &table,
                filter,
                order,
                limit,
                offset,
            );
            let mut results = if use_parameterized_query {
                manager
                    .query_parameterized(&connection_id, &page_sql, &params)
                    .await
                    .map_err(|e| e.to_string())?
            } else {
                manager
                    .query(&connection_id, &page_sql, None, None, None)
                    .await
                    .map_err(|e| e.to_string())?
            };
            let result = results
                .drain(..)
                .next()
                .unwrap_or_else(|| QueryResult::rows(Vec::new(), Vec::new()));

            if columns.is_empty() {
                columns = result
                    .columns
                    .iter()
                    .map(|column| column.name.clone())
                    .collect();
            }

            if matches!(format, TableExportFormat::Csv) && !wrote_csv_header {
                let header = columns
                    .iter()
                    .map(|column| csv_escape(&Value::String(column.clone())))
                    .collect::<Vec<_>>()
                    .join(",");
                writeln!(writer, "{header}").map_err(|e| e.to_string())?;
                wrote_csv_header = true;
            }

            if result.rows.is_empty() {
                break;
            }

            for row in &result.rows {
                match format {
                    TableExportFormat::Csv => {
                        let line = row.iter().map(csv_escape).collect::<Vec<_>>().join(",");
                        writeln!(writer, "{line}").map_err(|e| e.to_string())?;
                    }
                    TableExportFormat::Json => {
                        if wrote_json_row {
                            writer.write_all(b",").map_err(|e| e.to_string())?;
                        }
                        let object = row_to_object(&columns, row);
                        serde_json::to_writer(&mut writer, &object).map_err(|e| e.to_string())?;
                        wrote_json_row = true;
                    }
                    TableExportFormat::Sql => {
                        writeln!(
                            writer,
                            "{}",
                            sql_insert_statement(kind, &schema, &table, &columns, row)
                        )
                        .map_err(|e| e.to_string())?;
                    }
                }
            }

            let page_rows = result.rows.len() as u64;
            rows_exported += page_rows;
            offset += page_rows;

            if page_rows < limit as u64 {
                break;
            }
        }

        if matches!(format, TableExportFormat::Json) {
            writer.write_all(b"]").map_err(|e| e.to_string())?;
        }
        writer.flush().map_err(|e| e.to_string())?;

        Ok(TableExportResult {
            file_path: file_path.display().to_string(),
            rows_exported,
        })
    }
    .await;

    match result {
        Ok(export) => Ok(Response::ok(export)),
        Err(error) => Ok(Response::err("EXPORT_TABLE_DATA_ERROR", &error)),
    }
}

fn validate_import_file(path: &Path, format: TableImportFormat) -> Result<(), String> {
    let file_metadata = metadata(path).map_err(|error| error.to_string())?;
    if !file_metadata.is_file() {
        return Err("The selected import path is not a file".to_string());
    }
    if file_metadata.len() > MAX_IMPORT_FILE_BYTES {
        return Err(format!(
            "Import files are limited to {} MB",
            MAX_IMPORT_FILE_BYTES / 1024 / 1024
        ));
    }

    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let accepted = match format {
        TableImportFormat::Csv => extension == "csv",
        TableImportFormat::Json => matches!(extension.as_str(), "json" | "jsonl" | "ndjson"),
    };
    if accepted {
        Ok(())
    } else {
        Err(format!(
            "The selected file does not match the {format:?} format"
        ))
    }
}

fn canonical_import_columns(
    headers: &[String],
    columns: &BTreeMap<String, ColumnInfo>,
) -> Result<Vec<String>, String> {
    if headers.is_empty() {
        return Err("The import file does not contain any columns".to_string());
    }
    let mut seen = HashSet::new();
    let mut canonical = Vec::with_capacity(headers.len());
    for header in headers {
        let header = header.trim();
        if header.is_empty() {
            return Err("Import column names cannot be empty".to_string());
        }
        let column_name = if columns.contains_key(header) {
            header.to_string()
        } else {
            let matches = columns
                .keys()
                .filter(|column| column.eq_ignore_ascii_case(header))
                .collect::<Vec<_>>();
            match matches.as_slice() {
                [column] => (*column).clone(),
                [] => return Err(format!("Import file contains unknown column: {header}")),
                _ => {
                    return Err(format!(
                        "Import column {header} matches more than one table column"
                    ));
                }
            }
        };
        if !seen.insert(column_name.clone()) {
            return Err(format!(
                "Import file contains duplicate column: {column_name}"
            ));
        }
        canonical.push(column_name);
    }
    Ok(canonical)
}

#[allow(clippy::too_many_arguments)]
async fn execute_import_batch(
    manager: &ConnectionManager,
    connection_id: &str,
    database: Option<&str>,
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    columns: &BTreeMap<String, ColumnInfo>,
    rows: &mut Vec<BTreeMap<String, Value>>,
) -> Result<u64, String> {
    if rows.is_empty() {
        return Ok(0);
    }
    let statements = rows
        .iter()
        .map(|row| {
            build_insert_mutation(kind, schema, table, columns, row)
                .map(|(sql, params)| ParameterizedStatement { sql, params })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let imported = execute_target_parameterized_batch(manager, connection_id, database, &statements)
        .await
        .map_err(|error| error.to_string())?
        .len() as u64;
    rows.clear();
    Ok(imported)
}

fn json_import_rows(path: &Path) -> Result<Vec<BTreeMap<String, Value>>, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut reader = BufReader::new(file);
    let mut source = String::new();
    reader
        .read_to_string(&mut source)
        .map_err(|error| error.to_string())?;

    let values = match serde_json::from_str::<Value>(&source) {
        Ok(Value::Array(values)) => values,
        Ok(Value::Object(object)) => vec![Value::Object(object)],
        Ok(_) => {
            return Err("JSON import expects an object or an array of objects".to_string());
        }
        Err(_) => source
            .lines()
            .enumerate()
            .filter(|(_, line)| !line.trim().is_empty())
            .map(|(index, line)| {
                serde_json::from_str::<Value>(line)
                    .map_err(|error| format!("Invalid JSON object on line {}: {error}", index + 1))
            })
            .collect::<Result<Vec<_>, _>>()?,
    };

    values
        .into_iter()
        .enumerate()
        .map(|(index, value)| match value {
            Value::Object(object) => Ok(object.into_iter().collect()),
            _ => Err(format!("JSON row {} is not an object", index + 1)),
        })
        .collect()
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn import_table_data(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    database: Option<String>,
    file_path: String,
    format: TableImportFormat,
    first_row_header: Option<bool>,
) -> Result<Response<TableImportResult>, String> {
    let result: Result<TableImportResult, String> = async {
        let kind = DatabaseKind::from_str(&driver).map_err(|error| error.to_string())?;
        let path = PathBuf::from(file_path.trim());
        validate_import_file(&path, format)?;
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
        let table_columns = get_target_columns(&manager, &connection_id, database, &schema, &table)
            .await
            .map_err(|error| error.to_string())?;
        let ordered_columns = table_columns
            .iter()
            .map(|column| column.name.clone())
            .collect::<Vec<_>>();
        let column_lookup = column_lookup(table_columns);
        let mut pending_rows = Vec::new();

        match format {
            TableImportFormat::Csv => {
                let has_headers = first_row_header.unwrap_or(true);
                let mut reader = csv::ReaderBuilder::new()
                    .has_headers(has_headers)
                    .from_path(&path)
                    .map_err(|error| error.to_string())?;
                let headers = if has_headers {
                    reader
                        .headers()
                        .map_err(|error| error.to_string())?
                        .iter()
                        .map(|value| value.trim().to_string())
                        .collect::<Vec<_>>()
                } else {
                    ordered_columns
                };
                let headers = canonical_import_columns(&headers, &column_lookup)?;

                for record in reader.records() {
                    let record = record.map_err(|error| error.to_string())?;
                    if record.len() != headers.len() {
                        return Err(format!(
                            "CSV row has {} values but {} columns were expected",
                            record.len(),
                            headers.len()
                        ));
                    }
                    pending_rows.push(
                        headers
                            .iter()
                            .zip(record.iter())
                            .map(|(column, value)| {
                                (column.clone(), Value::String(value.to_string()))
                            })
                            .collect(),
                    );
                    if pending_rows.len() > MAX_IMPORT_ROWS {
                        return Err(format!(
                            "Imports are limited to {MAX_IMPORT_ROWS} rows per transaction"
                        ));
                    }
                }
            }
            TableImportFormat::Json => {
                for row in json_import_rows(&path)? {
                    let headers = row.keys().cloned().collect::<Vec<_>>();
                    let canonical_headers = canonical_import_columns(&headers, &column_lookup)?;
                    pending_rows.push(
                        headers
                            .into_iter()
                            .zip(canonical_headers)
                            .filter_map(|(source, target)| {
                                row.get(&source).cloned().map(|value| (target, value))
                            })
                            .collect(),
                    );
                    if pending_rows.len() > MAX_IMPORT_ROWS {
                        return Err(format!(
                            "Imports are limited to {MAX_IMPORT_ROWS} rows per transaction"
                        ));
                    }
                }
            }
        }

        let rows_imported = if pending_rows.is_empty() {
            0
        } else {
            execute_import_batch(
                &manager,
                &connection_id,
                database,
                kind,
                &schema,
                &table,
                &column_lookup,
                &mut pending_rows,
            )
            .await?
        };

        Ok(TableImportResult {
            file_path: path.display().to_string(),
            rows_imported,
            batches: u64::from(rows_imported > 0),
        })
    }
    .await;

    match result {
        Ok(imported) => Ok(Response::ok(imported)),
        Err(error) => Ok(Response::err("IMPORT_TABLE_DATA_ERROR", &error)),
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
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
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

#[tauri::command]
pub async fn create_table(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    columns: Vec<CreateTableColumn>,
) -> Result<Response<CreateTableResult>, String> {
    let result: Result<CreateTableResult, String> = async {
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        let statements = build_create_table_statements(kind, &schema, &table, &columns)?;

        for statement in &statements {
            manager
                .query(&connection_id, statement, None, None, None)
                .await
                .map_err(|e| e.to_string())?;
        }

        Ok(CreateTableResult {
            table: table.trim().to_string(),
            statements,
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("CREATE_TABLE_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn create_view(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    view: String,
    select_sql: String,
    replace: Option<bool>,
) -> Result<Response<CreateViewResult>, String> {
    let result: Result<CreateViewResult, String> = async {
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        let statement = build_create_view_statement(
            kind,
            &schema,
            &view,
            &select_sql,
            replace.unwrap_or(false),
        )?;

        manager
            .query(&connection_id, &statement, None, None, None)
            .await
            .map_err(|e| e.to_string())?;

        Ok(CreateViewResult {
            view: view.trim().to_string(),
            statement,
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("CREATE_VIEW_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn create_materialized_view(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    view: String,
    select_sql: String,
    with_data: Option<bool>,
) -> Result<Response<CreateMaterializedViewResult>, String> {
    let result: Result<CreateMaterializedViewResult, String> = async {
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        let statement = build_create_materialized_view_statement(
            kind,
            &schema,
            &view,
            &select_sql,
            with_data.unwrap_or(true),
        )?;

        manager
            .query(&connection_id, &statement, None, None, None)
            .await
            .map_err(|e| e.to_string())?;

        Ok(CreateMaterializedViewResult {
            view: view.trim().to_string(),
            statement,
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("CREATE_MATERIALIZED_VIEW_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn add_table_column(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    column: CreateTableColumn,
) -> Result<Response<TableColumnChangeResult>, String> {
    let result: Result<TableColumnChangeResult, String> = async {
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::ColumnChange,
        )
        .await?;
        let statements = build_add_table_column_statements(kind, &schema, &table, &column)?;

        for statement in &statements {
            manager
                .query(&connection_id, statement, None, None, None)
                .await
                .map_err(|e| e.to_string())?;
        }

        Ok(TableColumnChangeResult {
            table: table.trim().to_string(),
            column: column.name.trim().to_string(),
            statements,
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("ADD_TABLE_COLUMN_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn drop_table_column(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    column: String,
    cascade: Option<bool>,
) -> Result<Response<TableColumnChangeResult>, String> {
    let result: Result<TableColumnChangeResult, String> = async {
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::ColumnChange,
        )
        .await?;
        let cascade = cascade.unwrap_or(false);
        let statement = build_drop_table_column_statement(kind, &schema, &table, &column, cascade)?;

        manager
            .query(&connection_id, &statement, None, None, None)
            .await
            .map_err(|e| e.to_string())?;

        Ok(TableColumnChangeResult {
            table: table.trim().to_string(),
            column: column.trim().to_string(),
            statements: vec![statement],
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("DROP_TABLE_COLUMN_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn rename_table_column(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    old_name: String,
    new_name: String,
) -> Result<Response<TableColumnChangeResult>, String> {
    let result: Result<TableColumnChangeResult, String> = async {
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::ColumnChange,
        )
        .await?;
        let existing_columns = manager
            .get_columns(&connection_id, &schema, &table)
            .await
            .map(column_lookup)
            .map_err(|e| e.to_string())?;
        let statement = build_rename_table_column_statement(
            kind,
            &schema,
            &table,
            &old_name,
            &new_name,
            &existing_columns,
        )?;

        manager
            .query(&connection_id, &statement, None, None, None)
            .await
            .map_err(|e| e.to_string())?;

        Ok(TableColumnChangeResult {
            table: table.trim().to_string(),
            column: new_name.trim().to_string(),
            statements: vec![statement],
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("RENAME_TABLE_COLUMN_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn alter_table_column(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    changes: AlterTableColumn,
) -> Result<Response<TableColumnChangeResult>, String> {
    let result: Result<TableColumnChangeResult, String> = async {
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::ColumnChange,
        )
        .await?;
        let existing_columns = manager
            .get_columns(&connection_id, &schema, &table)
            .await
            .map(column_lookup)
            .map_err(|e| e.to_string())?;
        let statements = build_alter_table_column_statements(
            kind,
            &schema,
            &table,
            &changes,
            &existing_columns,
        )?;

        for statement in &statements {
            manager
                .query(&connection_id, statement, None, None, None)
                .await
                .map_err(|e| e.to_string())?;
        }

        Ok(TableColumnChangeResult {
            table: table.trim().to_string(),
            column: changes.name.trim().to_string(),
            statements,
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("ALTER_TABLE_COLUMN_ERROR", &error)),
    }
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn create_table_index(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    index: String,
    columns: Vec<String>,
    unique: Option<bool>,
) -> Result<Response<TableIndexChangeResult>, String> {
    let result: Result<TableIndexChangeResult, String> = async {
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::IndexChange,
        )
        .await?;
        let existing_columns = manager
            .get_columns(&connection_id, &schema, &table)
            .await
            .map(column_lookup)
            .map_err(|e| e.to_string())?;
        let statement = build_create_table_index_statement(
            kind,
            &schema,
            &table,
            &index,
            &columns,
            &existing_columns,
            unique.unwrap_or(false),
        )?;

        manager
            .query(&connection_id, &statement, None, None, None)
            .await
            .map_err(|e| e.to_string())?;

        Ok(TableIndexChangeResult {
            table: table.trim().to_string(),
            index: index.trim().to_string(),
            statements: vec![statement],
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("CREATE_TABLE_INDEX_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn drop_table_index(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    index: String,
) -> Result<Response<TableIndexChangeResult>, String> {
    let result: Result<TableIndexChangeResult, String> = async {
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::IndexChange,
        )
        .await?;
        let statement = build_drop_table_index_statement(kind, &schema, &table, &index)?;

        manager
            .query(&connection_id, &statement, None, None, None)
            .await
            .map_err(|e| e.to_string())?;

        Ok(TableIndexChangeResult {
            table: table.trim().to_string(),
            index: index.trim().to_string(),
            statements: vec![statement],
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("DROP_TABLE_INDEX_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn rename_table_index(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    old_name: String,
    new_name: String,
) -> Result<Response<TableIndexChangeResult>, String> {
    let result: Result<TableIndexChangeResult, String> = async {
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::IndexChange,
        )
        .await?;
        let indexes = manager
            .get_indexes(&connection_id, &schema, &table)
            .await
            .map_err(|e| e.to_string())?;
        let statement = build_rename_table_index_statement(
            kind, &schema, &table, &old_name, &new_name, &indexes,
        )?;

        manager
            .query(&connection_id, &statement, None, None, None)
            .await
            .map_err(|e| e.to_string())?;

        Ok(TableIndexChangeResult {
            table: table.trim().to_string(),
            index: new_name.trim().to_string(),
            statements: vec![statement],
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("RENAME_TABLE_INDEX_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn create_table_unique_constraint(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    constraint: String,
    columns: Vec<String>,
) -> Result<Response<TableConstraintChangeResult>, String> {
    let result: Result<TableConstraintChangeResult, String> = async {
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::ConstraintChange,
        )
        .await?;
        let existing_columns = manager
            .get_columns(&connection_id, &schema, &table)
            .await
            .map(column_lookup)
            .map_err(|e| e.to_string())?;
        let statement = build_create_unique_constraint_statement(
            kind,
            &schema,
            &table,
            &constraint,
            &columns,
            &existing_columns,
        )?;

        manager
            .query(&connection_id, &statement, None, None, None)
            .await
            .map_err(|e| e.to_string())?;

        Ok(TableConstraintChangeResult {
            table: table.trim().to_string(),
            constraint: constraint.trim().to_string(),
            statements: vec![statement],
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err(
            "CREATE_TABLE_UNIQUE_CONSTRAINT_ERROR",
            &error,
        )),
    }
}

#[tauri::command]
pub async fn create_table_primary_key(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    constraint: String,
    columns: Vec<String>,
) -> Result<Response<TableConstraintChangeResult>, String> {
    let result: Result<TableConstraintChangeResult, String> = async {
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::ConstraintChange,
        )
        .await?;
        let existing_columns = manager
            .get_columns(&connection_id, &schema, &table)
            .await
            .map(column_lookup)
            .map_err(|e| e.to_string())?;
        let statement = build_create_primary_key_statement(
            kind,
            &schema,
            &table,
            &constraint,
            &columns,
            &existing_columns,
        )?;

        manager
            .query(&connection_id, &statement, None, None, None)
            .await
            .map_err(|e| e.to_string())?;

        Ok(TableConstraintChangeResult {
            table: table.trim().to_string(),
            constraint: constraint.trim().to_string(),
            statements: vec![statement],
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("CREATE_TABLE_PRIMARY_KEY_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn create_table_check_constraint(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    constraint: String,
    expression: String,
) -> Result<Response<TableConstraintChangeResult>, String> {
    let result: Result<TableConstraintChangeResult, String> = async {
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::ConstraintChange,
        )
        .await?;
        let statement = build_create_check_constraint_statement(
            kind,
            &schema,
            &table,
            &constraint,
            &expression,
        )?;

        manager
            .query(&connection_id, &statement, None, None, None)
            .await
            .map_err(|e| e.to_string())?;

        Ok(TableConstraintChangeResult {
            table: table.trim().to_string(),
            constraint: constraint.trim().to_string(),
            statements: vec![statement],
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("CREATE_TABLE_CHECK_CONSTRAINT_ERROR", &error)),
    }
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn create_table_foreign_key(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    constraint: String,
    columns: Vec<String>,
    referenced_schema: Option<String>,
    referenced_table: String,
    referenced_columns: Vec<String>,
    on_delete: Option<String>,
    on_update: Option<String>,
) -> Result<Response<TableConstraintChangeResult>, String> {
    let result: Result<TableConstraintChangeResult, String> = async {
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::ConstraintChange,
        )
        .await?;
        let referenced_schema = referenced_schema
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(schema.as_str());
        let (existing_columns, existing_referenced_columns) = tokio::try_join!(
            async {
                manager
                    .get_columns(&connection_id, &schema, &table)
                    .await
                    .map(column_lookup)
                    .map_err(|e| e.to_string())
            },
            async {
                manager
                    .get_columns(&connection_id, referenced_schema, &referenced_table)
                    .await
                    .map(column_lookup)
                    .map_err(|e| e.to_string())
            }
        )?;
        let statement = build_create_foreign_key_statement(
            kind,
            &schema,
            &table,
            &constraint,
            &columns,
            &existing_columns,
            referenced_schema,
            &referenced_table,
            &referenced_columns,
            &existing_referenced_columns,
            on_delete.as_deref(),
            on_update.as_deref(),
        )?;

        manager
            .query(&connection_id, &statement, None, None, None)
            .await
            .map_err(|e| e.to_string())?;

        Ok(TableConstraintChangeResult {
            table: table.trim().to_string(),
            constraint: constraint.trim().to_string(),
            statements: vec![statement],
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("CREATE_TABLE_FOREIGN_KEY_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn drop_table_constraint(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    constraint: String,
) -> Result<Response<TableConstraintChangeResult>, String> {
    let result: Result<TableConstraintChangeResult, String> = async {
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::ConstraintChange,
        )
        .await?;
        let constraint_name = constraint.trim();
        if constraint_name.is_empty() {
            return Err("Constraint name is required".to_string());
        }

        let constraints = manager
            .get_constraints(&connection_id, &schema, &table)
            .await
            .map_err(|e| e.to_string())?;
        let constraint_info = constraints
            .iter()
            .find(|item| item.name == constraint_name)
            .ok_or_else(|| format!("Unknown constraint: {constraint_name}"))?;
        let statement =
            build_drop_table_constraint_statement(kind, &schema, &table, constraint_info)?;

        manager
            .query(&connection_id, &statement, None, None, None)
            .await
            .map_err(|e| e.to_string())?;

        Ok(TableConstraintChangeResult {
            table: table.trim().to_string(),
            constraint: constraint_name.to_string(),
            statements: vec![statement],
        })
    }
    .await;

    match result {
        Ok(result) => Ok(Response::ok(result)),
        Err(error) => Ok(Response::err("DROP_TABLE_CONSTRAINT_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn truncate_table(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
) -> Result<Response<String>, String> {
    let result: Result<String, String> = async {
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        ensure_resolved_relation_operation_allowed(
            &manager,
            &connection_id,
            &schema,
            &table,
            RelationOperation::Truncate,
        )
        .await?;
        let sql = kind.truncate_table_query(schema_option(&schema), &table);
        manager
            .query(&connection_id, &sql, None, None, None)
            .await
            .map_err(|e| e.to_string())?;
        Ok(format!("Table {} truncated", table))
    }
    .await;

    match result {
        Ok(message) => Ok(Response::ok(message)),
        Err(error) => Ok(Response::err("TRUNCATE_TABLE_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn drop_table(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    cascade: Option<bool>,
    object_type: Option<String>,
) -> Result<Response<String>, String> {
    let result: Result<String, String> = async {
        let table_name = table.trim();
        if table_name.is_empty() {
            return Err("Table name is required".to_string());
        }

        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        let object_type =
            resolve_object_type(&manager, &connection_id, &schema, table_name, object_type).await?;
        let is_view = object_type_is_view(object_type.as_deref());
        let is_materialized_view = object_type_is_materialized_view(object_type.as_deref());
        let is_foreign_table = object_type_is_foreign_table(object_type.as_deref());
        let sql = kind.drop_relation_query_with_kind(
            schema_option(&schema),
            table_name,
            is_view,
            is_materialized_view,
            is_foreign_table,
            cascade.unwrap_or(false),
        );
        manager
            .query(&connection_id, &sql, None, None, None)
            .await
            .map_err(|e| e.to_string())?;
        let label = object_label_from_type(object_type.as_deref());
        Ok(format!("{label} {table_name} dropped"))
    }
    .await;

    match result {
        Ok(message) => Ok(Response::ok(message)),
        Err(error) => Ok(Response::err("DROP_TABLE_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn rename_table(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    old_name: String,
    new_name: String,
    object_type: Option<String>,
) -> Result<Response<String>, String> {
    let result: Result<String, String> = async {
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        let old_name = old_name.trim();
        let new_name = new_name.trim();
        if old_name.is_empty() || new_name.is_empty() {
            return Err("Object names are required".to_string());
        }

        let object_type =
            resolve_object_type(&manager, &connection_id, &schema, old_name, object_type).await?;
        let is_view = object_type_is_view(object_type.as_deref());
        let is_materialized_view = object_type_is_materialized_view(object_type.as_deref());
        let is_foreign_table = object_type_is_foreign_table(object_type.as_deref());
        let sql = kind.rename_relation_query_with_kind(
            schema_option(&schema),
            old_name,
            new_name,
            is_view,
            is_materialized_view,
            is_foreign_table,
        );
        manager
            .query(&connection_id, &sql, None, None, None)
            .await
            .map_err(|e| e.to_string())?;
        let label = object_label_from_type(object_type.as_deref());
        Ok(format!("{label} {old_name} renamed to {new_name}"))
    }
    .await;

    match result {
        Ok(message) => Ok(Response::ok(message)),
        Err(error) => Ok(Response::err("RENAME_TABLE_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn get_view_definition(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    view: String,
    object_type: Option<String>,
) -> Result<Response<String>, String> {
    let error_context = serde_json::json!({
        "connectionId": connection_id,
        "driver": driver,
        "schema": schema,
        "view": view,
    });
    let result: Result<String, String> = async {
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        let view_name = view.trim();
        if view_name.is_empty() {
            return Err("View name is required".to_string());
        }

        let object_type =
            resolve_object_type(&manager, &connection_id, &schema, view_name, object_type).await?;
        if !object_type_is_view(object_type.as_deref()) {
            return Err(format!("{view_name} is not a view"));
        }

        let sql = view_definition_query(kind, &schema, view_name);
        let results = manager
            .query(&connection_id, &sql, None, None, None)
            .await
            .map_err(|e| e.to_string())?;
        let definition = results
            .first()
            .and_then(|result| result.rows.first())
            .and_then(|row| row.first())
            .and_then(value_to_string)
            .unwrap_or_default();

        if definition.trim().is_empty() {
            Err("View definition not found".to_string())
        } else {
            Ok(definition)
        }
    }
    .await;

    match result {
        Ok(definition) => Ok(Response::ok(definition)),
        Err(error) => Ok(Response::err_with_details(
            "GET_VIEW_DEFINITION_ERROR",
            &error,
            true,
            Some(error_context),
        )),
    }
}

async fn get_elasticsearch_index_mapping(
    manager: &ConnectionManager,
    connection_id: &str,
    index: &str,
) -> Result<String, anyhow::Error> {
    let index = index.trim();
    if index.is_empty() {
        return Err(anyhow::anyhow!("Elasticsearch index name is required"));
    }
    let encoded_index = utf8_percent_encode(index, NON_ALPHANUMERIC).to_string();
    let results = manager
        .query(
            connection_id,
            &format!("GET /{encoded_index}/_mapping"),
            None,
            None,
            None,
        )
        .await?;
    let result = results
        .first()
        .ok_or_else(|| anyhow::anyhow!("Elasticsearch returned no mapping result"))?;
    let mapping_column = result
        .columns
        .iter()
        .position(|column| column.name == "result")
        .ok_or_else(|| anyhow::anyhow!("Elasticsearch mapping result is malformed"))?;
    let mapping = result
        .rows
        .first()
        .and_then(|row| row.get(mapping_column))
        .ok_or_else(|| anyhow::anyhow!("Elasticsearch mapping response is empty"))?;
    serde_json::to_string_pretty(mapping).map_err(Into::into)
}

#[tauri::command]
pub async fn refresh_materialized_view(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    view: String,
    object_type: Option<String>,
    concurrently: Option<bool>,
) -> Result<Response<String>, String> {
    let result: Result<String, String> = async {
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        let view_name = view.trim();
        if view_name.is_empty() {
            return Err("View name is required".to_string());
        }

        let object_type =
            resolve_object_type(&manager, &connection_id, &schema, view_name, object_type).await?;
        if !object_type_is_materialized_view(object_type.as_deref()) {
            return Err(format!("{view_name} is not a materialized view"));
        }

        let sql = kind
            .refresh_materialized_view_query(
                schema_option(&schema),
                view_name,
                concurrently.unwrap_or(false),
            )
            .ok_or_else(|| "Materialized views are not supported by this driver".to_string())?;
        manager
            .query(&connection_id, &sql, None, None, None)
            .await
            .map_err(|e| e.to_string())?;
        Ok(format!("Materialized view {view_name} refreshed"))
    }
    .await;

    match result {
        Ok(message) => Ok(Response::ok(message)),
        Err(error) => Ok(Response::err("REFRESH_MATERIALIZED_VIEW_ERROR", &error)),
    }
}

#[tauri::command]
pub async fn get_table_ddl(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
    table: String,
    object_type: Option<String>,
    database: Option<String>,
) -> Result<Response<String>, String> {
    let error_context = serde_json::json!({
        "connectionId": connection_id,
        "driver": driver,
        "database": database,
        "schema": schema,
        "table": table,
    });
    let result: Result<String, String> = async {
        if matches!(
            driver.trim().to_ascii_lowercase().as_str(),
            "elasticsearch" | "elastic"
        ) {
            return get_elasticsearch_index_mapping(&manager, &connection_id, &table)
                .await
                .map_err(|error| error.to_string());
        }
        let kind = DatabaseKind::from_str(&driver).map_err(|e| e.to_string())?;
        let table_name = table.trim();
        if table_name.is_empty() {
            return Err("Object name is required".to_string());
        }
        let database = database.as_deref();
        let object_type = if let Some(explicit_type) = object_type
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        {
            Some(explicit_type)
        } else if let Some(database) = database {
            manager
                .get_database_tables(&connection_id, database, &schema)
                .await
                .map_err(|error| error.to_string())?
                .into_iter()
                .find(|candidate| candidate.name == table_name)
                .and_then(|candidate| candidate.table_type)
        } else {
            resolve_object_type(&manager, &connection_id, &schema, table_name, None).await?
        };
        let is_view = object_type_is_view(object_type.as_deref());
        let is_materialized_view = object_type_is_materialized_view(object_type.as_deref());

        if let Some(sql) =
            kind.show_create_relation_query(schema_option(&schema), table_name, is_view)
        {
            let results = query_target(&manager, &connection_id, database, &sql)
                .await
                .map_err(|e| e.to_string())?;
            let ddl = results
                .first()
                .and_then(|result| result.rows.first())
                .and_then(|row| row.get(1))
                .and_then(value_to_string)
                .unwrap_or_else(|| "-- DDL not found".to_string());
            return Ok(ddl);
        }

        if is_view {
            let sql = view_definition_query(kind, &schema, table_name);
            let results = query_target(&manager, &connection_id, database, &sql)
                .await
                .map_err(|e| e.to_string())?;
            let definition = results
                .first()
                .and_then(|result| result.rows.first())
                .and_then(|row| row.first())
                .and_then(value_to_string)
                .unwrap_or_default();
            if definition.trim().is_empty() {
                return Ok("-- DDL not found: view definition is empty".to_string());
            }

            if is_materialized_view {
                return Ok(generate_postgres_materialized_view_ddl(
                    kind,
                    &schema,
                    table_name,
                    &definition,
                ));
            }

            return Ok(generate_postgres_view_ddl(
                kind,
                &schema,
                table_name,
                &definition,
            ));
        }

        let columns = get_target_columns(&manager, &connection_id, database, &schema, table_name)
            .await
            .map_err(|e| e.to_string())?;
        let constraints = match database {
            Some(database) => {
                manager
                    .get_database_constraints(&connection_id, database, &schema, table_name)
                    .await
            }
            None => {
                manager
                    .get_constraints(&connection_id, &schema, table_name)
                    .await
            }
        }
        .unwrap_or_default();
        let indexes = match database {
            Some(database) => {
                manager
                    .get_database_indexes(&connection_id, database, &schema, table_name)
                    .await
            }
            None => {
                manager
                    .get_indexes(&connection_id, &schema, table_name)
                    .await
            }
        }
        .unwrap_or_default();

        if columns.is_empty() {
            return Ok("-- DDL not found: table has no column metadata".to_string());
        }

        Ok(generate_postgres_table_ddl(
            &schema,
            table_name,
            &columns,
            &constraints,
            &indexes,
        ))
    }
    .await;

    match result {
        Ok(ddl) => Ok(Response::ok(ddl)),
        Err(error) => Ok(Response::err_with_details(
            "GET_TABLE_DDL_ERROR",
            &error,
            true,
            Some(error_context),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_add_table_column_statements, build_alter_table_column_statements,
        build_create_check_constraint_statement, build_create_foreign_key_statement,
        build_create_materialized_view_statement, build_create_primary_key_statement,
        build_create_table_index_statement, build_create_table_statements,
        build_create_unique_constraint_statement, build_create_view_statement,
        build_drop_table_column_statement, build_drop_table_constraint_statement,
        build_drop_table_index_statement, build_insert_mutation,
        build_rename_table_column_statement, build_rename_table_index_statement,
        build_structured_filter_where, build_table_order_by, build_update_mutation,
        canonical_import_columns, column_lookup, csv_escape, execute_target_parameterized_batch,
        generate_postgres_materialized_view_ddl, generate_postgres_table_ddl,
        generate_postgres_view_ddl, get_target_columns, object_label_from_type,
        object_type_is_foreign_table, object_type_is_materialized_view, object_type_is_view,
        postgres_view_definition_query, preview_metadata_required, query_target,
        query_target_parameterized, relation_operation_allowed, sanitize_file_part,
        sql_insert_statement, summarize_mutation_affected, validated_raw_filter_sql, value_to_u64,
        view_definition_query, AlterColumnValueMode, AlterTableColumn, CreateTableColumn,
        RelationOperation, TableFilter, TableRowUpdate, TableSort,
    };
    use crate::core::{
        dialect::DatabaseKind,
        driver::DatabaseDriver,
        manager::ConnectionManager,
        protocol::{
            ColumnInfo, ConstraintInfo, IndexInfo, ParameterizedStatement, QueryParameter,
            QueryResult,
        },
    };
    use anyhow::Result;
    use async_trait::async_trait;
    use serde_json::json;
    use std::collections::BTreeMap;

    struct PreviewTargetDriver;

    #[test]
    fn exports_replayable_sql_insert_statements() {
        assert_eq!(
            sql_insert_statement(
                DatabaseKind::Postgres,
                "public",
                "users",
                &["id".to_string(), "display name".to_string()],
                &[json!(7), json!("O'Reilly")],
            ),
            r#"INSERT INTO "public"."users" ("id", "display name") VALUES (7, 'O''Reilly');"#
        );
        assert_eq!(
            sql_insert_statement(
                DatabaseKind::Mysql,
                "app",
                "events",
                &["payload".to_string(), "active".to_string()],
                &[json!({"kind": "login"}), json!(true)],
            ),
            r#"INSERT INTO `app`.`events` (`payload`, `active`) VALUES ('{"kind":"login"}', TRUE);"#
        );
    }

    #[test]
    fn import_headers_resolve_to_canonical_table_columns() {
        let columns = column_lookup(vec![target_column("user_id"), target_column("DisplayName")]);
        assert_eq!(
            canonical_import_columns(
                &["USER_ID".to_string(), "displayname".to_string()],
                &columns,
            )
            .unwrap(),
            vec!["user_id".to_string(), "DisplayName".to_string()]
        );
        assert!(canonical_import_columns(&["missing".to_string()], &columns).is_err());
    }

    fn target_column(name: &str) -> ColumnInfo {
        ColumnInfo {
            name: name.to_string(),
            data_type: "text".to_string(),
            is_nullable: true,
            is_primary_key: false,
            is_unique: false,
            is_indexed: false,
            is_auto_increment: false,
            default_value: None,
            comment: None,
        }
    }

    #[async_trait]
    impl DatabaseDriver for PreviewTargetDriver {
        async fn connect(&mut self) -> Result<()> {
            Ok(())
        }

        async fn disconnect(&self) -> Result<()> {
            Ok(())
        }

        async fn ping(&self) -> Result<()> {
            Ok(())
        }

        async fn query(&self, _sql: &str) -> Result<Vec<QueryResult>> {
            Ok(vec![QueryResult::execution("primary", 0)])
        }

        async fn query_database(&self, database: &str, _sql: &str) -> Result<Vec<QueryResult>> {
            Ok(vec![QueryResult::execution(database, 0)])
        }

        async fn query_parameterized(
            &self,
            _sql: &str,
            params: &[QueryParameter],
        ) -> Result<Vec<QueryResult>> {
            Ok(vec![QueryResult::execution(
                "primary-parameterized",
                params.len() as u64,
            )])
        }

        async fn query_database_parameterized(
            &self,
            database: &str,
            _sql: &str,
            params: &[QueryParameter],
        ) -> Result<Vec<QueryResult>> {
            Ok(vec![QueryResult::execution(
                &format!("{database}-parameterized"),
                params.len() as u64,
            )])
        }

        async fn execute_parameterized_batch(
            &self,
            statements: &[ParameterizedStatement],
        ) -> Result<Vec<u64>> {
            Ok(vec![1; statements.len()])
        }

        async fn execute_database_parameterized_batch(
            &self,
            database: &str,
            statements: &[ParameterizedStatement],
        ) -> Result<Vec<u64>> {
            Ok(vec![database.len() as u64; statements.len()])
        }

        async fn get_columns(&self, _schema: &str, _table: &str) -> Result<Vec<ColumnInfo>> {
            Ok(vec![target_column("primary")])
        }

        async fn get_database_columns(
            &self,
            database: &str,
            _schema: &str,
            _table: &str,
        ) -> Result<Vec<ColumnInfo>> {
            Ok(vec![target_column(database)])
        }
    }

    #[tokio::test]
    async fn preview_helpers_preserve_explicit_database_scope() {
        let manager = ConnectionManager::new();
        manager
            .add_connection("conn".to_string(), Box::new(PreviewTargetDriver))
            .await;

        let primary_columns = get_target_columns(&manager, "conn", None, "public", "events")
            .await
            .unwrap();
        let scoped_columns =
            get_target_columns(&manager, "conn", Some("analytics"), "public", "events")
                .await
                .unwrap();
        assert_eq!(primary_columns[0].name, "primary");
        assert_eq!(scoped_columns[0].name, "analytics");

        let primary_query = query_target(&manager, "conn", None, "SELECT 1")
            .await
            .unwrap();
        let scoped_query = query_target(&manager, "conn", Some("analytics"), "SELECT 1")
            .await
            .unwrap();
        assert_eq!(primary_query[0].statement_type.as_deref(), Some("primary"));
        assert_eq!(scoped_query[0].statement_type.as_deref(), Some("analytics"));

        let params = [QueryParameter {
            value: json!(1),
            data_type: Some("integer".to_string()),
        }];
        let primary_parameterized =
            query_target_parameterized(&manager, "conn", None, "SELECT $1", &params)
                .await
                .unwrap();
        let scoped_parameterized =
            query_target_parameterized(&manager, "conn", Some("analytics"), "SELECT $1", &params)
                .await
                .unwrap();
        assert_eq!(
            primary_parameterized[0].statement_type.as_deref(),
            Some("primary-parameterized")
        );
        assert_eq!(
            scoped_parameterized[0].statement_type.as_deref(),
            Some("analytics-parameterized")
        );

        let statements = [ParameterizedStatement {
            sql: "UPDATE events SET name = $1".to_string(),
            params: Vec::new(),
        }];
        assert_eq!(
            execute_target_parameterized_batch(&manager, "conn", None, &statements)
                .await
                .unwrap(),
            vec![1]
        );
        assert_eq!(
            execute_target_parameterized_batch(&manager, "conn", Some("analytics"), &statements)
                .await
                .unwrap(),
            vec![9]
        );
    }

    #[test]
    fn preview_skips_column_metadata_without_structured_filters_or_sort() {
        let filters = [TableFilter {
            column: "status".to_string(),
            operator: "eq".to_string(),
            value: "active".to_string(),
            logic: None,
        }];
        let sort = TableSort {
            column: "id".to_string(),
            direction: "asc".to_string(),
        };

        assert!(!preview_metadata_required(None, None));
        assert!(preview_metadata_required(Some(&filters), None));
        assert!(preview_metadata_required(None, Some(&sort)));
    }

    #[test]
    fn validates_raw_table_filters_before_query_composition() {
        assert_eq!(
            validated_raw_filter_sql(
                DatabaseKind::Postgres,
                Some("WHERE status = 'active;pending'")
            )
            .unwrap()
            .as_deref(),
            Some("WHERE status = 'active;pending'")
        );
        assert!(validated_raw_filter_sql(
            DatabaseKind::Postgres,
            Some("id = 1; DELETE FROM users")
        )
        .is_err());
        assert!(validated_raw_filter_sql(
            DatabaseKind::Mysql,
            Some("id = 1 UNION SELECT password FROM users")
        )
        .is_err());
        assert!(validated_raw_filter_sql(
            DatabaseKind::Postgres,
            Some("id IN (SELECT id FROM admins)")
        )
        .is_err());
    }

    #[test]
    fn generates_postgres_table_ddl_from_columns() {
        let ddl = generate_postgres_table_ddl(
            "public",
            "users",
            &[
                ColumnInfo {
                    name: "id".to_string(),
                    data_type: "integer".to_string(),
                    is_nullable: false,
                    is_primary_key: true,
                    is_unique: true,
                    is_indexed: true,
                    default_value: Some("nextval('users_id_seq'::regclass)".to_string()),
                    is_auto_increment: false,
                    comment: None,
                },
                ColumnInfo {
                    name: "email".to_string(),
                    data_type: "text".to_string(),
                    is_nullable: false,
                    is_primary_key: false,
                    is_unique: false,
                    is_indexed: false,
                    default_value: None,
                    is_auto_increment: false,
                    comment: None,
                },
            ],
            &[
                ConstraintInfo {
                    name: "users_pkey".to_string(),
                    constraint_type: "PRIMARY KEY".to_string(),
                    columns: vec!["id".to_string()],
                    referenced_schema: None,
                    referenced_table: None,
                    referenced_columns: vec![],
                    definition: Some("PRIMARY KEY (id)".to_string()),
                },
                ConstraintInfo {
                    name: "users_email_key".to_string(),
                    constraint_type: "UNIQUE".to_string(),
                    columns: vec!["email".to_string()],
                    referenced_schema: None,
                    referenced_table: None,
                    referenced_columns: vec![],
                    definition: Some("UNIQUE (email)".to_string()),
                },
            ],
            &[IndexInfo {
                name: "users_email_idx".to_string(),
                columns: vec!["email".to_string()],
                is_unique: false,
                is_primary: false,
                index_type: Some("btree".to_string()),
                definition: Some(
                    "CREATE INDEX users_email_idx ON public.users USING btree (email)".to_string(),
                ),
            }],
        );

        assert!(ddl.contains(r#"CREATE TABLE "public"."users""#));
        assert!(ddl.contains(r#""id" integer DEFAULT nextval"#));
        assert!(ddl.contains(r#"CONSTRAINT "users_pkey" PRIMARY KEY (id)"#));
        assert!(ddl.contains(r#"CONSTRAINT "users_email_key" UNIQUE (email)"#));
        assert!(ddl.contains("CREATE INDEX users_email_idx"));
    }

    #[test]
    fn generates_postgres_view_ddl() {
        assert!(object_type_is_view(Some("VIEW")));
        assert!(object_type_is_view(Some("SYSTEM VIEW")));
        assert!(object_type_is_view(Some("MATERIALIZED VIEW")));
        assert!(object_type_is_materialized_view(Some("MATERIALIZED VIEW")));
        assert!(!object_type_is_materialized_view(Some("VIEW")));
        assert!(object_type_is_foreign_table(Some("FOREIGN TABLE")));
        assert!(!object_type_is_view(Some("BASE TABLE")));
        assert_eq!(
            object_label_from_type(Some("MATERIALIZED VIEW")),
            "Materialized view"
        );
        assert_eq!(
            object_label_from_type(Some("FOREIGN TABLE")),
            "Foreign table"
        );

        assert_eq!(
            postgres_view_definition_query(DatabaseKind::Postgres, "public", "active_users"),
            r#"SELECT pg_get_viewdef(to_regclass('"public"."active_users"'), true) AS definition;"#
        );
        assert_eq!(
            view_definition_query(DatabaseKind::Postgres, "public", "active_users"),
            r#"SELECT pg_get_viewdef(to_regclass('"public"."active_users"'), true) AS definition;"#
        );
        assert_eq!(
            view_definition_query(DatabaseKind::Mysql, "app", "active_users"),
            "SELECT VIEW_DEFINITION AS definition FROM information_schema.VIEWS WHERE TABLE_SCHEMA = 'app' AND TABLE_NAME = 'active_users';"
        );
        assert_eq!(
            generate_postgres_view_ddl(
                DatabaseKind::Postgres,
                "public",
                "active_users",
                " SELECT id FROM users WHERE active "
            ),
            r#"CREATE OR REPLACE VIEW "public"."active_users" AS
SELECT id FROM users WHERE active;"#
        );
        assert_eq!(
            generate_postgres_materialized_view_ddl(
                DatabaseKind::Postgres,
                "public",
                "active_users_mv",
                " SELECT id FROM users WHERE active "
            ),
            r#"CREATE MATERIALIZED VIEW "public"."active_users_mv" AS
SELECT id FROM users WHERE active;"#
        );
    }

    #[test]
    fn relation_operation_matrix_matches_object_type() {
        assert!(relation_operation_allowed(
            RelationOperation::DataMutation,
            Some("BASE TABLE")
        ));
        assert!(relation_operation_allowed(
            RelationOperation::ColumnChange,
            Some("BASE TABLE")
        ));
        assert!(relation_operation_allowed(
            RelationOperation::ConstraintChange,
            Some("BASE TABLE")
        ));
        assert!(relation_operation_allowed(
            RelationOperation::IndexChange,
            Some("BASE TABLE")
        ));

        assert!(!relation_operation_allowed(
            RelationOperation::DataMutation,
            Some("VIEW")
        ));
        assert!(!relation_operation_allowed(
            RelationOperation::ColumnChange,
            Some("VIEW")
        ));
        assert!(!relation_operation_allowed(
            RelationOperation::IndexChange,
            Some("VIEW")
        ));

        assert!(!relation_operation_allowed(
            RelationOperation::DataMutation,
            Some("MATERIALIZED VIEW")
        ));
        assert!(!relation_operation_allowed(
            RelationOperation::ConstraintChange,
            Some("MATERIALIZED VIEW")
        ));
        assert!(relation_operation_allowed(
            RelationOperation::IndexChange,
            Some("MATERIALIZED VIEW")
        ));

        assert!(!relation_operation_allowed(
            RelationOperation::DataMutation,
            Some("FOREIGN TABLE")
        ));
        assert!(!relation_operation_allowed(
            RelationOperation::IndexChange,
            Some("FOREIGN TABLE")
        ));
    }

    #[test]
    fn parses_count_values() {
        assert_eq!(value_to_u64(&json!(42)), Some(42));
        assert_eq!(value_to_u64(&json!("42")), Some(42));
        assert_eq!(value_to_u64(&json!(null)), None);
    }

    #[test]
    fn escapes_csv_values() {
        assert_eq!(csv_escape(&json!("plain")), "plain");
        assert_eq!(csv_escape(&json!("a,b")), "\"a,b\"");
        assert_eq!(csv_escape(&json!("a\"b")), "\"a\"\"b\"");
        assert_eq!(csv_escape(&json!(null)), "");
    }

    #[test]
    fn sanitizes_export_file_parts() {
        assert_eq!(sanitize_file_part("public"), "public");
        assert_eq!(sanitize_file_part("sales/orders"), "sales_orders");
        assert_eq!(sanitize_file_part(" "), "table");
    }

    #[test]
    fn builds_mysql_insert_with_parameter_placeholders() {
        let columns = column_lookup(vec![ColumnInfo {
            name: "name".to_string(),
            data_type: "varchar".to_string(),
            is_nullable: false,
            is_primary_key: false,
            is_unique: false,
            is_indexed: false,
            default_value: None,
            is_auto_increment: false,
            comment: None,
        }]);
        let mut values = BTreeMap::new();
        values.insert("name".to_string(), json!("Ada"));

        let (sql, params) =
            build_insert_mutation(DatabaseKind::Mysql, "app", "users", &columns, &values).unwrap();

        assert_eq!(sql, "INSERT INTO `app`.`users` (`name`) VALUES (?);");
        assert_eq!(params.len(), 1);
        assert_eq!(params[0].data_type.as_deref(), Some("varchar"));
    }

    #[test]
    fn builds_default_values_inserts_for_empty_rows() {
        let columns = BTreeMap::new();
        let values = BTreeMap::new();

        let (postgres_sql, postgres_params) = build_insert_mutation(
            DatabaseKind::Postgres,
            "public",
            "events",
            &columns,
            &values,
        )
        .unwrap();
        assert_eq!(
            postgres_sql,
            r#"INSERT INTO "public"."events" DEFAULT VALUES;"#
        );
        assert!(postgres_params.is_empty());

        let (mysql_sql, mysql_params) =
            build_insert_mutation(DatabaseKind::Mysql, "app", "events", &columns, &values).unwrap();
        assert_eq!(mysql_sql, "INSERT INTO `app`.`events` () VALUES ();");
        assert!(mysql_params.is_empty());
    }

    #[test]
    fn builds_postgres_update_with_casted_parameters() {
        let columns = column_lookup(vec![
            ColumnInfo {
                name: "id".to_string(),
                data_type: "integer".to_string(),
                is_nullable: false,
                is_primary_key: true,
                is_unique: true,
                is_indexed: true,
                default_value: None,
                is_auto_increment: false,
                comment: None,
            },
            ColumnInfo {
                name: "email".to_string(),
                data_type: "text".to_string(),
                is_nullable: false,
                is_primary_key: false,
                is_unique: false,
                is_indexed: false,
                default_value: None,
                is_auto_increment: false,
                comment: None,
            },
        ]);
        let mut key = BTreeMap::new();
        key.insert("id".to_string(), json!(7));
        let mut values = BTreeMap::new();
        values.insert("email".to_string(), json!("ada@example.test"));

        let (sql, params) = build_update_mutation(
            DatabaseKind::Postgres,
            "public",
            "users",
            &columns,
            &TableRowUpdate { key, values },
        )
        .unwrap();

        assert_eq!(
            sql,
            r#"UPDATE "public"."users" SET "email" = $1::text WHERE "id" = $2::integer;"#
        );
        assert_eq!(params.len(), 2);
    }

    #[test]
    fn builds_postgres_structured_filter_with_parameters() {
        let columns = column_lookup(vec![
            ColumnInfo {
                name: "name".to_string(),
                data_type: "text".to_string(),
                is_nullable: false,
                is_primary_key: false,
                is_unique: false,
                is_indexed: false,
                default_value: None,
                is_auto_increment: false,
                comment: None,
            },
            ColumnInfo {
                name: "id".to_string(),
                data_type: "integer".to_string(),
                is_nullable: false,
                is_primary_key: true,
                is_unique: true,
                is_indexed: true,
                default_value: None,
                is_auto_increment: false,
                comment: None,
            },
        ]);

        let (where_clause, params) = build_structured_filter_where(
            DatabaseKind::Postgres,
            &columns,
            &[
                TableFilter {
                    column: "name".to_string(),
                    operator: "contains".to_string(),
                    value: "A%_".to_string(),
                    logic: None,
                },
                TableFilter {
                    column: "id".to_string(),
                    operator: ">=".to_string(),
                    value: "7".to_string(),
                    logic: Some("AND".to_string()),
                },
            ],
        )
        .unwrap();

        assert_eq!(
            where_clause,
            r#"CAST("name" AS text) LIKE $1::text ESCAPE '=' AND "id" >= $2::integer"#
        );
        assert_eq!(params.len(), 2);
        assert_eq!(params[0].value, json!("%A=%=_%"));
        assert_eq!(params[1].data_type.as_deref(), Some("integer"));
    }

    #[test]
    fn builds_mysql_structured_filter_with_parameters() {
        let columns = column_lookup(vec![ColumnInfo {
            name: "email".to_string(),
            data_type: "varchar".to_string(),
            is_nullable: false,
            is_primary_key: false,
            is_unique: false,
            is_indexed: true,
            default_value: None,
            is_auto_increment: false,
            comment: None,
        }]);

        let (where_clause, params) = build_structured_filter_where(
            DatabaseKind::Mysql,
            &columns,
            &[TableFilter {
                column: "email".to_string(),
                operator: "startsWith".to_string(),
                value: "ops".to_string(),
                logic: None,
            }],
        )
        .unwrap();

        assert_eq!(where_clause, "CAST(`email` AS CHAR) LIKE ? ESCAPE '='");
        assert_eq!(params.len(), 1);
        assert_eq!(params[0].value, json!("ops%"));
    }

    #[test]
    fn rejects_unknown_structured_filter_parts() {
        let columns = column_lookup(vec![ColumnInfo {
            name: "id".to_string(),
            data_type: "integer".to_string(),
            is_nullable: false,
            is_primary_key: true,
            is_unique: true,
            is_indexed: true,
            default_value: None,
            is_auto_increment: false,
            comment: None,
        }]);

        assert!(build_structured_filter_where(
            DatabaseKind::Postgres,
            &columns,
            &[TableFilter {
                column: "missing".to_string(),
                operator: "equals".to_string(),
                value: "1".to_string(),
                logic: None,
            }],
        )
        .is_err());

        assert!(build_structured_filter_where(
            DatabaseKind::Postgres,
            &columns,
            &[TableFilter {
                column: "id".to_string(),
                operator: "regexp".to_string(),
                value: "1".to_string(),
                logic: None,
            }],
        )
        .is_err());
    }

    #[test]
    fn builds_safe_table_order_by_clause() {
        let columns = column_lookup(vec![ColumnInfo {
            name: "created_at".to_string(),
            data_type: "timestamp".to_string(),
            is_nullable: false,
            is_primary_key: false,
            is_unique: false,
            is_indexed: true,
            default_value: None,
            is_auto_increment: false,
            comment: None,
        }]);

        let order = build_table_order_by(
            DatabaseKind::Postgres,
            &columns,
            Some(&TableSort {
                column: "created_at".to_string(),
                direction: "desc".to_string(),
            }),
        )
        .unwrap();

        assert_eq!(order.as_deref(), Some(r#""created_at" DESC"#));
        assert!(build_table_order_by(
            DatabaseKind::Mysql,
            &columns,
            Some(&TableSort {
                column: "missing".to_string(),
                direction: "asc".to_string(),
            }),
        )
        .is_err());
        assert!(build_table_order_by(
            DatabaseKind::Mysql,
            &columns,
            Some(&TableSort {
                column: "created_at".to_string(),
                direction: "sideways".to_string(),
            }),
        )
        .is_err());

        let stable_columns = column_lookup(vec![
            ColumnInfo {
                name: "tenant_id".to_string(),
                data_type: "integer".to_string(),
                is_nullable: false,
                is_primary_key: true,
                is_unique: false,
                is_indexed: true,
                default_value: None,
                is_auto_increment: false,
                comment: None,
            },
            ColumnInfo {
                name: "id".to_string(),
                data_type: "integer".to_string(),
                is_nullable: false,
                is_primary_key: true,
                is_unique: false,
                is_indexed: true,
                default_value: None,
                is_auto_increment: false,
                comment: None,
            },
            ColumnInfo {
                name: "created_at".to_string(),
                data_type: "timestamp".to_string(),
                is_nullable: false,
                is_primary_key: false,
                is_unique: false,
                is_indexed: true,
                default_value: None,
                is_auto_increment: false,
                comment: None,
            },
        ]);
        assert_eq!(
            build_table_order_by(DatabaseKind::Postgres, &stable_columns, None)
                .unwrap()
                .as_deref(),
            Some(r#""id" ASC, "tenant_id" ASC"#)
        );
        assert_eq!(
            build_table_order_by(
                DatabaseKind::Postgres,
                &stable_columns,
                Some(&TableSort {
                    column: "created_at".to_string(),
                    direction: "desc".to_string(),
                }),
            )
            .unwrap()
            .as_deref(),
            Some(r#""created_at" DESC, "id" ASC, "tenant_id" ASC"#)
        );
    }

    #[test]
    fn summarizes_mutation_affected_by_statement_group() {
        let summary = summarize_mutation_affected(&[1, 1, 3, 2], 2, 1, 1);

        assert_eq!(summary.inserted, 2);
        assert_eq!(summary.updated, 3);
        assert_eq!(summary.deleted, 2);
        assert_eq!(summary.rows_affected, 7);
    }

    #[test]
    fn builds_mysql_create_table_with_inline_comments() {
        let statements = build_create_table_statements(
            DatabaseKind::Mysql,
            "app",
            "users",
            &[
                CreateTableColumn {
                    name: "id".to_string(),
                    data_type: "INT".to_string(),
                    length: None,
                    is_primary_key: true,
                    is_not_null: true,
                    is_auto_increment: true,
                    comment: None,
                },
                CreateTableColumn {
                    name: "name".to_string(),
                    data_type: "VARCHAR".to_string(),
                    length: Some("255".to_string()),
                    is_primary_key: false,
                    is_not_null: true,
                    is_auto_increment: false,
                    comment: Some("display name".to_string()),
                },
            ],
        )
        .unwrap();

        assert_eq!(statements.len(), 1);
        assert!(statements[0].contains("CREATE TABLE `app`.`users`"));
        assert!(statements[0].contains("`id` INT AUTO_INCREMENT NOT NULL"));
        assert!(statements[0].contains("`name` VARCHAR(255) NOT NULL COMMENT 'display name'"));
        assert!(statements[0].contains("PRIMARY KEY (`id`)"));
    }

    #[test]
    fn builds_create_view_statements_for_supported_drivers() {
        assert_eq!(
            build_create_view_statement(
                DatabaseKind::Postgres,
                "public",
                "active_users",
                "SELECT id, email FROM users WHERE active = true;",
                true,
            )
            .unwrap(),
            r#"CREATE OR REPLACE VIEW "public"."active_users" AS
SELECT id, email FROM users WHERE active = true;"#
        );

        assert_eq!(
            build_create_view_statement(
                DatabaseKind::Mysql,
                "app",
                "active_users",
                "WITH scoped AS (SELECT id FROM users) SELECT id FROM scoped",
                false,
            )
            .unwrap(),
            "CREATE VIEW `app`.`active_users` AS\nWITH scoped AS (SELECT id FROM users) SELECT id FROM scoped;"
        );
    }

    #[test]
    fn builds_create_materialized_view_statement_for_postgres() {
        assert_eq!(
            build_create_materialized_view_statement(
                DatabaseKind::Postgres,
                "public",
                "active_users_mv",
                "SELECT id FROM users WHERE active;",
                true,
            )
            .unwrap(),
            r#"CREATE MATERIALIZED VIEW "public"."active_users_mv" AS
SELECT id FROM users WHERE active
WITH DATA;"#
        );

        assert!(build_create_materialized_view_statement(
            DatabaseKind::Mysql,
            "app",
            "active_users_mv",
            "SELECT id FROM users",
            true,
        )
        .is_err());
    }

    #[test]
    fn rejects_unsafe_create_view_input() {
        assert!(build_create_view_statement(
            DatabaseKind::Postgres,
            "public",
            "bad_view",
            "DROP TABLE users",
            false,
        )
        .is_err());

        assert!(build_create_view_statement(
            DatabaseKind::Mysql,
            "app",
            "bad_view",
            "SELECT * FROM users; DROP TABLE users",
            false,
        )
        .is_err());

        assert!(build_create_view_statement(
            DatabaseKind::Mysql,
            "app",
            "",
            "SELECT * FROM users",
            false,
        )
        .is_err());
    }

    #[test]
    fn builds_postgres_create_table_with_comment_statements() {
        let statements = build_create_table_statements(
            DatabaseKind::Postgres,
            "public",
            "users",
            &[
                CreateTableColumn {
                    name: "id".to_string(),
                    data_type: "SERIAL".to_string(),
                    length: None,
                    is_primary_key: true,
                    is_not_null: true,
                    is_auto_increment: true,
                    comment: None,
                },
                CreateTableColumn {
                    name: "email".to_string(),
                    data_type: "TEXT".to_string(),
                    length: None,
                    is_primary_key: false,
                    is_not_null: true,
                    is_auto_increment: false,
                    comment: Some("login email".to_string()),
                },
            ],
        )
        .unwrap();

        assert_eq!(statements.len(), 2);
        assert!(statements[0].contains(r#"CREATE TABLE "public"."users""#));
        assert!(statements[0].contains(r#""id" SERIAL NOT NULL"#));
        assert!(statements[0].contains(r#"PRIMARY KEY ("id")"#));
        assert_eq!(
            statements[1],
            r#"COMMENT ON COLUMN "public"."users"."email" IS 'login email';"#
        );
    }

    #[test]
    fn builds_postgres_identity_for_integer_auto_increment_columns() {
        let statements = build_create_table_statements(
            DatabaseKind::Postgres,
            "public",
            "events",
            &[CreateTableColumn {
                name: "id".to_string(),
                data_type: "INTEGER".to_string(),
                length: None,
                is_primary_key: true,
                is_not_null: true,
                is_auto_increment: true,
                comment: None,
            }],
        )
        .unwrap();

        assert!(statements[0].contains(r#""id" INTEGER GENERATED BY DEFAULT AS IDENTITY NOT NULL"#));
        assert!(statements[0].contains(r#"PRIMARY KEY ("id")"#));
    }

    #[test]
    fn rejects_postgres_auto_increment_for_non_integer_columns() {
        assert!(build_create_table_statements(
            DatabaseKind::Postgres,
            "public",
            "events",
            &[CreateTableColumn {
                name: "slug".to_string(),
                data_type: "TEXT".to_string(),
                length: None,
                is_primary_key: false,
                is_not_null: true,
                is_auto_increment: true,
                comment: None,
            }],
        )
        .is_err());
    }

    #[test]
    fn builds_mysql_add_column_with_inline_comment() {
        let statements = build_add_table_column_statements(
            DatabaseKind::Mysql,
            "app",
            "users",
            &CreateTableColumn {
                name: "nickname".to_string(),
                data_type: "VARCHAR".to_string(),
                length: Some("64".to_string()),
                is_primary_key: false,
                is_not_null: false,
                is_auto_increment: false,
                comment: Some("short display name".to_string()),
            },
        )
        .unwrap();

        assert_eq!(statements.len(), 1);
        assert_eq!(
            statements[0],
            "ALTER TABLE `app`.`users` ADD COLUMN `nickname` VARCHAR(64) COMMENT 'short display name';"
        );
    }

    #[test]
    fn builds_postgres_add_column_with_comment_statement() {
        let statements = build_add_table_column_statements(
            DatabaseKind::Postgres,
            "public",
            "users",
            &CreateTableColumn {
                name: "metadata".to_string(),
                data_type: "JSONB".to_string(),
                length: None,
                is_primary_key: false,
                is_not_null: true,
                is_auto_increment: false,
                comment: Some("opaque app metadata".to_string()),
            },
        )
        .unwrap();

        assert_eq!(
            statements,
            vec![
                r#"ALTER TABLE "public"."users" ADD COLUMN "metadata" JSONB NOT NULL;"#.to_string(),
                r#"COMMENT ON COLUMN "public"."users"."metadata" IS 'opaque app metadata';"#
                    .to_string(),
            ]
        );
    }

    #[test]
    fn builds_drop_column_statement_per_driver() {
        assert_eq!(
            build_drop_table_column_statement(
                DatabaseKind::Postgres,
                "public",
                "users",
                "legacy",
                true
            )
            .unwrap(),
            r#"ALTER TABLE "public"."users" DROP COLUMN "legacy" CASCADE;"#
        );
        assert_eq!(
            build_drop_table_column_statement(DatabaseKind::Mysql, "app", "users", "legacy", true)
                .unwrap(),
            "ALTER TABLE `app`.`users` DROP COLUMN `legacy`;"
        );
    }

    #[test]
    fn builds_rename_column_statement_with_existing_columns() {
        let columns = column_lookup(vec![
            ColumnInfo {
                name: "email".to_string(),
                data_type: "text".to_string(),
                is_nullable: false,
                is_primary_key: false,
                is_unique: false,
                is_indexed: false,
                default_value: None,
                is_auto_increment: false,
                comment: None,
            },
            ColumnInfo {
                name: "name".to_string(),
                data_type: "text".to_string(),
                is_nullable: true,
                is_primary_key: false,
                is_unique: false,
                is_indexed: false,
                default_value: None,
                is_auto_increment: false,
                comment: None,
            },
        ]);

        assert_eq!(
            build_rename_table_column_statement(
                DatabaseKind::Postgres,
                "public",
                "users",
                "email",
                "login_email",
                &columns,
            )
            .unwrap(),
            r#"ALTER TABLE "public"."users" RENAME COLUMN "email" TO "login_email";"#
        );
        assert!(build_rename_table_column_statement(
            DatabaseKind::Mysql,
            "app",
            "users",
            "email",
            "name",
            &columns,
        )
        .is_err());
    }

    #[test]
    fn builds_postgres_alter_column_statements() {
        let columns = column_lookup(vec![ColumnInfo {
            name: "email".to_string(),
            data_type: "text".to_string(),
            is_nullable: true,
            is_primary_key: false,
            is_unique: false,
            is_indexed: false,
            default_value: None,
            is_auto_increment: false,
            comment: None,
        }]);

        let statements = build_alter_table_column_statements(
            DatabaseKind::Postgres,
            "public",
            "users",
            &AlterTableColumn {
                name: "email".to_string(),
                data_type: Some("VARCHAR".to_string()),
                length: Some("320".to_string()),
                is_not_null: Some(true),
                default_mode: Some(AlterColumnValueMode::Set),
                default_value: Some("'unknown@example.com'".to_string()),
                comment_mode: Some(AlterColumnValueMode::Set),
                comment: Some("login email".to_string()),
            },
            &columns,
        )
        .unwrap();

        assert_eq!(
            statements,
            vec![
                r#"ALTER TABLE "public"."users" ALTER COLUMN "email" TYPE VARCHAR(320);"#
                    .to_string(),
                r#"ALTER TABLE "public"."users" ALTER COLUMN "email" SET NOT NULL;"#
                    .to_string(),
                r#"ALTER TABLE "public"."users" ALTER COLUMN "email" SET DEFAULT 'unknown@example.com';"#
                    .to_string(),
                r#"COMMENT ON COLUMN "public"."users"."email" IS 'login email';"#.to_string(),
            ]
        );
    }

    #[test]
    fn builds_mysql_alter_column_preserving_definition() {
        let columns = column_lookup(vec![ColumnInfo {
            name: "id".to_string(),
            data_type: "int unsigned".to_string(),
            is_nullable: false,
            is_primary_key: true,
            is_unique: true,
            is_indexed: true,
            default_value: None,
            is_auto_increment: true,
            comment: Some("identifier".to_string()),
        }]);

        let statements = build_alter_table_column_statements(
            DatabaseKind::Mysql,
            "app",
            "users",
            &AlterTableColumn {
                name: "id".to_string(),
                data_type: Some("BIGINT".to_string()),
                length: None,
                is_not_null: Some(true),
                default_mode: Some(AlterColumnValueMode::Keep),
                default_value: None,
                comment_mode: Some(AlterColumnValueMode::Set),
                comment: Some("stable identifier".to_string()),
            },
            &columns,
        )
        .unwrap();

        assert_eq!(
            statements,
            vec![
                "ALTER TABLE `app`.`users` MODIFY COLUMN `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT 'stable identifier';".to_string()
            ]
        );
    }

    #[test]
    fn builds_create_index_statement_with_existing_columns() {
        let columns = column_lookup(vec![
            ColumnInfo {
                name: "email".to_string(),
                data_type: "text".to_string(),
                is_nullable: false,
                is_primary_key: false,
                is_unique: false,
                is_indexed: false,
                default_value: None,
                is_auto_increment: false,
                comment: None,
            },
            ColumnInfo {
                name: "tenant_id".to_string(),
                data_type: "integer".to_string(),
                is_nullable: false,
                is_primary_key: false,
                is_unique: false,
                is_indexed: false,
                default_value: None,
                is_auto_increment: false,
                comment: None,
            },
        ]);

        assert_eq!(
            build_create_table_index_statement(
                DatabaseKind::Postgres,
                "public",
                "users",
                "users_email_idx",
                &["email".to_string()],
                &columns,
                true,
            )
            .unwrap(),
            r#"CREATE UNIQUE INDEX "users_email_idx" ON "public"."users" ("email");"#
        );
        assert_eq!(
            build_create_table_index_statement(
                DatabaseKind::Mysql,
                "app",
                "users",
                "users_tenant_email_idx",
                &["tenant_id".to_string(), "email".to_string()],
                &columns,
                false,
            )
            .unwrap(),
            "CREATE INDEX `users_tenant_email_idx` ON `app`.`users` (`tenant_id`, `email`);"
        );
    }

    #[test]
    fn rejects_create_index_for_unknown_columns() {
        let columns = column_lookup(vec![ColumnInfo {
            name: "email".to_string(),
            data_type: "text".to_string(),
            is_nullable: false,
            is_primary_key: false,
            is_unique: false,
            is_indexed: false,
            default_value: None,
            is_auto_increment: false,
            comment: None,
        }]);

        assert!(build_create_table_index_statement(
            DatabaseKind::Postgres,
            "public",
            "users",
            "users_missing_idx",
            &["missing".to_string()],
            &columns,
            false,
        )
        .is_err());
    }

    #[test]
    fn builds_drop_index_statement_per_driver() {
        assert_eq!(
            build_drop_table_index_statement(
                DatabaseKind::Postgres,
                "public",
                "users",
                "users_email_idx"
            )
            .unwrap(),
            r#"DROP INDEX "public"."users_email_idx";"#
        );
        assert_eq!(
            build_drop_table_index_statement(
                DatabaseKind::Mysql,
                "app",
                "users",
                "users_email_idx"
            )
            .unwrap(),
            "DROP INDEX `users_email_idx` ON `app`.`users`;"
        );
        assert!(
            build_drop_table_index_statement(DatabaseKind::Mysql, "app", "users", "PRIMARY")
                .is_err()
        );
    }

    #[test]
    fn builds_rename_index_statement_per_driver() {
        let indexes = vec![
            IndexInfo {
                name: "users_email_idx".to_string(),
                columns: vec!["email".to_string()],
                is_unique: false,
                is_primary: false,
                index_type: Some("btree".to_string()),
                definition: None,
            },
            IndexInfo {
                name: "users_pkey".to_string(),
                columns: vec!["id".to_string()],
                is_unique: true,
                is_primary: true,
                index_type: Some("btree".to_string()),
                definition: None,
            },
        ];

        assert_eq!(
            build_rename_table_index_statement(
                DatabaseKind::Postgres,
                "public",
                "users",
                "users_email_idx",
                "users_login_email_idx",
                &indexes,
            )
            .unwrap(),
            r#"ALTER INDEX "public"."users_email_idx" RENAME TO "users_login_email_idx";"#
        );
        assert_eq!(
            build_rename_table_index_statement(
                DatabaseKind::Mysql,
                "app",
                "users",
                "users_email_idx",
                "users_login_email_idx",
                &indexes,
            )
            .unwrap(),
            "ALTER TABLE `app`.`users` RENAME INDEX `users_email_idx` TO `users_login_email_idx`;"
        );
        assert!(build_rename_table_index_statement(
            DatabaseKind::Postgres,
            "public",
            "users",
            "users_pkey",
            "users_id_idx",
            &indexes,
        )
        .is_err());
    }

    #[test]
    fn builds_unique_constraint_statement_with_existing_columns() {
        let columns = column_lookup(vec![ColumnInfo {
            name: "email".to_string(),
            data_type: "text".to_string(),
            is_nullable: false,
            is_primary_key: false,
            is_unique: false,
            is_indexed: false,
            default_value: None,
            is_auto_increment: false,
            comment: None,
        }]);

        assert_eq!(
            build_create_unique_constraint_statement(
                DatabaseKind::Postgres,
                "public",
                "users",
                "users_email_key",
                &["email".to_string()],
                &columns,
            )
            .unwrap(),
            r#"ALTER TABLE "public"."users" ADD CONSTRAINT "users_email_key" UNIQUE ("email");"#
        );
    }

    #[test]
    fn builds_primary_key_constraint_statement_with_existing_columns() {
        let columns = column_lookup(vec![ColumnInfo {
            name: "id".to_string(),
            data_type: "integer".to_string(),
            is_nullable: false,
            is_primary_key: false,
            is_unique: false,
            is_indexed: false,
            default_value: None,
            is_auto_increment: false,
            comment: None,
        }]);

        assert_eq!(
            build_create_primary_key_statement(
                DatabaseKind::Postgres,
                "public",
                "users",
                "users_pkey",
                &["id".to_string()],
                &columns,
            )
            .unwrap(),
            r#"ALTER TABLE "public"."users" ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");"#
        );
    }

    #[test]
    fn rejects_primary_key_constraint_on_nullable_columns() {
        let columns = column_lookup(vec![ColumnInfo {
            name: "id".to_string(),
            data_type: "integer".to_string(),
            is_nullable: true,
            is_primary_key: false,
            is_unique: false,
            is_indexed: false,
            default_value: None,
            is_auto_increment: false,
            comment: None,
        }]);

        assert!(build_create_primary_key_statement(
            DatabaseKind::Mysql,
            "app",
            "users",
            "users_pkey",
            &["id".to_string()],
            &columns,
        )
        .is_err());
    }

    #[test]
    fn builds_check_constraint_statement() {
        assert_eq!(
            build_create_check_constraint_statement(
                DatabaseKind::Mysql,
                "app",
                "orders",
                "orders_amount_check",
                "amount >= 0",
            )
            .unwrap(),
            "ALTER TABLE `app`.`orders` ADD CONSTRAINT `orders_amount_check` CHECK (amount >= 0);"
        );
        assert!(build_create_check_constraint_statement(
            DatabaseKind::Postgres,
            "public",
            "orders",
            "bad_check",
            "amount >= 0; DROP TABLE orders",
        )
        .is_err());
    }

    #[test]
    fn builds_foreign_key_statement_with_referential_actions() {
        let local_columns = column_lookup(vec![ColumnInfo {
            name: "user_id".to_string(),
            data_type: "integer".to_string(),
            is_nullable: false,
            is_primary_key: false,
            is_unique: false,
            is_indexed: false,
            default_value: None,
            is_auto_increment: false,
            comment: None,
        }]);
        let referenced_columns = column_lookup(vec![ColumnInfo {
            name: "id".to_string(),
            data_type: "integer".to_string(),
            is_nullable: false,
            is_primary_key: true,
            is_unique: true,
            is_indexed: true,
            default_value: None,
            is_auto_increment: false,
            comment: None,
        }]);

        assert_eq!(
            build_create_foreign_key_statement(
                DatabaseKind::Mysql,
                "app",
                "orders",
                "orders_user_id_fkey",
                &["user_id".to_string()],
                &local_columns,
                "app",
                "users",
                &["id".to_string()],
                &referenced_columns,
                Some("cascade"),
                Some("restrict"),
            )
            .unwrap(),
            "ALTER TABLE `app`.`orders` ADD CONSTRAINT `orders_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `app`.`users` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT;"
        );
        assert!(build_create_foreign_key_statement(
            DatabaseKind::Postgres,
            "public",
            "orders",
            "orders_bad_fkey",
            &["user_id".to_string()],
            &local_columns,
            "public",
            "users",
            &["id".to_string(), "email".to_string()],
            &referenced_columns,
            None,
            None,
        )
        .is_err());
    }

    #[test]
    fn builds_drop_constraint_statement_per_driver() {
        let foreign_key = ConstraintInfo {
            name: "orders_user_id_fkey".to_string(),
            constraint_type: "FOREIGN KEY".to_string(),
            columns: vec!["user_id".to_string()],
            referenced_schema: Some("public".to_string()),
            referenced_table: Some("users".to_string()),
            referenced_columns: vec!["id".to_string()],
            definition: None,
        };
        let unique = ConstraintInfo {
            name: "users_email_key".to_string(),
            constraint_type: "UNIQUE".to_string(),
            columns: vec!["email".to_string()],
            referenced_schema: None,
            referenced_table: None,
            referenced_columns: vec![],
            definition: None,
        };
        let primary = ConstraintInfo {
            name: "users_pkey".to_string(),
            constraint_type: "PRIMARY KEY".to_string(),
            columns: vec!["id".to_string()],
            referenced_schema: None,
            referenced_table: None,
            referenced_columns: vec![],
            definition: None,
        };

        assert_eq!(
            build_drop_table_constraint_statement(
                DatabaseKind::Postgres,
                "public",
                "orders",
                &foreign_key
            )
            .unwrap(),
            r#"ALTER TABLE "public"."orders" DROP CONSTRAINT "orders_user_id_fkey";"#
        );
        assert_eq!(
            build_drop_table_constraint_statement(
                DatabaseKind::Mysql,
                "app",
                "orders",
                &foreign_key
            )
            .unwrap(),
            "ALTER TABLE `app`.`orders` DROP FOREIGN KEY `orders_user_id_fkey`;"
        );
        assert_eq!(
            build_drop_table_constraint_statement(DatabaseKind::Mysql, "app", "users", &unique)
                .unwrap(),
            "ALTER TABLE `app`.`users` DROP INDEX `users_email_key`;"
        );
        assert_eq!(
            build_drop_table_constraint_statement(
                DatabaseKind::Postgres,
                "public",
                "users",
                &primary
            )
            .unwrap(),
            r#"ALTER TABLE "public"."users" DROP CONSTRAINT "users_pkey";"#
        );
        assert_eq!(
            build_drop_table_constraint_statement(DatabaseKind::Mysql, "app", "users", &primary)
                .unwrap(),
            "ALTER TABLE `app`.`users` DROP PRIMARY KEY;"
        );
    }
}
