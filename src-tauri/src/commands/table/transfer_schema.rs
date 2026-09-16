//! Transfer schema for table operations.

use super::access::{get_target_columns, query_target};
use super::export_sql::sql_string_literal;
use super::limits::{MAX_TRANSFER_SCHEMA_RESTORE_OBJECTS, MAX_TRANSFER_SCHEMA_RESTORE_SQL_BYTES};
use super::sqlite_ddl::{
    is_sqlite_driver, normalized_sqlite_schema, rewrite_sqlite_create_index_for_transfer,
    rewrite_sqlite_create_table_for_transfer, sqlite_quote_identifier,
    sqlite_transfer_target_index_name,
};
use super::transfer_plan::endpoint_label;
use super::transfer_runtime::normalized_transfer_driver_id;
use super::transfer_types::{
    TableDataTransferEndpoint, TableDataTransferRequest, TableDataTransferTargetPlanRequest,
};
use crate::core::dialect::DatabaseKind;
use crate::core::manager::ConnectionManager;
use crate::core::protocol::ColumnInfo;
use crate::core::protocol::ConstraintInfo;
use crate::core::protocol::IndexInfo;
use serde_json::Value;
use std::collections::BTreeMap;
use std::collections::BTreeSet;
use std::collections::HashSet;

pub(super) async fn get_transfer_indexes(
    manager: &ConnectionManager,
    endpoint: &TableDataTransferEndpoint,
) -> Result<Vec<IndexInfo>, String> {
    match endpoint.database.as_deref() {
        Some(database) => {
            manager
                .get_database_indexes(
                    &endpoint.connection_id,
                    database,
                    &endpoint.schema,
                    &endpoint.table,
                )
                .await
        }
        None => {
            manager
                .get_indexes(&endpoint.connection_id, &endpoint.schema, &endpoint.table)
                .await
        }
    }
    .map_err(|error| error.to_string())
}

pub(super) async fn get_sqlite_table_source_ddl(
    manager: &ConnectionManager,
    endpoint: &TableDataTransferEndpoint,
) -> Result<String, String> {
    let schema = sqlite_quote_identifier(normalized_sqlite_schema(&endpoint.schema));
    let sql = format!(
        "SELECT sql FROM {schema}.sqlite_schema WHERE type = 'table' AND name = {} AND sql IS NOT NULL;",
        sql_string_literal(endpoint.table.trim())
    );
    let results = query_target(
        manager,
        &endpoint.connection_id,
        endpoint.database.as_deref(),
        &sql,
    )
    .await
    .map_err(|error| format!("Could not read the SQLite table definition: {error}"))?;
    let definition = results
        .iter()
        .flat_map(|result| result.rows.iter())
        .find_map(|row| row.first().and_then(Value::as_str))
        .map(str::trim)
        .filter(|definition| !definition.is_empty())
        .ok_or_else(|| {
            format!(
                "SQLite catalog did not return an exact table definition for {}",
                endpoint_label(endpoint)
            )
        })?;
    Ok(definition.to_string())
}

pub(super) fn sqlite_transfer_can_preserve_catalog_schema(
    source: &TableDataTransferEndpoint,
    target: &TableDataTransferEndpoint,
) -> bool {
    is_sqlite_driver(&source.driver) && is_sqlite_driver(&target.driver)
}

pub(super) async fn ensure_sqlite_target_index_absent(
    manager: &ConnectionManager,
    endpoint: &TableDataTransferEndpoint,
    index_name: &str,
) -> Result<(), String> {
    let schema = sqlite_quote_identifier(normalized_sqlite_schema(&endpoint.schema));
    let sql = format!(
        "SELECT name FROM {schema}.sqlite_schema WHERE type = 'index' AND name = {} LIMIT 1;",
        sql_string_literal(index_name)
    );
    let results = query_target(
        manager,
        &endpoint.connection_id,
        endpoint.database.as_deref(),
        &sql,
    )
    .await
    .map_err(|error| format!("Could not validate the SQLite target index namespace: {error}"))?;
    if results.iter().any(|result| !result.rows.is_empty()) {
        return Err(format!(
            "SQLite target index name already exists in schema {}: {}",
            normalized_sqlite_schema(&endpoint.schema),
            index_name
        ));
    }
    Ok(())
}

pub(super) async fn resolve_sqlite_catalog_transfer_target_statements(
    manager: &ConnectionManager,
    request: &TableDataTransferTargetPlanRequest,
) -> Result<Vec<String>, String> {
    if !sqlite_transfer_can_preserve_catalog_schema(&request.source, &request.target) {
        return Err(
            "SQLite catalog schema preservation requires native SQLite source and target endpoints."
                .to_string()
        );
    }
    if manager
        .is_external_driver_connection(&request.source.connection_id)
        .await
        .map_err(|error| error.to_string())?
        || manager
            .is_external_driver_connection(&request.target.connection_id)
            .await
            .map_err(|error| error.to_string())?
    {
        return Err(
            "External SQLite packages cannot reuse catalog DDL until their signed protocol declares an exact semantic DDL contract."
                .to_string(),
        );
    }

    let table_definition = get_sqlite_table_source_ddl(manager, &request.source).await?;
    let mut statements = vec![rewrite_sqlite_create_table_for_transfer(
        &table_definition,
        &request.source.table,
        &request.target.schema,
        &request.target.table,
    )?];
    let indexes = get_transfer_indexes(manager, &request.source).await?;
    for index in indexes {
        if index.is_primary || index.name.starts_with("sqlite_autoindex_") {
            continue;
        }
        let definition = index.definition.as_deref().ok_or_else(|| {
            format!(
                "SQLite index {} has no exact catalog definition; target creation is blocked to avoid silently dropping it.",
                index.name
            )
        })?;
        let target_index_name = sqlite_transfer_target_index_name(
            &request.source.table,
            &request.target.table,
            &index.name,
        );
        ensure_sqlite_target_index_absent(manager, &request.target, &target_index_name).await?;
        statements.push(rewrite_sqlite_create_index_for_transfer(
            definition,
            &request.target.schema,
            &request.target.table,
            &target_index_name,
            index.is_unique,
        )?);
    }
    if statements.len() > MAX_TRANSFER_SCHEMA_RESTORE_OBJECTS {
        return Err(format!(
            "SQLite target creation is limited to {MAX_TRANSFER_SCHEMA_RESTORE_OBJECTS} catalog statements."
        ));
    }
    let total_bytes = statements.iter().map(String::len).sum::<usize>();
    if total_bytes > MAX_TRANSFER_SCHEMA_RESTORE_SQL_BYTES {
        return Err(format!(
            "SQLite target creation SQL exceeds the {} byte review limit.",
            MAX_TRANSFER_SCHEMA_RESTORE_SQL_BYTES
        ));
    }
    Ok(statements)
}

pub(super) async fn get_transfer_constraints(
    manager: &ConnectionManager,
    endpoint: &TableDataTransferEndpoint,
) -> Result<Vec<ConstraintInfo>, String> {
    match endpoint.database.as_deref() {
        Some(database) => {
            manager
                .get_database_constraints(
                    &endpoint.connection_id,
                    database,
                    &endpoint.schema,
                    &endpoint.table,
                )
                .await
        }
        None => {
            manager
                .get_constraints(&endpoint.connection_id, &endpoint.schema, &endpoint.table)
                .await
        }
    }
    .map_err(|error| error.to_string())
}

pub(super) fn transfer_index_structure_matches(source: &IndexInfo, target: &IndexInfo) -> bool {
    source.columns == target.columns
        && source.is_unique == target.is_unique
        && source.is_primary == target.is_primary
        && source.filter == target.filter
        && source
            .index_type
            .as_deref()
            .unwrap_or_default()
            .eq_ignore_ascii_case(target.index_type.as_deref().unwrap_or_default())
        && source.included_columns == target.included_columns
        && source.key_is_expression == target.key_is_expression
        && source.comment == target.comment
}

pub(super) fn mapped_transfer_constraint_schema(
    schema: Option<&str>,
    source_schema: &str,
    target_schema: &str,
) -> Option<String> {
    schema.map(|schema| {
        if schema.eq_ignore_ascii_case(source_schema) {
            target_schema.to_string()
        } else {
            schema.to_string()
        }
    })
}

pub(super) fn normalized_transfer_referential_action(value: Option<&str>) -> Option<String> {
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

pub(super) fn transfer_constraint_structure_matches(
    source: &ConstraintInfo,
    target: &ConstraintInfo,
    source_schema: &str,
    target_schema: &str,
) -> bool {
    source
        .constraint_type
        .eq_ignore_ascii_case(&target.constraint_type)
        && source.columns == target.columns
        && mapped_transfer_constraint_schema(
            source.referenced_schema.as_deref(),
            source_schema,
            target_schema,
        ) == target.referenced_schema
        && source.referenced_table == target.referenced_table
        && source.referenced_columns == target.referenced_columns
        && source.definition.as_deref().map(str::trim)
            == target.definition.as_deref().map(str::trim)
        && normalized_transfer_referential_action(source.on_update.as_deref())
            == normalized_transfer_referential_action(target.on_update.as_deref())
        && normalized_transfer_referential_action(source.on_delete.as_deref())
            == normalized_transfer_referential_action(target.on_delete.as_deref())
}

pub(super) fn transfer_constraint_is_primary(constraint: &ConstraintInfo) -> bool {
    constraint
        .constraint_type
        .to_ascii_uppercase()
        .contains("PRIMARY")
}

pub(super) fn transfer_constraint_is_foreign(constraint: &ConstraintInfo) -> bool {
    constraint
        .constraint_type
        .to_ascii_uppercase()
        .contains("FOREIGN")
}

#[derive(Clone, Copy)]
pub(super) struct TransferTableSchemaObjects<'a> {
    pub(super) indexes: &'a [IndexInfo],
    pub(super) constraints: &'a [ConstraintInfo],
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(super) struct TransferSchemaRestorePlan {
    pub(super) statements: Vec<String>,
    pub(super) immediate_statements: Vec<String>,
    pub(super) deferred_foreign_key_statements: Vec<String>,
    pub(super) deferred_foreign_key_names: Vec<String>,
}

pub(super) fn build_transfer_schema_restore_plan(
    kind: DatabaseKind,
    source_schema: &str,
    target_schema: &str,
    table: &str,
    source: TransferTableSchemaObjects<'_>,
    target: TransferTableSchemaObjects<'_>,
) -> Result<TransferSchemaRestorePlan, String> {
    let target_indexes_by_name = target
        .indexes
        .iter()
        .map(|index| (index.name.as_str(), index))
        .collect::<BTreeMap<_, _>>();
    let target_constraints_by_name = target
        .constraints
        .iter()
        .map(|constraint| (constraint.name.as_str(), constraint))
        .collect::<BTreeMap<_, _>>();
    let source_constraint_names = source
        .constraints
        .iter()
        .map(|constraint| constraint.name.as_str())
        .collect::<HashSet<_>>();

    let mut regular_constraints = Vec::new();
    let mut foreign_keys = Vec::new();
    for constraint in source
        .constraints
        .iter()
        .filter(|constraint| !transfer_constraint_is_primary(constraint))
    {
        let name = constraint.name.trim();
        if name.is_empty() {
            return Err(format!(
                "Source table {table} has an unnamed non-primary constraint; exact restoration is blocked."
            ));
        }
        if let Some(existing) = target_constraints_by_name.get(name) {
            if transfer_constraint_structure_matches(
                constraint,
                existing,
                source_schema,
                target_schema,
            ) {
                continue;
            }
            return Err(format!(
                "Target constraint {name} already exists with a different definition."
            ));
        }
        if target_indexes_by_name.contains_key(name) {
            return Err(format!(
                "Target index {name} conflicts with the source constraint of the same name."
            ));
        }
        let statement = crate::core::schema_diff::add_constraint_sql(
            kind,
            source_schema,
            target_schema,
            table,
            constraint,
        )
        .ok_or_else(|| {
            format!(
                "Constraint {name} has no catalog-backed definition that can be restored safely."
            )
        })?;
        if transfer_constraint_is_foreign(constraint) {
            foreign_keys.push((name.to_string(), statement));
        } else {
            regular_constraints.push(statement);
        }
    }

    let mut indexes = Vec::new();
    for index in source
        .indexes
        .iter()
        .filter(|index| !index.is_primary && !source_constraint_names.contains(index.name.as_str()))
    {
        let name = index.name.trim();
        if name.is_empty() {
            return Err(format!(
                "Source table {table} has an unnamed secondary index; exact restoration is blocked."
            ));
        }
        if let Some(existing) = target_indexes_by_name.get(name) {
            if transfer_index_structure_matches(index, existing) {
                continue;
            }
            return Err(format!(
                "Target index {name} already exists with a different definition."
            ));
        }
        if target_constraints_by_name.contains_key(name) {
            return Err(format!(
                "Target constraint {name} conflicts with the source index of the same name."
            ));
        }
        indexes.push(crate::core::schema_diff::create_index_sql(
            kind,
            source_schema,
            target_schema,
            table,
            index,
        )?);
        if kind == DatabaseKind::Postgres {
            if let Some(comment) = index
                .comment
                .as_deref()
                .map(str::trim)
                .filter(|comment| !comment.is_empty())
            {
                let qualified_index = kind.qualified_table(Some(target_schema), name);
                indexes.push(format!(
                    "COMMENT ON INDEX {qualified_index} IS {};",
                    sql_string_literal(comment)
                ));
            }
        }
    }

    regular_constraints.extend(indexes);
    let immediate_statements = regular_constraints;
    let deferred_foreign_key_names = foreign_keys
        .iter()
        .map(|(name, _)| name.clone())
        .collect::<Vec<_>>();
    let deferred_foreign_key_statements = foreign_keys
        .into_iter()
        .map(|(_, statement)| statement)
        .collect::<Vec<_>>();
    let mut statements = immediate_statements.clone();
    statements.extend(deferred_foreign_key_statements.iter().cloned());
    if statements.len() > MAX_TRANSFER_SCHEMA_RESTORE_OBJECTS {
        return Err(format!(
            "Schema restoration is limited to {MAX_TRANSFER_SCHEMA_RESTORE_OBJECTS} statements per table."
        ));
    }
    let total_bytes = statements.iter().map(String::len).sum::<usize>();
    if total_bytes > MAX_TRANSFER_SCHEMA_RESTORE_SQL_BYTES {
        return Err(format!(
            "Schema restoration SQL exceeds the {} byte review limit.",
            MAX_TRANSFER_SCHEMA_RESTORE_SQL_BYTES
        ));
    }
    Ok(TransferSchemaRestorePlan {
        statements,
        immediate_statements,
        deferred_foreign_key_statements,
        deferred_foreign_key_names,
    })
}

pub(super) fn portable_transfer_index(index: &IndexInfo) -> Result<IndexInfo, String> {
    if index.is_primary {
        return Ok(index.clone());
    }
    if index.name.trim().is_empty() || index.columns.is_empty() {
        return Err(
            "Portable secondary indexes require a name and at least one key column.".to_string(),
        );
    }
    if (!index.key_is_expression.is_empty() && index.key_is_expression.len() != index.columns.len())
        || index
            .key_is_expression
            .iter()
            .any(|is_expression| *is_expression)
    {
        return Err(format!(
            "Index {} contains an expression key that has no deterministic cross-product mapping.",
            index.name
        ));
    }
    if index
        .filter
        .as_deref()
        .is_some_and(|filter| !filter.trim().is_empty())
    {
        return Err(format!(
            "Index {} is partial/filtered and has no deterministic cross-product mapping.",
            index.name
        ));
    }
    if index
        .included_columns
        .as_ref()
        .is_some_and(|columns| !columns.is_empty())
    {
        return Err(format!(
            "Index {} contains included columns and has no deterministic cross-product mapping.",
            index.name
        ));
    }
    if index
        .index_type
        .as_deref()
        .is_some_and(|kind| !kind.trim().is_empty() && !kind.eq_ignore_ascii_case("BTREE"))
    {
        return Err(format!(
            "Index {} does not use the portable BTREE access method.",
            index.name
        ));
    }
    if index
        .comment
        .as_deref()
        .is_some_and(|comment| !comment.trim().is_empty())
    {
        return Err(format!(
            "Index {} has a product-specific comment that cannot be retained by this mapping.",
            index.name
        ));
    }
    if let Some(definition) = index.definition.as_deref() {
        let normalized = definition.to_ascii_uppercase();
        if [
            " DESC",
            " NULLS ",
            " COLLATE ",
            "_OPS",
            " WITH (",
            " TABLESPACE ",
        ]
        .iter()
        .any(|clause| normalized.contains(clause))
        {
            return Err(format!(
                "Index {} contains ordering, collation, operator-class, storage, or tablespace semantics that cannot be retained across products.",
                index.name
            ));
        }
    }
    Ok(IndexInfo {
        definition: None,
        filter: None,
        included_columns: None,
        index_type: Some("BTREE".to_string()),
        comment: None,
        key_is_expression: vec![false; index.columns.len()],
        ..index.clone()
    })
}

pub(super) fn portable_transfer_constraint(
    constraint: &ConstraintInfo,
) -> Result<ConstraintInfo, String> {
    if transfer_constraint_is_primary(constraint) {
        return Ok(constraint.clone());
    }
    let constraint_type = constraint.constraint_type.to_ascii_uppercase();
    if constraint_type.contains("CHECK") {
        return Err(format!(
            "CHECK constraint {} contains a source-dialect expression and requires an explicit target mapping.",
            constraint.name
        ));
    }
    if !constraint_type.contains("UNIQUE") && !constraint_type.contains("FOREIGN") {
        return Err(format!(
            "Constraint {} has unsupported cross-product type {}.",
            constraint.name, constraint.constraint_type
        ));
    }
    if constraint.name.trim().is_empty() || constraint.columns.is_empty() {
        return Err(
            "Portable UNIQUE/FOREIGN KEY constraints require a name and key columns.".to_string(),
        );
    }
    let normalized_definition = constraint
        .definition
        .as_deref()
        .unwrap_or_default()
        .to_ascii_uppercase();
    if constraint_type.contains("UNIQUE")
        && [
            "NULLS NOT DISTINCT",
            "DEFERRABLE",
            "INITIALLY ",
            "USING INDEX",
            " INCLUDE ",
        ]
        .iter()
        .any(|clause| normalized_definition.contains(clause))
    {
        return Err(format!(
            "UNIQUE constraint {} contains null, deferrability, backing-index, or include semantics that cannot be retained across products.",
            constraint.name
        ));
    }
    if constraint_type.contains("FOREIGN") {
        if constraint
            .referenced_table
            .as_deref()
            .is_none_or(|table| table.trim().is_empty())
            || constraint.referenced_columns.len() != constraint.columns.len()
            || constraint.referenced_columns.is_empty()
        {
            return Err(format!(
                "Foreign key {} has an incomplete structured reference mapping.",
                constraint.name
            ));
        }
        for (label, action) in [
            ("ON DELETE", constraint.on_delete.as_deref()),
            ("ON UPDATE", constraint.on_update.as_deref()),
        ] {
            if action.is_some_and(|action| {
                !action.trim().is_empty()
                    && normalized_transfer_referential_action(Some(action)).is_none()
            }) {
                return Err(format!(
                    "Foreign key {} uses an unsupported {label} action.",
                    constraint.name
                ));
            }
        }
        if [
            "DEFERRABLE",
            "INITIALLY ",
            "NOT VALID",
            "MATCH FULL",
            "MATCH PARTIAL",
        ]
        .iter()
        .any(|clause| normalized_definition.contains(clause))
            || (normalized_definition.contains("ON DELETE")
                && normalized_transfer_referential_action(constraint.on_delete.as_deref())
                    .is_none())
            || (normalized_definition.contains("ON UPDATE")
                && normalized_transfer_referential_action(constraint.on_update.as_deref())
                    .is_none())
        {
            return Err(format!(
                "Foreign key {} contains unrepresented match, deferrability, validation, or referential-action semantics.",
                constraint.name
            ));
        }
    }
    Ok(ConstraintInfo {
        definition: None,
        ..constraint.clone()
    })
}

pub(super) fn build_portable_transfer_schema_restore_plan(
    target_kind: DatabaseKind,
    source_schema: &str,
    target_schema: &str,
    table: &str,
    source: TransferTableSchemaObjects<'_>,
    target: TransferTableSchemaObjects<'_>,
    target_columns: &[ColumnInfo],
) -> Result<TransferSchemaRestorePlan, String> {
    let target_column_names = target_columns
        .iter()
        .map(|column| column.name.as_str())
        .collect::<HashSet<_>>();
    let source_indexes = source
        .indexes
        .iter()
        .map(portable_transfer_index)
        .collect::<Result<Vec<_>, _>>()?;
    let source_constraints = source
        .constraints
        .iter()
        .map(portable_transfer_constraint)
        .collect::<Result<Vec<_>, _>>()?;
    let used_columns = source_indexes
        .iter()
        .filter(|index| !index.is_primary)
        .flat_map(|index| index.columns.iter())
        .chain(
            source_constraints
                .iter()
                .filter(|constraint| !transfer_constraint_is_primary(constraint))
                .flat_map(|constraint| constraint.columns.iter()),
        )
        .filter(|column| !target_column_names.contains(column.as_str()))
        .cloned()
        .collect::<BTreeSet<_>>();
    if !used_columns.is_empty() {
        return Err(format!(
            "Portable schema restoration requires exact target column identities; missing: {}.",
            used_columns.into_iter().collect::<Vec<_>>().join(", ")
        ));
    }

    let target_indexes = target
        .indexes
        .iter()
        .map(|index| portable_transfer_index(index).unwrap_or_else(|_| index.clone()))
        .collect::<Vec<_>>();
    let target_constraints = target
        .constraints
        .iter()
        .map(|constraint| {
            portable_transfer_constraint(constraint).unwrap_or_else(|_| constraint.clone())
        })
        .collect::<Vec<_>>();
    build_transfer_schema_restore_plan(
        target_kind,
        source_schema,
        target_schema,
        table,
        TransferTableSchemaObjects {
            indexes: &source_indexes,
            constraints: &source_constraints,
        },
        TransferTableSchemaObjects {
            indexes: &target_indexes,
            constraints: &target_constraints,
        },
    )
}

pub(super) async fn resolve_transfer_schema_restore_plan(
    manager: &ConnectionManager,
    request: &TableDataTransferRequest,
    source_kind: DatabaseKind,
    target_kind: DatabaseKind,
    target_columns: &[ColumnInfo],
) -> Result<TransferSchemaRestorePlan, String> {
    if !request.restore_source_schema_objects {
        return Ok(TransferSchemaRestorePlan::default());
    }
    let source_driver = normalized_transfer_driver_id(&request.source.driver);
    let target_driver = normalized_transfer_driver_id(&request.target.driver);
    if !matches!(source_driver.as_str(), "postgres" | "mysql")
        || !matches!(target_driver.as_str(), "postgres" | "mysql")
    {
        return Err(
            "Schema-object restoration requires native PostgreSQL or MySQL-family endpoints."
                .to_string(),
        );
    }
    if request.source.table != request.target.table {
        return Err(
            "Schema-object restoration currently requires the source and target table names to match exactly."
                .to_string(),
        );
    }
    if manager
        .is_external_driver_connection(&request.source.connection_id)
        .await
        .map_err(|error| error.to_string())?
        || manager
            .is_external_driver_connection(&request.target.connection_id)
            .await
            .map_err(|error| error.to_string())?
    {
        return Err(
            "External driver packages cannot restore table schema objects until their signed protocol declares an exact DDL contract."
                .to_string(),
        );
    }

    let source_indexes = get_transfer_indexes(manager, &request.source).await?;
    let target_indexes = get_transfer_indexes(manager, &request.target).await?;
    let source_constraints = get_transfer_constraints(manager, &request.source).await?;
    let target_constraints = get_transfer_constraints(manager, &request.target).await?;
    for constraint in source_constraints
        .iter()
        .filter(|constraint| transfer_constraint_is_foreign(constraint))
    {
        let referenced_table = constraint.referenced_table.as_deref().ok_or_else(|| {
            format!(
                "Foreign key {} is missing its referenced table metadata.",
                constraint.name
            )
        })?;
        if constraint.referenced_columns.is_empty()
            || constraint.referenced_columns.len() != constraint.columns.len()
        {
            return Err(format!(
                "Foreign key {} has an incomplete referenced-column mapping.",
                constraint.name
            ));
        }
        let referenced_schema = mapped_transfer_constraint_schema(
            constraint.referenced_schema.as_deref(),
            &request.source.schema,
            &request.target.schema,
        )
        .unwrap_or_else(|| request.target.schema.clone());
        let referenced_columns = get_target_columns(
            manager,
            &request.target.connection_id,
            request.target.database.as_deref(),
            &referenced_schema,
            referenced_table,
        )
        .await
        .map_err(|error| {
            format!(
                "Referenced target table {referenced_schema}.{referenced_table} is unavailable for foreign key {}: {error}",
                constraint.name
            )
        })?;
        let available = referenced_columns
            .iter()
            .map(|column| column.name.as_str())
            .collect::<HashSet<_>>();
        let missing = constraint
            .referenced_columns
            .iter()
            .filter(|column| !available.contains(column.as_str()))
            .cloned()
            .collect::<Vec<_>>();
        if !missing.is_empty() {
            return Err(format!(
                "Foreign key {} references missing target column(s): {}.",
                constraint.name,
                missing.join(", ")
            ));
        }
    }

    let source_objects = TransferTableSchemaObjects {
        indexes: &source_indexes,
        constraints: &source_constraints,
    };
    let target_objects = TransferTableSchemaObjects {
        indexes: &target_indexes,
        constraints: &target_constraints,
    };
    if source_kind == target_kind && source_driver == target_driver {
        build_transfer_schema_restore_plan(
            target_kind,
            &request.source.schema,
            &request.target.schema,
            &request.target.table,
            source_objects,
            target_objects,
        )
    } else {
        build_portable_transfer_schema_restore_plan(
            target_kind,
            &request.source.schema,
            &request.target.schema,
            &request.target.table,
            source_objects,
            target_objects,
            target_columns,
        )
    }
}
