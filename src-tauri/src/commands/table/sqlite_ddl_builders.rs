//! Sqlite ddl builders for table operations.

use super::ddl_columns::{normalize_data_type, render_column_type, validate_default_expression};
use super::ddl_types::CreateTableColumn;
use super::sqlite_ddl::{sqlite_qualified_relation, sqlite_quote_identifier};
use crate::core::dialect::database_spec_for_driver;
use crate::core::protocol::ColumnInfo;
use std::collections::BTreeMap;
use std::collections::HashSet;

pub(super) fn sqlite_column_definition(
    column: &CreateTableColumn,
    default_value: Option<&str>,
    allow_primary_key: bool,
) -> Result<(String, String), String> {
    let name = column.name.trim();
    if name.is_empty() {
        return Err("All columns must have a name".to_string());
    }
    let data_type = normalize_data_type(&column.data_type);
    let sqlite = database_spec_for_driver("sqlite").expect("SQLite dialect is registered");
    if !sqlite
        .common_data_types
        .iter()
        .any(|supported| normalize_data_type(supported) == data_type)
    {
        return Err(format!(
            "Unsupported SQLite data type: {}",
            column.data_type
        ));
    }
    if column
        .comment
        .as_deref()
        .is_some_and(|comment| !comment.trim().is_empty())
    {
        return Err("SQLite does not support column comments".to_string());
    }
    if !allow_primary_key && (column.is_primary_key || column.is_auto_increment) {
        return Err(
            "SQLite cannot add a primary-key or AUTOINCREMENT column to an existing table"
                .to_string(),
        );
    }
    if column.is_auto_increment && (!column.is_primary_key || data_type != "INTEGER") {
        return Err(
            "SQLite AUTOINCREMENT requires a single INTEGER PRIMARY KEY column".to_string(),
        );
    }

    let mut definition = format!(
        "{} {}",
        sqlite_quote_identifier(name),
        render_column_type(column)?
    );
    if column.is_auto_increment && default_value.is_some() {
        return Err(format!(
            "Column {name} cannot combine a copied default with SQLite AUTOINCREMENT"
        ));
    }
    if let Some(default_value) = default_value {
        definition.push_str(" DEFAULT ");
        definition.push_str(validate_default_expression(default_value)?);
    }
    if column.is_primary_key {
        definition.push_str(" PRIMARY KEY");
    }
    if column.is_auto_increment {
        definition.push_str(" AUTOINCREMENT");
    }
    if column.is_not_null && !column.is_primary_key {
        definition.push_str(" NOT NULL");
    }
    Ok((definition, name.to_string()))
}

pub(super) fn build_sqlite_create_table_statements(
    schema: &str,
    table: &str,
    columns: &[CreateTableColumn],
) -> Result<Vec<String>, String> {
    build_sqlite_create_table_statements_with_defaults(schema, table, columns, &BTreeMap::new())
}

pub(super) fn build_sqlite_create_table_statements_with_defaults(
    schema: &str,
    table: &str,
    columns: &[CreateTableColumn],
    default_expressions: &BTreeMap<String, String>,
) -> Result<Vec<String>, String> {
    if columns.is_empty() {
        return Err("At least one column is required".to_string());
    }
    let table = sqlite_qualified_relation(schema, table)?;
    let primary_key_count = columns
        .iter()
        .filter(|column| column.is_primary_key)
        .count();
    if primary_key_count > 1 && columns.iter().any(|column| column.is_auto_increment) {
        return Err("SQLite AUTOINCREMENT cannot be used with a composite primary key".to_string());
    }
    let mut definitions = Vec::with_capacity(columns.len() + 1);
    let mut primary_keys = Vec::new();
    for column in columns {
        let mut rendered_column = column.clone();
        if primary_key_count > 1 {
            rendered_column.is_primary_key = false;
        }
        let (definition, name) = sqlite_column_definition(
            &rendered_column,
            default_expressions.get(&column.name).map(String::as_str),
            true,
        )?;
        if column.is_primary_key && primary_key_count > 1 {
            primary_keys.push(name);
        }
        definitions.push(definition);
    }
    if primary_keys.len() > 1 {
        let keys = primary_keys
            .iter()
            .map(|name| sqlite_quote_identifier(name))
            .collect::<Vec<_>>()
            .join(", ");
        definitions.push(format!("PRIMARY KEY ({keys})"));
    }
    Ok(vec![format!(
        "CREATE TABLE {table} (\n  {}\n);",
        definitions.join(",\n  ")
    )])
}

pub(super) fn build_sqlite_add_column_statements(
    schema: &str,
    table: &str,
    column: &CreateTableColumn,
) -> Result<Vec<String>, String> {
    let table = sqlite_qualified_relation(schema, table)?;
    let (definition, _) = sqlite_column_definition(column, None, false)?;
    Ok(vec![format!(
        "ALTER TABLE {table} ADD COLUMN {definition};"
    )])
}

pub(super) fn build_sqlite_drop_column_statement(
    schema: &str,
    table: &str,
    column: &str,
) -> Result<String, String> {
    let column = column.trim();
    if column.is_empty() {
        return Err("Column name is required".to_string());
    }
    Ok(format!(
        "ALTER TABLE {} DROP COLUMN {};",
        sqlite_qualified_relation(schema, table)?,
        sqlite_quote_identifier(column),
    ))
}

pub(super) fn build_sqlite_rename_column_statement(
    schema: &str,
    table: &str,
    old_name: &str,
    new_name: &str,
    existing_columns: &BTreeMap<String, ColumnInfo>,
) -> Result<String, String> {
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
    Ok(format!(
        "ALTER TABLE {} RENAME COLUMN {} TO {};",
        sqlite_qualified_relation(schema, table)?,
        sqlite_quote_identifier(old_name),
        sqlite_quote_identifier(new_name),
    ))
}

pub(super) fn validated_sqlite_index_columns(
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
        Err("At least one index column is required".to_string())
    } else {
        Ok(validated)
    }
}

pub(super) fn build_sqlite_create_index_statement(
    schema: &str,
    table: &str,
    index: &str,
    columns: &[String],
    existing_columns: &BTreeMap<String, ColumnInfo>,
    unique: bool,
) -> Result<String, String> {
    let index = index.trim();
    if index.is_empty() {
        return Err("Index name is required".to_string());
    }
    let columns = validated_sqlite_index_columns(columns, existing_columns)?;
    let schema = schema.trim();
    let index = if schema.is_empty() {
        sqlite_quote_identifier(index)
    } else {
        format!(
            "{}.{}",
            sqlite_quote_identifier(schema),
            sqlite_quote_identifier(index)
        )
    };
    let columns = columns
        .iter()
        .map(|column| sqlite_quote_identifier(column))
        .collect::<Vec<_>>()
        .join(", ");
    Ok(format!(
        "CREATE {}INDEX {index} ON {} ({columns});",
        if unique { "UNIQUE " } else { "" },
        sqlite_qualified_relation(schema, table)?,
    ))
}

pub(super) fn build_sqlite_drop_index_statement(
    schema: &str,
    table: &str,
    index: &str,
) -> Result<String, String> {
    let index = index.trim();
    if index.is_empty() {
        return Err("Index name is required".to_string());
    }
    if index.eq_ignore_ascii_case("PRIMARY") {
        return Err("Primary key indexes must be changed through table definition".to_string());
    }
    // Validate the relation even though SQLite's DROP INDEX syntax does not
    // repeat it; this keeps the command's safety boundary consistent.
    let _ = sqlite_qualified_relation(schema, table)?;
    let index = if schema.trim().is_empty() {
        sqlite_quote_identifier(index)
    } else {
        format!(
            "{}.{}",
            sqlite_quote_identifier(schema),
            sqlite_quote_identifier(index)
        )
    };
    Ok(format!("DROP INDEX {index};"))
}
