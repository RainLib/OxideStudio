//! Export sql for table operations.

use super::export_types::SqlInsertConflictPolicy;
use super::limits::{
    SQL_EXPORT_INSERT_BATCH_ROWS, SQL_EXPORT_MAX_INSERT_BATCH_ROWS,
    SQL_EXPORT_TARGET_STATEMENT_BYTES,
};
use super::policy::schema_option;
use crate::core::dialect::canonical_driver_name;
use crate::core::dialect::DatabaseKind;
use crate::core::protocol::ColumnDef;
use serde_json::Value;
use std::collections::HashSet;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SqlExportDialect {
    DuckDb,
    Mysql,
    Postgres,
    Sqlite,
    Standard,
}

pub(super) fn sql_export_dialect(driver: &str, kind: DatabaseKind) -> SqlExportDialect {
    match canonical_driver_name(driver) {
        Some("postgres") => SqlExportDialect::Postgres,
        Some("mysql") => SqlExportDialect::Mysql,
        Some("sqlite") => SqlExportDialect::Sqlite,
        Some("duckdb") => SqlExportDialect::DuckDb,
        _ if kind == DatabaseKind::Mysql => SqlExportDialect::Mysql,
        _ => SqlExportDialect::Standard,
    }
}

pub(super) fn sql_export_literal(
    dialect: SqlExportDialect,
    value: &Value,
    data_type: Option<&str>,
) -> String {
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
        Value::String(value) => {
            if dialect == SqlExportDialect::Mysql
                && data_type.is_some_and(is_mysql_binary_export_type)
                && mysql_hex_literal(value)
            {
                return value.to_ascii_uppercase();
            }
            if dialect == SqlExportDialect::Postgres
                && data_type.is_some_and(is_postgres_bytea_export_type)
            {
                if let Some(hex) = value.strip_prefix("\\x").filter(|hex| is_even_hex(hex)) {
                    return format!("decode('{}', 'hex')", hex.to_ascii_lowercase());
                }
            }
            if dialect == SqlExportDialect::Sqlite {
                if let Some(hex) = value
                    .strip_prefix("0x")
                    .or_else(|| value.strip_prefix("0X"))
                    .filter(|hex| is_even_hex(hex))
                    .filter(|_| data_type.is_some_and(is_sqlite_blob_export_type))
                {
                    return format!("X'{}'", hex.to_ascii_uppercase());
                }
            }
            sql_string_literal_for_dialect(dialect, value)
        }
        Value::Array(values) if dialect == SqlExportDialect::Postgres => data_type
            .filter(|data_type| is_postgres_array_export_type(data_type))
            .map_or_else(
                || {
                    sql_string_literal_for_dialect(
                        dialect,
                        &serde_json::to_string(value).unwrap_or_default(),
                    )
                },
                |data_type| postgres_array_export_literal(values, data_type),
            ),
        Value::Array(_) | Value::Object(_) => sql_string_literal_for_dialect(
            dialect,
            &serde_json::to_string(value).unwrap_or_default(),
        ),
    }
}

#[derive(Debug, Clone, Copy)]
pub(super) struct SqlInsertExportOptions<'a> {
    pub(super) kind: DatabaseKind,
    pub(super) dialect: SqlExportDialect,
    pub(super) override_system_value: bool,
    pub(super) batch_rows: usize,
    pub(super) conflict_policy: SqlInsertConflictPolicy,
    pub(super) conflict_key_columns: &'a [String],
    pub(super) schema: &'a str,
    pub(super) table: &'a str,
}

pub(super) fn sql_insert_statements(
    options: SqlInsertExportOptions<'_>,
    columns: &[ColumnDef],
    rows: &[Vec<Value>],
) -> Result<Vec<String>, String> {
    if columns.is_empty() || rows.is_empty() {
        return Ok(Vec::new());
    }
    ensure_sql_insert_conflict_policy(options.dialect, options.conflict_policy)?;
    let quoted_columns = columns
        .iter()
        .map(|column| options.kind.quote_identifier(&column.name))
        .collect::<Vec<_>>()
        .join(", ");
    let identity_override =
        if options.override_system_value && options.dialect == SqlExportDialect::Postgres {
            " OVERRIDING SYSTEM VALUE"
        } else {
            ""
        };
    let insert_keyword = match (options.conflict_policy, options.dialect) {
        (SqlInsertConflictPolicy::Skip, SqlExportDialect::Mysql) => "INSERT IGNORE INTO",
        (SqlInsertConflictPolicy::Skip, SqlExportDialect::Sqlite) => "INSERT OR IGNORE INTO",
        _ => "INSERT INTO",
    };
    let conflict_suffix = sql_insert_conflict_suffix(options, columns)?;
    let prefix = format!(
        "{insert_keyword} {} ({quoted_columns}){identity_override} VALUES\n",
        options
            .kind
            .qualified_table(schema_option(options.schema), options.table),
    );
    let mut statements = Vec::new();
    let batch_rows = options
        .batch_rows
        .clamp(1, SQL_EXPORT_MAX_INSERT_BATCH_ROWS);
    let mut tuples = Vec::with_capacity(batch_rows);
    let mut statement_bytes = prefix.len() + conflict_suffix.len() + 1;

    for row in rows {
        let values = format_sql_export_row(options.dialect, columns, row);
        let tuple_bytes = values.len() + usize::from(!tuples.is_empty()) * 2;
        if !tuples.is_empty()
            && (tuples.len() >= batch_rows
                || statement_bytes.saturating_add(tuple_bytes) > SQL_EXPORT_TARGET_STATEMENT_BYTES)
        {
            statements.push(format!("{prefix}{}{conflict_suffix};", tuples.join(",\n")));
            tuples.clear();
            statement_bytes = prefix.len() + conflict_suffix.len() + 1;
        }
        statement_bytes = statement_bytes.saturating_add(values.len());
        if !tuples.is_empty() {
            statement_bytes = statement_bytes.saturating_add(2);
        }
        tuples.push(values);
    }
    if !tuples.is_empty() {
        statements.push(format!("{prefix}{}{conflict_suffix};", tuples.join(",\n")));
    }
    Ok(statements)
}

pub(super) fn sql_insert_conflict_suffix(
    options: SqlInsertExportOptions<'_>,
    columns: &[ColumnDef],
) -> Result<String, String> {
    match options.conflict_policy {
        SqlInsertConflictPolicy::Strict => Ok(String::new()),
        SqlInsertConflictPolicy::Skip if options.dialect == SqlExportDialect::Postgres => {
            Ok(" ON CONFLICT DO NOTHING".to_string())
        }
        SqlInsertConflictPolicy::Skip => Ok(String::new()),
        SqlInsertConflictPolicy::Update => {
            if options.conflict_key_columns.is_empty() {
                return Err(
                    "Updating conflicting SQL INSERT rows requires a primary key".to_string(),
                );
            }
            let column_names = columns
                .iter()
                .map(|column| column.name.as_str())
                .collect::<HashSet<_>>();
            if options
                .conflict_key_columns
                .iter()
                .any(|column| !column_names.contains(column.as_str()))
            {
                return Err(
                    "The SQL export does not contain every primary-key conflict column".to_string(),
                );
            }
            let conflict_keys = options
                .conflict_key_columns
                .iter()
                .map(|column| options.kind.quote_identifier(column))
                .collect::<Vec<_>>();
            let update_columns = columns
                .iter()
                .filter(|column| {
                    !options
                        .conflict_key_columns
                        .iter()
                        .any(|key| key == &column.name)
                })
                .map(|column| options.kind.quote_identifier(&column.name))
                .collect::<Vec<_>>();

            match options.dialect {
                SqlExportDialect::Postgres | SqlExportDialect::Sqlite => {
                    if update_columns.is_empty() {
                        Ok(format!(
                            " ON CONFLICT ({}) DO NOTHING",
                            conflict_keys.join(", ")
                        ))
                    } else {
                        let assignments = update_columns
                            .iter()
                            .map(|column| format!("{column} = excluded.{column}"))
                            .collect::<Vec<_>>()
                            .join(", ");
                        Ok(format!(
                            " ON CONFLICT ({}) DO UPDATE SET {assignments}",
                            conflict_keys.join(", ")
                        ))
                    }
                }
                SqlExportDialect::Mysql => {
                    let assignments = if update_columns.is_empty() {
                        let key = &conflict_keys[0];
                        format!("{key} = {key}")
                    } else {
                        update_columns
                            .iter()
                            .map(|column| format!("{column} = VALUES({column})"))
                            .collect::<Vec<_>>()
                            .join(", ")
                    };
                    Ok(format!(" ON DUPLICATE KEY UPDATE {assignments}"))
                }
                _ => Err(
                    "Updating conflicting SQL INSERT rows is unavailable for this database dialect"
                        .to_string(),
                ),
            }
        }
    }
}

pub(super) fn ensure_sql_insert_conflict_policy(
    dialect: SqlExportDialect,
    policy: SqlInsertConflictPolicy,
) -> Result<(), String> {
    if policy == SqlInsertConflictPolicy::Strict
        || matches!(
            dialect,
            SqlExportDialect::Postgres | SqlExportDialect::Mysql | SqlExportDialect::Sqlite
        )
    {
        return Ok(());
    }
    Err("SQL INSERT conflict handling is unavailable for this database dialect".to_string())
}

pub(super) fn sql_export_insert_batch_rows(requested: Option<usize>) -> Result<usize, String> {
    let rows = requested.unwrap_or(SQL_EXPORT_INSERT_BATCH_ROWS);
    if !(1..=SQL_EXPORT_MAX_INSERT_BATCH_ROWS).contains(&rows) {
        return Err(format!(
            "SQL INSERT batch size must be between 1 and {SQL_EXPORT_MAX_INSERT_BATCH_ROWS} rows"
        ));
    }
    Ok(rows)
}

pub(super) fn filter_sql_export_batch(
    columns: Vec<ColumnDef>,
    rows: Vec<Vec<Value>>,
    excluded_columns: &HashSet<String>,
) -> Result<(Vec<ColumnDef>, Vec<Vec<Value>>), String> {
    if excluded_columns.is_empty() {
        return Ok((columns, rows));
    }

    let retained_indices = columns
        .iter()
        .enumerate()
        .filter_map(|(index, column)| (!excluded_columns.contains(&column.name)).then_some(index))
        .collect::<Vec<_>>();
    if retained_indices.is_empty() && !columns.is_empty() {
        return Err(
            "SQL export has no writable columns after excluding database-generated values"
                .to_string(),
        );
    }
    let columns = retained_indices
        .iter()
        .map(|index| columns[*index].clone())
        .collect();
    let rows = rows
        .into_iter()
        .map(|row| {
            retained_indices
                .iter()
                .map(|index| row.get(*index).cloned().unwrap_or(Value::Null))
                .collect()
        })
        .collect();
    Ok((columns, rows))
}

pub(super) fn format_sql_export_row(
    dialect: SqlExportDialect,
    columns: &[ColumnDef],
    row: &[Value],
) -> String {
    let values = columns
        .iter()
        .enumerate()
        .map(|(index, column)| {
            sql_export_literal(
                dialect,
                row.get(index).unwrap_or(&Value::Null),
                Some(&column.data_type),
            )
        })
        .collect::<Vec<_>>()
        .join(", ");
    format!("({values})")
}

pub(super) fn sql_string_literal_for_dialect(dialect: SqlExportDialect, value: &str) -> String {
    if dialect != SqlExportDialect::Mysql {
        return sql_string_literal(value);
    }
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '\0' => escaped.push_str("\\0"),
            '\u{0008}' => escaped.push_str("\\b"),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            '\u{000c}' => escaped.push_str("\\f"),
            '\u{001a}' => escaped.push_str("\\Z"),
            '\\' => escaped.push_str("\\\\"),
            '\'' => escaped.push_str("''"),
            _ => escaped.push(character),
        }
    }
    format!("'{escaped}'")
}

pub(super) fn is_mysql_binary_export_type(data_type: &str) -> bool {
    matches!(
        data_type
            .trim()
            .split(['(', ' ', '\t'])
            .next()
            .unwrap_or("")
            .to_ascii_uppercase()
            .as_str(),
        "BINARY" | "VARBINARY" | "TINYBLOB" | "BLOB" | "MEDIUMBLOB" | "LONGBLOB"
    )
}

pub(super) fn is_postgres_bytea_export_type(data_type: &str) -> bool {
    data_type.trim().eq_ignore_ascii_case("bytea")
}

pub(super) fn is_postgres_tsvector_export_type(data_type: &str) -> bool {
    let normalized = data_type.trim().trim_matches('"').to_ascii_lowercase();
    normalized == "tsvector" || normalized.ends_with(".tsvector")
}

pub(super) fn is_sqlite_blob_export_type(data_type: &str) -> bool {
    data_type
        .trim()
        .split(['(', ' ', '\t'])
        .next()
        .unwrap_or("")
        .eq_ignore_ascii_case("blob")
}

pub(super) fn is_postgres_array_export_type(data_type: &str) -> bool {
    data_type.trim().ends_with("[]")
}

pub(super) fn is_even_hex(value: &str) -> bool {
    value.len().is_multiple_of(2) && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

pub(super) fn mysql_hex_literal(value: &str) -> bool {
    value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
        .is_some_and(is_even_hex)
}

pub(super) fn postgres_array_export_literal(values: &[Value], data_type: &str) -> String {
    let data_type = data_type.trim();
    let element_type = data_type.strip_suffix("[]").unwrap_or(data_type).trim();
    let elements = values
        .iter()
        .map(|value| match value {
            Value::Array(nested) if element_type.ends_with("[]") => {
                postgres_array_export_literal(nested, element_type)
            }
            _ => sql_export_literal(SqlExportDialect::Postgres, value, Some(element_type)),
        })
        .collect::<Vec<_>>()
        .join(", ");
    format!("ARRAY[{elements}]::{data_type}")
}

pub(super) fn sql_string_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}
