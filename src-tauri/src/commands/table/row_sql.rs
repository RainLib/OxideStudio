//! Row sql for table operations.

use super::policy::schema_option;
use super::row_types::{
    TableFilter, TableMutationResult, TableRowDelete, TableRowUpdate, TableSort,
};
use crate::core::dialect::DatabaseKind;
use crate::core::protocol::ColumnInfo;
use crate::core::protocol::QueryParameter;
use crate::core::statement::validate_sql_filter_expression;
use crate::core::statement::StatementScanDialect;
use serde_json::Value;
use std::collections::BTreeMap;

pub(super) fn column_lookup(columns: Vec<ColumnInfo>) -> BTreeMap<String, ColumnInfo> {
    columns
        .into_iter()
        .map(|column| (column.name.clone(), column))
        .collect()
}

pub(super) fn column_for<'a>(
    columns: &'a BTreeMap<String, ColumnInfo>,
    column: &str,
) -> Result<&'a ColumnInfo, String> {
    columns
        .get(column)
        .ok_or_else(|| format!("Unknown column: {column}"))
}

/// Generated and hidden columns are database-owned values. They can be used
/// to identify or filter a row, but never as an INSERT/UPDATE assignment.
pub(super) fn writable_column_for<'a>(
    columns: &'a BTreeMap<String, ColumnInfo>,
    column_name: &str,
) -> Result<&'a ColumnInfo, String> {
    let column = column_for(columns, column_name)?;
    if column.is_hidden.is_none() || column.is_generated.is_none() {
        return Err(format!(
            "Column {column_name} cannot be written because generated/hidden metadata is unavailable"
        ));
    }
    if column.is_hidden == Some(true) {
        return Err(format!("Hidden column {column_name} cannot be written"));
    }
    if column.is_generated == Some(true) {
        return Err(format!("Generated column {column_name} cannot be written"));
    }
    Ok(column)
}

pub(super) fn query_parameter(column: &ColumnInfo, value: &Value) -> QueryParameter {
    QueryParameter {
        value: value.clone(),
        data_type: Some(column.data_type.clone()),
    }
}

pub(super) fn text_query_parameter(value: String) -> QueryParameter {
    QueryParameter {
        value: Value::String(value),
        data_type: Some("text".to_string()),
    }
}

pub(super) fn escape_like_value(value: &str) -> String {
    let mut escaped = String::new();
    for ch in value.chars() {
        if matches!(ch, '=' | '%' | '_') {
            escaped.push('=');
        }
        escaped.push(ch);
    }
    escaped
}

pub(super) fn build_structured_filter_where(
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

pub(super) fn build_table_order_by(
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

/// Render one target column under the reviewed transfer policy. Even when
/// Gauss-compatible quoting is disabled, unsafe and reserved identifiers stay
/// quoted so the option cannot turn metadata into executable SQL syntax.
pub(super) fn transfer_column_identifier(
    kind: DatabaseKind,
    identifier: &str,
    quote_column_names: bool,
) -> String {
    let mut characters = identifier.chars();
    let is_simple = characters
        .next()
        .is_some_and(|first| first == '_' || first.is_ascii_alphabetic())
        && characters.all(|character| {
            character == '_' || character == '$' || character.is_ascii_alphanumeric()
        });
    let normalized = identifier.to_ascii_lowercase();
    let is_postgres_reserved = matches!(
        normalized.as_str(),
        "all"
            | "analyse"
            | "analyze"
            | "and"
            | "any"
            | "array"
            | "as"
            | "asc"
            | "asymmetric"
            | "authorization"
            | "binary"
            | "both"
            | "case"
            | "cast"
            | "check"
            | "collate"
            | "collation"
            | "column"
            | "concurrently"
            | "constraint"
            | "create"
            | "cross"
            | "current_catalog"
            | "current_date"
            | "current_role"
            | "current_schema"
            | "current_time"
            | "current_timestamp"
            | "current_user"
            | "default"
            | "deferrable"
            | "desc"
            | "distinct"
            | "do"
            | "else"
            | "end"
            | "except"
            | "false"
            | "fetch"
            | "for"
            | "foreign"
            | "freeze"
            | "from"
            | "full"
            | "grant"
            | "group"
            | "having"
            | "ilike"
            | "in"
            | "initially"
            | "inner"
            | "intersect"
            | "into"
            | "is"
            | "isnull"
            | "join"
            | "lateral"
            | "leading"
            | "left"
            | "like"
            | "limit"
            | "localtime"
            | "localtimestamp"
            | "natural"
            | "not"
            | "notnull"
            | "null"
            | "offset"
            | "on"
            | "only"
            | "or"
            | "order"
            | "outer"
            | "overlaps"
            | "placing"
            | "primary"
            | "references"
            | "returning"
            | "right"
            | "select"
            | "session_user"
            | "similar"
            | "some"
            | "symmetric"
            | "system_user"
            | "table"
            | "tablesample"
            | "then"
            | "to"
            | "trailing"
            | "true"
            | "union"
            | "unique"
            | "user"
            | "using"
            | "variadic"
            | "verbose"
            | "when"
            | "where"
            | "window"
            | "with"
    );
    if quote_column_names || kind != DatabaseKind::Postgres || !is_simple || is_postgres_reserved {
        kind.quote_identifier(identifier)
    } else {
        identifier.to_string()
    }
}

pub(super) fn build_insert_mutation(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    columns: &BTreeMap<String, ColumnInfo>,
    values: &BTreeMap<String, Value>,
) -> Result<(String, Vec<QueryParameter>), String> {
    build_insert_mutation_with_column_quoting(kind, schema, table, columns, values, true)
}

pub(super) fn build_insert_mutation_with_column_quoting(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    columns: &BTreeMap<String, ColumnInfo>,
    values: &BTreeMap<String, Value>,
    quote_column_names: bool,
) -> Result<(String, Vec<QueryParameter>), String> {
    validate_insert_values(columns, values)?;

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
        let column = writable_column_for(columns, column_name)?;
        names.push(transfer_column_identifier(
            kind,
            column_name,
            quote_column_names,
        ));
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

#[cfg(test)]
pub(super) fn build_upsert_mutation(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    columns: &BTreeMap<String, ColumnInfo>,
    values: &BTreeMap<String, Value>,
    key_columns: &[String],
) -> Result<(String, Vec<QueryParameter>), String> {
    build_upsert_mutation_with_column_quoting(
        kind,
        schema,
        table,
        columns,
        values,
        key_columns,
        true,
    )
}

#[allow(clippy::too_many_arguments)]
pub(super) fn build_upsert_mutation_with_column_quoting(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    columns: &BTreeMap<String, ColumnInfo>,
    values: &BTreeMap<String, Value>,
    key_columns: &[String],
    quote_column_names: bool,
) -> Result<(String, Vec<QueryParameter>), String> {
    if key_columns.is_empty() {
        return Err("Upsert requires a target primary key".to_string());
    }
    for key in key_columns {
        if !values.keys().any(|column| column.eq_ignore_ascii_case(key)) {
            return Err(format!(
                "Upsert key column {key} is not mapped from the source table"
            ));
        }
    }

    let (insert, params) = build_insert_mutation_with_column_quoting(
        kind,
        schema,
        table,
        columns,
        values,
        quote_column_names,
    )?;
    let insert = insert.trim_end_matches(';');
    let mutable_columns = values
        .keys()
        .filter(|column| {
            !key_columns
                .iter()
                .any(|key| key.eq_ignore_ascii_case(column))
        })
        .collect::<Vec<_>>();

    let sql = match kind {
        DatabaseKind::Postgres => {
            let conflict = key_columns
                .iter()
                .map(|column| transfer_column_identifier(kind, column, quote_column_names))
                .collect::<Vec<_>>()
                .join(", ");
            if mutable_columns.is_empty() {
                format!("{insert} ON CONFLICT ({conflict}) DO NOTHING;")
            } else {
                let updates = mutable_columns
                    .iter()
                    .map(|column| {
                        let identifier =
                            transfer_column_identifier(kind, column, quote_column_names);
                        format!("{identifier} = EXCLUDED.{identifier}")
                    })
                    .collect::<Vec<_>>()
                    .join(", ");
                format!("{insert} ON CONFLICT ({conflict}) DO UPDATE SET {updates};")
            }
        }
        DatabaseKind::Mysql => {
            let updates = if mutable_columns.is_empty() {
                let key = transfer_column_identifier(kind, &key_columns[0], quote_column_names);
                format!("{key} = VALUES({key})")
            } else {
                mutable_columns
                    .iter()
                    .map(|column| {
                        let identifier =
                            transfer_column_identifier(kind, column, quote_column_names);
                        format!("{identifier} = VALUES({identifier})")
                    })
                    .collect::<Vec<_>>()
                    .join(", ")
            };
            format!("{insert} ON DUPLICATE KEY UPDATE {updates};")
        }
    };

    Ok((sql, params))
}

/// Keep import, grid and Agent-originated inserts on the same target-table
/// contract. Client-side CSV validation improves the preview, but it cannot
/// be authoritative: cached metadata can be stale and native JSON imports do
/// not pass through the CSV mapping dialog.
pub(super) fn validate_insert_values(
    columns: &BTreeMap<String, ColumnInfo>,
    values: &BTreeMap<String, Value>,
) -> Result<(), String> {
    for (column_name, value) in values {
        let column = writable_column_for(columns, column_name)?;
        if value.is_null() && !column.is_nullable {
            return Err(format!("Required column {column_name} cannot be NULL"));
        }
    }

    for column in columns.values() {
        if column.is_generated == Some(true) || column.is_hidden == Some(true) {
            continue;
        }
        let has_server_default = column
            .default_value
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty());
        if !column.is_nullable
            && !column.is_auto_increment
            && !has_server_default
            && !values.contains_key(&column.name)
        {
            return Err(format!(
                "Required column {} is not provided and has no server default",
                column.name
            ));
        }
    }

    Ok(())
}

pub(super) fn build_update_mutation(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    columns: &BTreeMap<String, ColumnInfo>,
    update: &TableRowUpdate,
) -> Result<(String, Vec<QueryParameter>), String> {
    if update.values.is_empty() && update.expressions.is_empty() {
        return Err("Update row has no values".to_string());
    }
    if update.key.is_empty() {
        return Err("Update row has no key".to_string());
    }

    let mut params = Vec::new();
    let mut assignments = Vec::new();
    if update
        .values
        .keys()
        .any(|column| update.expressions.contains_key(column))
    {
        return Err("A column cannot use both a value and an SQL expression".to_string());
    }
    for (column_name, value) in &update.values {
        let column = writable_column_for(columns, column_name)?;
        let placeholder = kind.parameter_placeholder(params.len() + 1, &column.data_type);
        assignments.push(format!(
            "{} = {}",
            kind.quote_identifier(column_name),
            placeholder
        ));
        params.push(query_parameter(column, value));
    }
    for (column_name, expression) in &update.expressions {
        writable_column_for(columns, column_name)?;
        let dialect = match kind {
            DatabaseKind::Postgres => StatementScanDialect::Postgres,
            DatabaseKind::Mysql => StatementScanDialect::Mysql,
        };
        let expression = expression.trim();
        if expression.len() > 4_096 {
            return Err("Table cell SQL expressions are limited to 4,096 characters".to_string());
        }
        if expression
            .split_whitespace()
            .next()
            .is_some_and(|word| word.eq_ignore_ascii_case("WHERE"))
        {
            return Err("Table cell SQL expressions must not start with WHERE".to_string());
        }
        validate_sql_filter_expression(expression, dialect)
            .map_err(|error| format!("Invalid table cell SQL expression: {error}"))?;
        assignments.push(format!(
            "{} = {expression}",
            kind.quote_identifier(column_name)
        ));
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

pub(super) fn build_delete_mutation(
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

pub(super) fn build_key_predicate(
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

pub(super) fn summarize_mutation_affected(
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
