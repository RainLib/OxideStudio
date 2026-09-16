use super::postgres_refs::sql_string_literal;
use crate::core::dialect::DatabaseKind;

pub(super) fn table_comment_sql(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    comment: Option<&str>,
) -> String {
    let relation = kind.qualified_table(Some(schema), table);
    match kind {
        DatabaseKind::Postgres => format!(
            "COMMENT ON TABLE {relation} IS {};",
            comment
                .map(sql_string_literal)
                .unwrap_or_else(|| "NULL".to_string())
        ),
        DatabaseKind::Mysql => format!(
            "ALTER TABLE {relation} COMMENT = {};",
            sql_string_literal(comment.unwrap_or_default())
        ),
    }
}
