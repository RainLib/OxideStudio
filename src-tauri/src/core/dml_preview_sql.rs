//! Builds a bounded, read-only-looking SELECT preview for one UPDATE, INSERT,
//! or DELETE statement. The command never opens a database connection; callers
//! still own execution and must keep the generated statement in the ordinary
//! query safety path.

use serde::{Deserialize, Serialize};
use sqlparser::ast::{
    AssignmentTarget, Expr, Ident, ObjectName, ObjectNamePart, SetExpr, Statement, TableWithJoins,
};
use sqlparser::dialect::{
    ClickHouseDialect, DuckDbDialect, GenericDialect, MsSqlDialect, MySqlDialect,
    PostgreSqlDialect, SQLiteDialect,
};
use sqlparser::parser::Parser;

const MAX_PREVIEW_INPUT_BYTES: usize = 1024 * 1024;
const MAX_PREVIEW_OUTPUT_BYTES: usize = 1024 * 1024;
const MAX_PREVIEW_COLUMNS: usize = 4096;
const MAX_IDENTIFIER_CHARS: usize = 512;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DmlChangePreviewSqlOptions {
    pub sql: String,
    pub database_type: Option<String>,
    pub identifier_quote: Option<String>,
    #[serde(default)]
    pub columns: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DmlChangePreviewTableRef {
    pub catalog: Option<String>,
    pub database: Option<String>,
    pub schema: Option<String>,
    pub table: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DmlChangePreviewSqlResult {
    pub sql: String,
    pub operation: String,
    pub has_new_value_columns: bool,
    pub tables: Vec<DmlChangePreviewTableRef>,
}

fn unsupported(reason: &str) -> String {
    format!("Preview is not supported: {reason}")
}

fn normalize_dialect(database_type: Option<&str>) -> &'static str {
    match database_type
        .unwrap_or("generic")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "postgres" | "postgresql" | "redshift" | "opengauss" | "gaussdb" | "highgo" | "uxdb"
        | "questdb" => "postgres",
        "mysql" | "mariadb" | "doris" | "starrocks" | "manticoresearch" | "oceanbase" | "tidb" => {
            "mysql"
        }
        "sqlite" | "rqlite" | "cloudflare-d1" | "d1" => "sqlite",
        "sqlserver" | "mssql" => "sqlserver",
        "clickhouse" => "clickhouse",
        "duckdb" => "duckdb",
        "spark" | "sparksql" => "spark",
        _ => "generic",
    }
}

fn parse_statements(sql: &str, dialect: &str) -> Result<Vec<Statement>, String> {
    match dialect {
        "postgres" => Parser::parse_sql(&PostgreSqlDialect {}, sql),
        "mysql" => Parser::parse_sql(&MySqlDialect {}, sql),
        "sqlite" => Parser::parse_sql(&SQLiteDialect {}, sql),
        "sqlserver" => Parser::parse_sql(&MsSqlDialect {}, sql),
        "clickhouse" => Parser::parse_sql(&ClickHouseDialect {}, sql),
        "duckdb" => Parser::parse_sql(&DuckDbDialect {}, sql),
        // sqlparser 0.59 does not expose a dedicated Spark dialect. Its
        // generic parser covers the DML forms used by this bounded preview.
        "spark" => Parser::parse_sql(&GenericDialect {}, sql),
        _ => Parser::parse_sql(&GenericDialect {}, sql),
    }
    .map_err(|error| format!("Failed to parse the statement: {error}"))
}

fn quote_delimiter<'a>(quote: Option<&'a str>, dialect: &str) -> &'a str {
    match quote {
        Some("\"") => "\"",
        Some("`") => "`",
        Some("[") => "[",
        _ if dialect == "mysql" => "`",
        _ => "\"",
    }
}

fn quote_identifier(name: &str, quote: Option<&str>, dialect: &str) -> String {
    match quote_delimiter(quote, dialect) {
        "`" => format!("`{}`", name.replace('`', "``")),
        "[" => format!("[{}]", name.replace(']', "]]")),
        _ => format!("\"{}\"", name.replace('"', "\"\"")),
    }
}

fn assignment_column(target: &AssignmentTarget) -> Option<&Ident> {
    match target {
        AssignmentTarget::ColumnName(name) => name.0.last().and_then(ObjectNamePart::as_ident),
        AssignmentTarget::Tuple(_) => None,
    }
}

#[derive(Clone)]
struct SetItem {
    column: String,
    expression: String,
}

struct UpdatePreviewAst<'a> {
    table: &'a TableWithJoins,
    assignments: &'a [sqlparser::ast::Assignment],
    from: &'a Option<sqlparser::ast::UpdateTableFromKind>,
    selection: &'a Option<Expr>,
    limit: &'a Option<Expr>,
}

fn build_update_preview(
    update: UpdatePreviewAst<'_>,
    dialect: &str,
    quote: Option<&str>,
    columns: Option<&[String]>,
) -> Result<String, String> {
    let mut items = Vec::<SetItem>::new();
    let mut order = Vec::<String>::new();
    for assignment in update.assignments {
        let column = assignment_column(&assignment.target)
            .ok_or_else(|| unsupported("UPDATE assignment target is not a single column"))?;
        let key = column.value.to_lowercase();
        if let Some(position) = order.iter().position(|candidate| candidate == &key) {
            order.remove(position);
            items.remove(position);
        }
        order.push(key);
        items.push(SetItem {
            column: column.value.clone(),
            expression: assignment.value.to_string(),
        });
    }

    if update.from.as_ref().is_some_and(|from| match from {
        sqlparser::ast::UpdateTableFromKind::BeforeSet(tables)
        | sqlparser::ast::UpdateTableFromKind::AfterSet(tables) => !tables.is_empty(),
    }) {
        return Err(unsupported("UPDATE ... FROM"));
    }

    let render_new = |item: &SetItem| {
        format!(
            "{} AS {}",
            item.expression,
            quote_identifier(&format!("{} (new)", item.column), quote, dialect)
        )
    };
    let appended = items.iter().map(render_new).collect::<Vec<_>>();
    let single_table = update.table.joins.is_empty() && update.from.is_none();
    let projection = if single_table {
        if let Some(columns) = columns.filter(|columns| !columns.is_empty()) {
            let mut projection = Vec::new();
            let mut placed = Vec::new();
            for column in columns {
                projection.push(quote_identifier(column, quote, dialect));
                let key = column.to_lowercase();
                if let Some(position) = order.iter().position(|candidate| candidate == &key) {
                    projection.push(render_new(&items[position]));
                    placed.push(key);
                }
            }
            for (index, key) in order.iter().enumerate() {
                if !placed.contains(key) {
                    projection.push(render_new(&items[index]));
                }
            }
            projection.join(", ")
        } else if appended.is_empty() {
            "*".to_string()
        } else {
            format!("*, {}", appended.join(", "))
        }
    } else if appended.is_empty() {
        "*".to_string()
    } else {
        format!("*, {}", appended.join(", "))
    };

    let mut sql = format!("SELECT {projection} FROM {}", update.table);
    if let Some(selection) = update.selection {
        sql.push_str(&format!(" WHERE {selection}"));
    }
    if let Some(limit) = update.limit {
        sql.push_str(&format!(" LIMIT {limit}"));
    }
    Ok(sql)
}

fn build_insert_preview(
    insert: &sqlparser::ast::Insert,
    dialect: &str,
    quote: Option<&str>,
) -> Result<String, String> {
    if !insert.assignments.is_empty() {
        let items = insert
            .assignments
            .iter()
            .map(|assignment| {
                let column = assignment_column(&assignment.target).ok_or_else(|| {
                    unsupported("INSERT ... SET assignment target is not a single column")
                })?;
                Ok(format!(
                    "{} AS {}",
                    assignment.value,
                    quote_identifier(&column.value, quote, dialect)
                ))
            })
            .collect::<Result<Vec<_>, String>>()?;
        if items.is_empty() {
            return Err(unsupported("INSERT ... SET has no assignments"));
        }
        return Ok(format!("SELECT {}", items.join(", ")));
    }

    let source = insert
        .source
        .as_ref()
        .ok_or_else(|| unsupported("INSERT has no source"))?;
    match source.body.as_ref() {
        SetExpr::Values(values) => {
            let columns = insert
                .columns
                .iter()
                .map(|column| column.value.clone())
                .collect::<Vec<_>>();
            if !columns.is_empty() && values.rows.iter().any(|row| row.len() != columns.len()) {
                return Err(unsupported(
                    "INSERT VALUES row length does not match the column list",
                ));
            }
            let render_row = |expressions: &[Expr]| {
                let cells = expressions
                    .iter()
                    .enumerate()
                    .map(|(index, expression)| {
                        if columns.is_empty() {
                            expression.to_string()
                        } else {
                            format!(
                                "{} AS {}",
                                expression,
                                quote_identifier(&columns[index], quote, dialect)
                            )
                        }
                    })
                    .collect::<Vec<_>>();
                format!("SELECT {}", cells.join(", "))
            };
            let mut rows = values.rows.iter();
            let first = rows
                .next()
                .ok_or_else(|| unsupported("INSERT VALUES is empty"))?;
            let mut sql = render_row(first);
            for row in rows {
                sql.push_str(" UNION ALL ");
                sql.push_str(&render_row(row));
            }
            Ok(sql)
        }
        _ => Ok(source.to_string()),
    }
}

fn build_delete_preview(delete: &sqlparser::ast::Delete) -> Result<String, String> {
    let tables = match &delete.from {
        sqlparser::ast::FromTable::WithFromKeyword(tables)
        | sqlparser::ast::FromTable::WithoutKeyword(tables) => tables,
    };
    let from = tables
        .iter()
        .map(TableWithJoins::to_string)
        .collect::<Vec<_>>()
        .join(", ");
    if from.is_empty() {
        return Err(unsupported("DELETE has no FROM"));
    }
    let mut sql = format!("SELECT * FROM {from}");
    if let Some(using) = &delete.using {
        if !using.is_empty() {
            sql.push_str(", ");
            sql.push_str(
                &using
                    .iter()
                    .map(TableWithJoins::to_string)
                    .collect::<Vec<_>>()
                    .join(", "),
            );
        }
    }
    if let Some(selection) = &delete.selection {
        sql.push_str(&format!(" WHERE {selection}"));
    }
    if !delete.order_by.is_empty() {
        sql.push_str(" ORDER BY ");
        sql.push_str(
            &delete
                .order_by
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join(", "),
        );
    }
    if let Some(limit) = &delete.limit {
        sql.push_str(&format!(" LIMIT {limit}"));
    }
    Ok(sql)
}

fn object_name_ref(name: &ObjectName) -> DmlChangePreviewTableRef {
    let names = name
        .0
        .iter()
        .filter_map(|part| part.as_ident().map(|ident| ident.value.clone()))
        .collect::<Vec<_>>();
    match names.as_slice() {
        [catalog, database, schema, table] => DmlChangePreviewTableRef {
            catalog: Some(catalog.clone()),
            database: Some(database.clone()),
            schema: Some(schema.clone()),
            table: Some(table.clone()),
        },
        [database, schema, table] => DmlChangePreviewTableRef {
            catalog: None,
            database: Some(database.clone()),
            schema: Some(schema.clone()),
            table: Some(table.clone()),
        },
        [schema, table] => DmlChangePreviewTableRef {
            catalog: None,
            database: None,
            schema: Some(schema.clone()),
            table: Some(table.clone()),
        },
        [table] => DmlChangePreviewTableRef {
            catalog: None,
            database: None,
            schema: None,
            table: Some(table.clone()),
        },
        _ => DmlChangePreviewTableRef {
            catalog: None,
            database: None,
            schema: None,
            table: None,
        },
    }
}

fn unknown_table_ref() -> DmlChangePreviewTableRef {
    DmlChangePreviewTableRef {
        catalog: None,
        database: None,
        schema: None,
        table: None,
    }
}

fn update_table_ref(table: &TableWithJoins) -> DmlChangePreviewTableRef {
    match &table.relation {
        sqlparser::ast::TableFactor::Table { name, .. } => object_name_ref(name),
        _ => unknown_table_ref(),
    }
}

fn insert_table_ref(insert: &sqlparser::ast::Insert) -> DmlChangePreviewTableRef {
    match &insert.table {
        sqlparser::ast::TableObject::TableName(name) => object_name_ref(name),
        _ => unknown_table_ref(),
    }
}

fn delete_table_ref(delete: &sqlparser::ast::Delete) -> DmlChangePreviewTableRef {
    if let Some(name) = delete.tables.first() {
        return object_name_ref(name);
    }
    let tables = match &delete.from {
        sqlparser::ast::FromTable::WithFromKeyword(tables)
        | sqlparser::ast::FromTable::WithoutKeyword(tables) => tables,
    };
    tables
        .first()
        .and_then(|table| match &table.relation {
            sqlparser::ast::TableFactor::Table { name, .. } => Some(object_name_ref(name)),
            _ => None,
        })
        .unwrap_or_else(unknown_table_ref)
}

fn validate_options(options: &DmlChangePreviewSqlOptions) -> Result<(), String> {
    if options.sql.trim().is_empty() {
        return Err(unsupported("no statement to preview"));
    }
    if options.sql.len() > MAX_PREVIEW_INPUT_BYTES {
        return Err(unsupported("statement exceeds the preview size limit"));
    }
    if let Some(columns) = &options.columns {
        if columns.len() > MAX_PREVIEW_COLUMNS
            || columns.iter().any(|column| {
                column.is_empty()
                    || column.chars().count() > MAX_IDENTIFIER_CHARS
                    || column.chars().any(char::is_control)
            })
        {
            return Err(unsupported("column metadata is invalid or too large"));
        }
    }
    Ok(())
}

pub fn build_dml_change_preview_sql(
    options: DmlChangePreviewSqlOptions,
) -> Result<DmlChangePreviewSqlResult, String> {
    validate_options(&options)?;
    let dialect = normalize_dialect(options.database_type.as_deref());
    let statements = parse_statements(&options.sql, dialect)?;
    let statement = match statements.as_slice() {
        [statement] => statement,
        [] => return Err(unsupported("no statement to preview")),
        _ => return Err(unsupported("only one statement can be previewed at a time")),
    };
    let quote = options.identifier_quote.as_deref();
    let (sql, operation, has_new_value_columns, table) = match statement {
        Statement::Update {
            table,
            assignments,
            from,
            selection,
            limit,
            ..
        } => (
            build_update_preview(
                UpdatePreviewAst {
                    table,
                    assignments,
                    from,
                    selection,
                    limit,
                },
                dialect,
                quote,
                options.columns.as_deref(),
            )?,
            "update",
            true,
            update_table_ref(table),
        ),
        Statement::Insert(insert) => (
            build_insert_preview(insert, dialect, quote)?,
            "insert",
            true,
            insert_table_ref(insert),
        ),
        Statement::Delete(delete) => (
            build_delete_preview(delete)?,
            "delete",
            false,
            delete_table_ref(delete),
        ),
        _ => {
            return Err(unsupported(
                "only UPDATE / INSERT / DELETE statements can be previewed",
            ));
        }
    };
    if sql.len() > MAX_PREVIEW_OUTPUT_BYTES {
        return Err(unsupported("generated preview exceeds the size limit"));
    }
    Ok(DmlChangePreviewSqlResult {
        sql,
        operation: operation.to_string(),
        has_new_value_columns,
        tables: vec![table],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn preview(sql: &str, database_type: &str) -> Result<DmlChangePreviewSqlResult, String> {
        build_dml_change_preview_sql(DmlChangePreviewSqlOptions {
            sql: sql.to_string(),
            database_type: Some(database_type.to_string()),
            identifier_quote: None,
            columns: None,
        })
    }

    #[test]
    fn previews_update_delete_and_insert_without_rebuilding_expressions() {
        assert_eq!(
            preview("UPDATE t SET a = a + 1 WHERE id = 2", "postgres")
                .unwrap()
                .sql,
            "SELECT *, a + 1 AS \"a (new)\" FROM t WHERE id = 2"
        );
        assert_eq!(
            preview("DELETE FROM t WHERE id = 2", "postgres")
                .unwrap()
                .sql,
            "SELECT * FROM t WHERE id = 2"
        );
        assert_eq!(
            preview("INSERT INTO t (a, b) VALUES (1, 'x'), (2, 'y')", "mysql")
                .unwrap()
                .sql,
            "SELECT 1 AS `a`, 'x' AS `b` UNION ALL SELECT 2 AS `a`, 'y' AS `b`"
        );
    }

    #[test]
    fn interleaves_update_values_with_trusted_column_order_and_escapes_names() {
        let result = build_dml_change_preview_sql(DmlChangePreviewSqlOptions {
            sql: "UPDATE t SET b = 2, a = 1".to_string(),
            database_type: Some("postgres".to_string()),
            identifier_quote: Some("\"".to_string()),
            columns: Some(vec![
                "a".to_string(),
                "b".to_string(),
                "c\"quoted".to_string(),
            ]),
        })
        .unwrap();
        assert_eq!(
            result.sql,
            "SELECT \"a\", 1 AS \"a (new)\", \"b\", 2 AS \"b (new)\", \"c\"\"quoted\" FROM t"
        );
    }

    #[test]
    fn rejects_ambiguous_or_unbounded_preview_inputs() {
        assert!(preview("UPDATE t SET a = 1; DELETE FROM t", "postgres").is_err());
        assert!(preview("UPDATE t SET a = s.a FROM s WHERE t.id = s.id", "postgres").is_err());
        assert!(preview("SELECT * FROM t", "postgres").is_err());
        assert!(preview(&"x".repeat(MAX_PREVIEW_INPUT_BYTES + 1), "postgres").is_err());
    }

    #[test]
    fn reports_qualified_target_identity() {
        let result = preview("UPDATE db.public.orders SET total = 1", "postgres").unwrap();
        assert_eq!(result.tables[0].database.as_deref(), Some("db"));
        assert_eq!(result.tables[0].schema.as_deref(), Some("public"));
        assert_eq!(result.tables[0].table.as_deref(), Some("orders"));
    }
}
