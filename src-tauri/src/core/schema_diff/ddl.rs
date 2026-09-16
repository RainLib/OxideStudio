use super::comments::table_comment_sql;
use super::postgres_refs::{rewrite_postgres_schema_qualified_references, sql_string_literal};
use super::render::relation_flags;
use super::types::SchemaRelationSnapshot;
use crate::core::dialect::DatabaseKind;
use crate::core::protocol::{ColumnInfo, ConstraintInfo, IndexInfo};
use anyhow::Result;

pub(super) fn create_relation_sql(
    kind: DatabaseKind,
    source_schema: &str,
    target_schema: &str,
    relation: &SchemaRelationSnapshot,
) -> (Vec<String>, bool, Vec<String>) {
    let flags = relation_flags(relation.object_type.as_deref());
    if flags.is_view {
        let mut warnings = external_view_dependency_warnings(relation);
        let Some(definition) = normalized_view_select_definition(relation.definition.as_deref())
        else {
            warnings.push(format!(
                "View {} requires its source definition before it can be created.",
                relation.name
            ));
            return (Vec::new(), true, warnings);
        };
        let definition = if kind == DatabaseKind::Postgres {
            rewrite_postgres_schema_qualified_references(&definition, source_schema, target_schema)
        } else {
            definition
        };
        if flags.is_materialized_view {
            let sql = kind
                .create_materialized_view_query(
                    Some(target_schema),
                    &relation.name,
                    &definition,
                    relation.materialized_view_populated.unwrap_or(false),
                )
                .into_iter()
                .collect();
            warnings.push(if relation.materialized_view_populated == Some(true) {
                format!(
                    "Materialized view {} must be reviewed before creation because WITH DATA executes its source query on the target.",
                    relation.name
                )
            } else {
                format!(
                    "Materialized view {} is created WITH NO DATA because its captured population state is false or unavailable; refresh it manually after review.",
                    relation.name
                )
            });
            return (sql, true, warnings);
        }
        warnings.push(format!(
            "View {} source was captured read-only. Review its dependencies before applying the generated DDL.",
            relation.name
        ));
        return (
            vec![kind.create_view_query(Some(target_schema), &relation.name, &definition, false)],
            true,
            warnings,
        );
    }
    if flags.is_foreign_table {
        return (
            Vec::new(),
            true,
            vec![format!(
                "Relation {} requires its source definition before it can be created.",
                relation.name
            )],
        );
    }

    let mut warnings = Vec::new();
    if relation.columns.is_empty() {
        return (
            Vec::new(),
            true,
            vec![format!(
                "Relation {} has no captured columns, so CREATE TABLE SQL was not generated.",
                relation.name
            )],
        );
    }
    let mut definitions = relation
        .columns
        .iter()
        .map(|column| {
            let (definition, column_warnings) =
                column_definition(kind, source_schema, target_schema, column);
            warnings.extend(column_warnings);
            format!("  {definition}")
        })
        .collect::<Vec<_>>();
    let has_primary_constraint = relation.constraints.iter().any(|constraint| {
        constraint
            .constraint_type
            .to_ascii_uppercase()
            .contains("PRIMARY")
    });
    for constraint in relation
        .constraints
        .iter()
        .filter(|constraint| !is_foreign_constraint(constraint))
    {
        if let Some(clause) =
            inline_constraint_clause(kind, source_schema, target_schema, constraint)
        {
            definitions.push(format!("  {clause}"));
        } else {
            warnings.push(format!(
                "Constraint {}.{} needs manual review.",
                relation.name, constraint.name
            ));
        }
    }
    if !has_primary_constraint {
        let primary_columns = relation
            .columns
            .iter()
            .filter(|column| column.is_primary_key)
            .map(|column| kind.quote_identifier(&column.name))
            .collect::<Vec<_>>();
        if !primary_columns.is_empty() {
            definitions.push(format!("  PRIMARY KEY ({})", primary_columns.join(", ")));
        }
    }

    let mut sql = vec![format!(
        "CREATE TABLE {} (\n{}\n);",
        kind.qualified_table(Some(target_schema), &relation.name),
        definitions.join(",\n")
    )];
    if kind == DatabaseKind::Postgres {
        for column in relation.columns.iter().filter(|column| {
            column
                .comment
                .as_deref()
                .is_some_and(|value| !value.is_empty())
        }) {
            sql.push(format!(
                "COMMENT ON COLUMN {}.{} IS {};",
                kind.qualified_table(Some(target_schema), &relation.name),
                kind.quote_identifier(&column.name),
                sql_string_literal(column.comment.as_deref().unwrap_or_default())
            ));
        }
    }
    if relation
        .comment
        .as_deref()
        .is_some_and(|value| !value.is_empty())
    {
        sql.push(table_comment_sql(
            kind,
            target_schema,
            &relation.name,
            relation.comment.as_deref(),
        ));
    }
    let constraint_names = relation
        .constraints
        .iter()
        .map(|constraint| constraint.name.as_str())
        .collect::<std::collections::HashSet<_>>();
    for index in relation
        .indexes
        .iter()
        .filter(|index| !index.is_primary && !constraint_names.contains(index.name.as_str()))
    {
        match create_index_sql(kind, source_schema, target_schema, &relation.name, index) {
            Ok(index_sql) => sql.push(index_sql),
            Err(warning) => warnings.push(warning),
        }
    }
    let manual_review = !warnings.is_empty();
    (sql, manual_review, warnings)
}

pub(crate) fn create_index_sql(
    kind: DatabaseKind,
    source_schema: &str,
    target_schema: &str,
    relation_name: &str,
    index: &IndexInfo,
) -> std::result::Result<String, String> {
    if kind == DatabaseKind::Postgres {
        if let Some(definition) = index
            .definition
            .as_deref()
            .map(str::trim)
            .filter(|definition| !definition.is_empty())
        {
            return Ok(format!(
                "{};",
                rewrite_postgres_schema_qualified_references(
                    definition.trim_end_matches(';'),
                    source_schema,
                    target_schema,
                )
            ));
        }
    }

    let index_type = index
        .index_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let supported_type = match (kind, index_type) {
        (DatabaseKind::Postgres, None) => true,
        (DatabaseKind::Postgres, Some(value)) => value.eq_ignore_ascii_case("BTREE"),
        (DatabaseKind::Mysql, None) => true,
        (DatabaseKind::Mysql, Some(value)) => value.eq_ignore_ascii_case("BTREE"),
    };
    let has_unrepresented_key_semantics = !index.key_is_expression.is_empty()
        && (index.key_is_expression.len() != index.columns.len()
            || index.key_is_expression.iter().any(|value| *value));
    if !supported_type || index.columns.is_empty() || has_unrepresented_key_semantics {
        return Err(format!(
            "Index {}.{} uses an expression or unsupported index type and requires its exact source definition.",
            relation_name, index.name
        ));
    }

    Ok(kind.create_index_query(
        Some(target_schema),
        relation_name,
        &index.name,
        &index.columns,
        index.is_unique,
    ))
}

pub(super) fn column_definition(
    kind: DatabaseKind,
    source_schema: &str,
    target_schema: &str,
    column: &ColumnInfo,
) -> (String, Vec<String>) {
    let data_type = if kind == DatabaseKind::Postgres {
        rewrite_postgres_schema_qualified_references(
            &column.data_type,
            source_schema,
            target_schema,
        )
    } else {
        column.data_type.clone()
    };
    let mut definition = format!(
        "{} {}",
        kind.quote_identifier(&column.name),
        data_type.trim()
    );
    let mut warnings = Vec::new();
    if column.is_generated == Some(true) {
        warnings.push(format!(
            "{} is generated/computed; its generation expression is not synthesized as a default.",
            column.name
        ));
    }
    if column.is_hidden == Some(true) {
        warnings.push(format!(
            "{} is hidden/invisible; its product-specific visibility clause requires review.",
            column.name
        ));
    }
    // A PostgreSQL serial-style column is represented by an ordinary integer
    // plus a nextval(...) default. Preserve that default and its separately
    // captured sequence instead of synthesizing a second identity generator.
    let postgres_sequence_default = kind == DatabaseKind::Postgres
        && column
            .default_value
            .as_deref()
            .is_some_and(is_postgres_sequence_default);
    let (identity_generation, identity_generation_valid) =
        match normalized_identity_generation(column.identity_generation.as_deref()) {
            Ok(identity_generation) => (identity_generation, true),
            Err(error) => {
                warnings.push(format!("{}: {error}", column.name));
                (None, false)
            }
        };
    let identity_generation_valid = if identity_generation.is_some() && !column.is_auto_increment {
        warnings.push(format!(
            "{} declares an identity generation mode without identity semantics.",
            column.name
        ));
        false
    } else {
        identity_generation_valid
    };
    if column.is_auto_increment && !postgres_sequence_default {
        if !identity_generation_valid {
            // The warning above is the complete review artifact; do not emit a
            // weaker identity clause for malformed source metadata.
        } else if kind == DatabaseKind::Postgres && column.identity_generation.is_none() {
            warnings.push(format!(
                "{} has unproven PostgreSQL identity mode; no identity clause was generated.",
                column.name
            ));
        } else if kind != DatabaseKind::Postgres && identity_generation.is_some() {
            warnings.push(format!(
                "{} carries PostgreSQL identity mode metadata for a non-PostgreSQL target.",
                column.name
            ));
        } else {
            match kind.auto_increment_clause_for_type(&column.data_type) {
                Ok(Some(_clause)) if identity_generation == Some("always") => {
                    definition.push_str(" GENERATED ALWAYS AS IDENTITY")
                }
                Ok(Some(clause)) => definition.push_str(clause),
                Ok(None) => {}
                Err(error) => warnings.push(format!("{}: {error}", column.name)),
            }
        }
    }
    if column.is_generated != Some(true) {
        if let Some(default_value) = column.default_value.as_deref() {
            definition.push_str(" DEFAULT ");
            let default_value = if kind == DatabaseKind::Postgres {
                rewrite_postgres_schema_qualified_references(
                    default_value,
                    source_schema,
                    target_schema,
                )
            } else {
                default_value.to_string()
            };
            definition.push_str(&kind.metadata_default_sql(&data_type, &default_value));
        }
    }
    if !column.is_nullable {
        definition.push_str(" NOT NULL");
    }
    if kind == DatabaseKind::Mysql {
        if let Some(comment) = column.comment.as_deref().filter(|value| !value.is_empty()) {
            definition.push_str(" COMMENT ");
            definition.push_str(&sql_string_literal(comment));
        }
    }
    (definition, warnings)
}

pub(super) fn is_postgres_sequence_default(default_value: &str) -> bool {
    let normalized = default_value.trim().to_ascii_lowercase();
    normalized.starts_with("nextval(") && !normalized.contains(';')
}

pub(super) fn normalized_identity_generation(
    value: Option<&str>,
) -> Result<Option<&'static str>, String> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let normalized = value
        .chars()
        .filter(|ch| !matches!(ch, '_' | '-' | ' '))
        .collect::<String>()
        .to_ascii_lowercase();
    match normalized.as_str() {
        "always" => Ok(Some("always")),
        "bydefault" => Ok(Some("byDefault")),
        _ => Err(format!("Unsupported identity generation mode: {value}")),
    }
}

pub(super) fn alter_column_sql(
    kind: DatabaseKind,
    source_schema: &str,
    schema: &str,
    table: &str,
    source: &ColumnInfo,
    target: &ColumnInfo,
) -> (Vec<String>, bool, Vec<String>) {
    let relation = kind.qualified_table(Some(schema), table);
    let column = kind.quote_identifier(&source.name);
    let mut sql = Vec::new();
    let mut warnings = Vec::new();
    let mut manual_review = false;

    if source.is_generated != Some(false)
        || source.is_hidden != Some(false)
        || source.is_generated != target.is_generated
        || source.is_hidden != target.is_hidden
    {
        warnings.push(format!(
            "Generated/hidden metadata change for {table}.{} requires a lossless dialect-owned expression and visibility model.",
            source.name
        ));
        return (Vec::new(), true, warnings);
    }

    if kind == DatabaseKind::Mysql {
        let (definition, definition_warnings) =
            column_definition(kind, source_schema, schema, source);
        warnings.extend(definition_warnings);
        sql.push(format!(
            "ALTER TABLE {relation} MODIFY COLUMN {definition};"
        ));
        return (sql, !warnings.is_empty(), warnings);
    }

    if source.data_type != target.data_type {
        let source_type = rewrite_postgres_schema_qualified_references(
            source.data_type.trim(),
            source_schema,
            schema,
        );
        sql.push(format!(
            "ALTER TABLE {relation} ALTER COLUMN {column} TYPE {} USING {column}::{};",
            source_type, source_type
        ));
        manual_review = true;
    }
    if source.default_value != target.default_value {
        match source.default_value.as_deref() {
            Some(default_value) => sql.push(format!(
                "ALTER TABLE {relation} ALTER COLUMN {column} SET DEFAULT {};",
                kind.metadata_default_sql(
                    &rewrite_postgres_schema_qualified_references(
                        &source.data_type,
                        source_schema,
                        schema,
                    ),
                    &rewrite_postgres_schema_qualified_references(
                        default_value,
                        source_schema,
                        schema,
                    )
                )
            )),
            None => sql.push(format!(
                "ALTER TABLE {relation} ALTER COLUMN {column} DROP DEFAULT;"
            )),
        }
    }
    if source.is_nullable != target.is_nullable {
        sql.push(format!(
            "ALTER TABLE {relation} ALTER COLUMN {column} {};",
            if source.is_nullable {
                "DROP NOT NULL"
            } else {
                "SET NOT NULL"
            }
        ));
        if !source.is_nullable {
            manual_review = true;
        }
    }
    if source.is_auto_increment != target.is_auto_increment
        || source.identity_generation != target.identity_generation
    {
        manual_review = true;
        warnings.push(format!(
            "Identity generation change for {table}.{} requires manual PostgreSQL sequence/identity review.",
            source.name
        ));
    }
    if source.comment != target.comment {
        let comment = source
            .comment
            .as_deref()
            .map(sql_string_literal)
            .unwrap_or_else(|| "NULL".to_string());
        sql.push(format!(
            "COMMENT ON COLUMN {relation}.{column} IS {comment};"
        ));
    }
    (sql, manual_review, warnings)
}

pub(crate) fn add_constraint_sql(
    kind: DatabaseKind,
    source_schema: &str,
    target_schema: &str,
    table: &str,
    constraint: &ConstraintInfo,
) -> Option<String> {
    if let Some(definition) =
        constraint_definition_sql(kind, source_schema, target_schema, constraint)
    {
        return Some(format!(
            "ALTER TABLE {} ADD CONSTRAINT {} {};",
            kind.qualified_table(Some(target_schema), table),
            kind.quote_identifier(&constraint.name),
            definition
        ));
    }
    let normalized = constraint.constraint_type.to_ascii_uppercase();
    if normalized.contains("PRIMARY") {
        return Some(kind.add_primary_key_constraint_query(
            Some(target_schema),
            table,
            &constraint.name,
            &constraint.columns,
        ));
    }
    if normalized.contains("UNIQUE") {
        return Some(kind.add_unique_constraint_query(
            Some(target_schema),
            table,
            &constraint.name,
            &constraint.columns,
        ));
    }
    if normalized.contains("FOREIGN") {
        return constraint
            .referenced_table
            .as_deref()
            .map(|referenced_table| {
                kind.add_foreign_key_constraint_query(
                    Some(target_schema),
                    table,
                    &constraint.name,
                    &constraint.columns,
                    mapped_constraint_schema(
                        kind,
                        constraint.referenced_schema.as_deref(),
                        source_schema,
                        target_schema,
                    )
                    .as_deref()
                    .or(Some(target_schema)),
                    referenced_table,
                    &constraint.referenced_columns,
                    normalized_referential_action(constraint.on_delete.as_deref()).as_deref(),
                    normalized_referential_action(constraint.on_update.as_deref()).as_deref(),
                )
            });
    }
    None
}

pub(super) fn inline_constraint_clause(
    kind: DatabaseKind,
    source_schema: &str,
    target_schema: &str,
    constraint: &ConstraintInfo,
) -> Option<String> {
    if let Some(definition) =
        constraint_definition_sql(kind, source_schema, target_schema, constraint)
    {
        return Some(format!(
            "CONSTRAINT {} {}",
            kind.quote_identifier(&constraint.name),
            definition
        ));
    }
    let normalized = constraint.constraint_type.to_ascii_uppercase();
    let columns = constraint
        .columns
        .iter()
        .map(|column| kind.quote_identifier(column))
        .collect::<Vec<_>>()
        .join(", ");
    if normalized.contains("PRIMARY") {
        return Some(format!(
            "CONSTRAINT {} PRIMARY KEY ({columns})",
            kind.quote_identifier(&constraint.name)
        ));
    }
    if normalized.contains("UNIQUE") {
        return Some(format!(
            "CONSTRAINT {} UNIQUE ({columns})",
            kind.quote_identifier(&constraint.name)
        ));
    }
    if normalized.contains("FOREIGN") {
        let referenced_table = constraint.referenced_table.as_deref()?;
        let referenced_columns = constraint
            .referenced_columns
            .iter()
            .map(|column| kind.quote_identifier(column))
            .collect::<Vec<_>>()
            .join(", ");
        let on_delete = normalized_referential_action(constraint.on_delete.as_deref())
            .map(|action| format!(" ON DELETE {action}"))
            .unwrap_or_default();
        let on_update = normalized_referential_action(constraint.on_update.as_deref())
            .map(|action| format!(" ON UPDATE {action}"))
            .unwrap_or_default();
        return Some(format!(
            "CONSTRAINT {} FOREIGN KEY ({columns}) REFERENCES {} ({referenced_columns}){on_delete}{on_update}",
            kind.quote_identifier(&constraint.name),
            kind.qualified_table(
                mapped_constraint_schema(
                    kind,
                    constraint.referenced_schema.as_deref(),
                    source_schema,
                    target_schema,
                )
                .as_deref(),
                referenced_table,
            )
        ));
    }
    None
}

pub(super) fn constraint_definition_sql(
    kind: DatabaseKind,
    source_schema: &str,
    target_schema: &str,
    constraint: &ConstraintInfo,
) -> Option<String> {
    let definition = constraint
        .definition
        .as_deref()
        .map(str::trim)
        .filter(|definition| !definition.is_empty())?
        .trim_end_matches(';');
    let normalized_type = constraint.constraint_type.to_ascii_uppercase();
    if kind == DatabaseKind::Mysql
        && normalized_type.contains("CHECK")
        && !definition.to_ascii_uppercase().starts_with("CHECK")
    {
        return Some(format!("CHECK ({definition})"));
    }
    Some(if kind == DatabaseKind::Postgres {
        rewrite_postgres_schema_qualified_references(definition, source_schema, target_schema)
    } else {
        definition.to_string()
    })
}

pub(super) fn mapped_constraint_schema(
    kind: DatabaseKind,
    schema: Option<&str>,
    source_schema: &str,
    target_schema: &str,
) -> Option<String> {
    schema.map(|schema| {
        if matches!(kind, DatabaseKind::Postgres | DatabaseKind::Mysql) && schema == source_schema {
            target_schema.to_string()
        } else {
            schema.to_string()
        }
    })
}

pub(super) fn normalized_referential_action(value: Option<&str>) -> Option<String> {
    let value = value?.trim();
    if value.is_empty() {
        return None;
    }
    let normalized = value.to_ascii_uppercase().replace('_', " ");
    matches!(
        normalized.as_str(),
        "NO ACTION" | "RESTRICT" | "CASCADE" | "SET NULL" | "SET DEFAULT"
    )
    .then_some(normalized)
}

pub(super) fn is_foreign_constraint(constraint: &ConstraintInfo) -> bool {
    constraint
        .constraint_type
        .to_ascii_uppercase()
        .contains("FOREIGN")
}

pub(super) fn column_structure_changed(source: &ColumnInfo, target: &ColumnInfo) -> bool {
    source.data_type != target.data_type
        || source.is_nullable != target.is_nullable
        || source.is_auto_increment != target.is_auto_increment
        || source.identity_generation != target.identity_generation
        || source.is_generated != target.is_generated
        || source.is_hidden != target.is_hidden
        || source.default_value != target.default_value
        || source.comment != target.comment
}

pub(super) fn index_structure_changed(source: &IndexInfo, target: &IndexInfo) -> bool {
    source.name != target.name
        || source.columns != target.columns
        || source.is_unique != target.is_unique
        || source.is_primary != target.is_primary
        || source.filter != target.filter
        || source.index_type != target.index_type
        || source.included_columns != target.included_columns
        || source.definition != target.definition
        || source.key_is_expression != target.key_is_expression
}

/// View definitions are persisted as a single read-only SELECT body. Reject
/// catalog output that is not a stand-alone query so schema-diff generation
/// cannot accidentally replay multi-statement or DDL source text.
pub(super) fn normalized_view_select_definition(definition: Option<&str>) -> Option<String> {
    let definition = definition?.trim().trim_end_matches(';').trim();
    if definition.is_empty() || definition.contains(';') {
        return None;
    }
    let upper = definition.to_ascii_uppercase();
    if upper.starts_with("SELECT ") || upper.starts_with("WITH ") {
        Some(definition.to_string())
    } else {
        None
    }
}

pub(super) fn external_view_dependency_warnings(relation: &SchemaRelationSnapshot) -> Vec<String> {
    if relation.external_dependencies.is_empty() {
        return Vec::new();
    }
    vec![format!(
        "View {} references out-of-scope PostgreSQL relation(s): {}. Verify those target objects and schema mappings before applying generated DDL.",
        relation.name,
        relation.external_dependencies.join(", ")
    )]
}
