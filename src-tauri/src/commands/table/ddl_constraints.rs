//! Ddl constraints for table operations.

use super::policy::schema_option;
use super::row_sql::column_for;
use crate::core::dialect::DatabaseKind;
use crate::core::protocol::ColumnInfo;
use crate::core::protocol::ConstraintInfo;
use crate::core::protocol::IndexInfo;
use std::collections::BTreeMap;
use std::collections::HashSet;

pub(super) fn build_create_table_index_statement(
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

pub(super) fn build_drop_table_index_statement(
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

pub(super) fn build_rename_table_index_statement(
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

pub(super) fn validate_constraint_name(constraint: &str) -> Result<&str, String> {
    let constraint = constraint.trim();
    if constraint.is_empty() {
        Err("Constraint name is required".to_string())
    } else {
        Ok(constraint)
    }
}

pub(super) fn validate_existing_columns(
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

pub(super) fn validate_referential_action(value: Option<&str>) -> Result<Option<String>, String> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let normalized = value.to_ascii_uppercase().replace('_', " ");
    match normalized.as_str() {
        "NO ACTION" | "RESTRICT" | "CASCADE" | "SET NULL" => Ok(Some(normalized)),
        _ => Err(format!("Unsupported referential action: {value}")),
    }
}

pub(super) fn build_create_unique_constraint_statement(
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

pub(super) fn build_create_primary_key_statement(
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

pub(super) fn validate_check_expression(expression: &str) -> Result<&str, String> {
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

pub(super) fn build_create_check_constraint_statement(
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
pub(super) fn build_create_foreign_key_statement(
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

pub(super) fn build_drop_table_constraint_statement(
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
