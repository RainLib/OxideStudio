//! Ddl columns for table operations.

use super::ddl_types::{AlterColumnValueMode, AlterTableColumn, CreateTableColumn};
use super::export_sql::sql_string_literal;
use super::limits::MAX_DEFAULT_EXPRESSION_BYTES;
use super::policy::schema_option;
use super::row_sql::column_for;
use super::sqlite_ddl::sqlite_qualified_relation;
use crate::core::dialect::DatabaseKind;
use crate::core::protocol::ColumnInfo;
use std::collections::BTreeMap;

pub(super) fn mysql_comment_literal(value: &str) -> String {
    format!("'{}'", value.replace('\\', "\\\\").replace('\'', "\\'"))
}

pub(super) fn normalize_data_type(value: &str) -> String {
    value.trim().to_ascii_uppercase()
}

pub(super) fn validate_column_length(value: &str) -> Result<(), String> {
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

pub(super) fn render_column_type(column: &CreateTableColumn) -> Result<String, String> {
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

#[derive(Debug, Clone, Copy, Default)]
pub(super) struct TableColumnRenderOptions<'a> {
    pub(super) default_value: Option<&'a str>,
    pub(super) identity_generation: Option<&'a str>,
    pub(super) inline_primary_key: bool,
}

pub(super) fn render_table_column_definition(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    column: &CreateTableColumn,
    options: TableColumnRenderOptions<'_>,
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

    if column.is_auto_increment && options.default_value.is_some() {
        return Err(format!(
            "Column {column_name} cannot combine a copied default with a target-owned identity"
        ));
    }
    if let Some(default_value) = options.default_value {
        definition.push_str(" DEFAULT ");
        definition.push_str(validate_default_expression(default_value)?);
    }

    let identity_generation = match options.identity_generation {
        Some(_value) if !column.is_auto_increment => {
            return Err(format!(
                "Column {column_name} has an identity mode without target identity semantics"
            ));
        }
        Some(_value) if kind != DatabaseKind::Postgres => {
            return Err(format!(
                "Column {column_name} cannot apply a PostgreSQL identity mode to {kind:?}"
            ));
        }
        Some(value) if value.eq_ignore_ascii_case("always") => Some("always"),
        Some(value)
            if value.eq_ignore_ascii_case("byDefault")
                || value.eq_ignore_ascii_case("by_default") =>
        {
            Some("byDefault")
        }
        Some(value) => {
            return Err(format!(
                "Column {column_name} has unsupported identity generation mode: {value}"
            ));
        }
        None => None,
    };

    if column.is_auto_increment {
        let clause = if identity_generation == Some("always") {
            kind.auto_increment_clause_for_type(&data_type)
                .map_err(|err| err.to_string())?
                .map(|_| "GENERATED ALWAYS AS IDENTITY")
        } else {
            kind.auto_increment_clause_for_type(&data_type)
                .map_err(|err| err.to_string())?
        };
        if let Some(clause) = clause {
            definition.push(' ');
            definition.push_str(clause.trim());
        }
    }

    if column.is_not_null {
        definition.push_str(" NOT NULL");
    }

    if options.inline_primary_key && column.is_primary_key {
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

pub(super) fn build_create_table_statements(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    columns: &[CreateTableColumn],
) -> Result<Vec<String>, String> {
    build_create_table_statements_with_defaults(kind, schema, table, columns, &BTreeMap::new())
}

pub(super) fn build_create_table_statements_with_defaults(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    columns: &[CreateTableColumn],
    default_expressions: &BTreeMap<String, String>,
) -> Result<Vec<String>, String> {
    build_create_table_statements_with_transfer_metadata(
        kind,
        schema,
        table,
        columns,
        default_expressions,
        &BTreeMap::new(),
    )
}

pub(super) fn build_create_table_statements_with_transfer_metadata(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    columns: &[CreateTableColumn],
    default_expressions: &BTreeMap<String, String>,
    identity_generations: &BTreeMap<String, String>,
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
            TableColumnRenderOptions {
                default_value: default_expressions.get(&column.name).map(String::as_str),
                identity_generation: identity_generations.get(&column.name).map(String::as_str),
                inline_primary_key: false,
            },
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

pub(super) fn strip_leading_view_query_comments(mut sql: &str) -> Result<&str, String> {
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

pub(super) fn normalize_view_select_sql(sql: &str) -> Result<String, String> {
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

pub(super) fn build_create_view_statement(
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

pub(super) fn build_sqlite_create_view_statement(
    schema: &str,
    view: &str,
    select_sql: &str,
    replace: bool,
) -> Result<String, String> {
    if replace {
        return Err("SQLite does not support CREATE OR REPLACE VIEW".to_string());
    }
    let select_sql = normalize_view_select_sql(select_sql)?;
    Ok(format!(
        "CREATE VIEW {} AS {};",
        sqlite_qualified_relation(schema, view)?,
        select_sql,
    ))
}

pub(super) fn build_create_materialized_view_statement(
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

pub(super) fn build_add_table_column_statements(
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
    let (definition, _) = render_table_column_definition(
        kind,
        schema,
        table,
        column,
        TableColumnRenderOptions {
            inline_primary_key: true,
            ..TableColumnRenderOptions::default()
        },
        &mut comment_statements,
    )?;

    let mut statements = vec![format!(
        "ALTER TABLE {} ADD COLUMN {};",
        kind.qualified_table(schema_option(schema), table),
        definition
    )];
    statements.extend(comment_statements);
    Ok(statements)
}

pub(super) fn build_drop_table_column_statement(
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

pub(super) fn build_rename_table_column_statement(
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

pub(super) fn parse_data_type_input(value: &str) -> (String, Option<String>) {
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

pub(super) fn render_alter_column_type(
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

pub(super) fn validate_default_expression(value: &str) -> Result<&str, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("Default value is required when default mode is set".to_string());
    }
    if value.len() > MAX_DEFAULT_EXPRESSION_BYTES {
        return Err(format!(
            "Default value exceeds the {} byte review limit",
            MAX_DEFAULT_EXPRESSION_BYTES
        ));
    }

    let bytes = value.as_bytes();
    let mut index = 0usize;
    let mut quote: Option<u8> = None;
    let mut bracket_identifier = false;
    let mut parentheses = 0usize;
    while index < bytes.len() {
        let current = bytes[index];
        let next = bytes.get(index + 1).copied();
        if bracket_identifier {
            if current == b']' {
                if next == Some(b']') {
                    index += 2;
                    continue;
                }
                bracket_identifier = false;
            }
            index += 1;
            continue;
        }
        if let Some(delimiter) = quote {
            if current == delimiter {
                if next == Some(delimiter) {
                    index += 2;
                    continue;
                }
                quote = None;
            }
            index += 1;
            continue;
        }

        if current == b'-' && next == Some(b'-')
            || current == b'/' && next == Some(b'*')
            || current == b'*' && next == Some(b'/')
            || current == b';'
        {
            return Err(
                "Default value cannot contain statement separators or comments".to_string(),
            );
        }
        match current {
            b'\'' | b'"' | b'`' => quote = Some(current),
            b'[' => bracket_identifier = true,
            b'(' => parentheses += 1,
            b')' => {
                if parentheses == 0 {
                    return Err(
                        "Default value contains an unmatched closing parenthesis".to_string()
                    );
                }
                parentheses -= 1;
            }
            0 => return Err("Default value cannot contain NUL bytes".to_string()),
            byte if byte.is_ascii_control() && !byte.is_ascii_whitespace() => {
                return Err("Default value contains unsupported control characters".to_string());
            }
            _ => {}
        }
        index += 1;
    }
    if quote.is_some() || bracket_identifier {
        return Err("Default value contains an unterminated quoted region".to_string());
    }
    if parentheses != 0 {
        return Err("Default value contains unbalanced parentheses".to_string());
    }
    Ok(value)
}

pub(super) fn build_alter_table_column_statements(
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
