use super::plan_model::change;
use super::postgres_refs::rewrite_postgres_schema_qualified_references;
use super::types::{
    SchemaChange, SchemaChangeKind, SchemaChangePhase, SchemaChangeRisk, SchemaNameMapping,
    SchemaObjectSnapshot, SchemaSequenceOwnerSnapshot,
};
use crate::core::dialect::DatabaseKind;
use std::collections::BTreeMap;

pub(super) fn schema_object_map(
    objects: &[SchemaObjectSnapshot],
) -> BTreeMap<String, &SchemaObjectSnapshot> {
    objects
        .iter()
        .map(|object| (schema_object_identity(object), object))
        .collect()
}

pub(super) fn schema_object_identity(object: &SchemaObjectSnapshot) -> String {
    format!(
        "{}:{}:{}",
        object.object_type.to_ascii_uppercase(),
        object.parent_name.as_deref().unwrap_or_default(),
        object.name,
    )
}

pub(super) fn schema_object_label(object: &SchemaObjectSnapshot) -> String {
    match object.parent_name.as_deref() {
        Some(parent) => format!("{} {} (parent: {parent})", object.object_type, object.name),
        None => format!("{} {}", object.object_type, object.name),
    }
}

pub(super) fn schema_object_review_change(
    kind: SchemaChangeKind,
    schema_name: &str,
    object: &SchemaObjectSnapshot,
    summary: String,
) -> SchemaChange {
    let mut change = change(
        kind,
        SchemaChangeRisk::Review,
        schema_name,
        &object.name,
        Some(object.object_type.clone()),
        object.parent_name.clone(),
        summary,
        Vec::new(),
        false,
        true,
    );
    change.phase = SchemaChangePhase::ManualReview;
    change.blocked_reason = Some(
        "Schema object descriptors do not include source/DDL; review and apply this change manually."
            .to_string(),
    );
    change
}

pub(super) fn schema_object_review_change_with_definition(
    kind: SchemaChangeKind,
    database_kind: Option<DatabaseKind>,
    source_schema: &str,
    target_schema: &str,
    schema_name: &str,
    object: &SchemaObjectSnapshot,
    summary: String,
) -> SchemaChange {
    let is_trigger = object.object_type.eq_ignore_ascii_case("trigger");
    let is_sequence = object.object_type.eq_ignore_ascii_case("sequence");
    let is_event = object.object_type.eq_ignore_ascii_case("event");
    let definition = object
        .definition
        .as_deref()
        .map(str::trim)
        .filter(|definition| !definition.is_empty());
    let executable_definition = match (kind, database_kind, is_trigger, is_sequence, definition) {
        (
            SchemaChangeKind::SchemaObjectCreate,
            Some(DatabaseKind::Postgres),
            true,
            _,
            Some(definition),
        ) if definition.to_ascii_uppercase().starts_with("CREATE ") => Some(
            rewrite_postgres_schema_qualified_references(definition, source_schema, target_schema),
        ),
        (
            SchemaChangeKind::SchemaObjectCreate,
            Some(DatabaseKind::Postgres),
            _,
            true,
            Some(definition),
        ) if definition
            .to_ascii_uppercase()
            .starts_with("CREATE SEQUENCE ") =>
        {
            Some(rewrite_postgres_schema_qualified_references(
                definition,
                source_schema,
                target_schema,
            ))
        }
        (
            SchemaChangeKind::SchemaObjectCreate,
            Some(DatabaseKind::Mysql),
            true,
            _,
            Some(definition),
        ) if is_simple_mysql_trigger_definition(definition) => Some(definition.to_string()),
        (
            SchemaChangeKind::SchemaObjectCreate,
            Some(DatabaseKind::Mysql),
            _,
            _,
            Some(definition),
        ) if is_event && is_safe_mysql_event_definition(definition) => Some(definition.to_string()),
        _ => None,
    };
    let sql = executable_definition.into_iter().collect::<Vec<_>>();
    let mut change = change(
        kind,
        SchemaChangeRisk::Review,
        schema_name,
        &object.name,
        Some(object.object_type.clone()),
        object.parent_name.clone(),
        summary,
        sql,
        kind == SchemaChangeKind::SchemaObjectCreate && is_sequence,
        true,
    );
    if change.sql.is_empty() {
        change.phase = SchemaChangePhase::ManualReview;
        change.blocked_reason = Some(
            "Schema object source/DDL is unavailable or lacks a reviewed native create definition."
                .to_string(),
        );
    }
    change
}

pub(super) fn postgres_sequence_owner_ddl(
    schema_name: &str,
    sequence_name: &str,
    owner: &SchemaSequenceOwnerSnapshot,
) -> String {
    format!(
        "ALTER SEQUENCE {} OWNED BY {}.{};",
        DatabaseKind::Postgres.qualified_table(Some(schema_name), sequence_name),
        DatabaseKind::Postgres.qualified_table(Some(schema_name), &owner.table_name),
        DatabaseKind::Postgres.quote_identifier(&owner.column_name),
    )
}

pub(super) fn postgres_sequence_setval_ddl(
    schema_name: &str,
    sequence_name: &str,
    last_value: &str,
    is_called: bool,
) -> String {
    let qualified = DatabaseKind::Postgres.qualified_table(Some(schema_name), sequence_name);
    let literal = format!("'{}'", qualified.replace('\'', "''"));
    format!("SELECT pg_catalog.setval({literal}::regclass, {last_value}, {is_called});")
}

pub(super) fn postgres_sequence_unowned_ddl(schema_name: &str, sequence_name: &str) -> String {
    format!(
        "ALTER SEQUENCE {} OWNED BY NONE;",
        DatabaseKind::Postgres.qualified_table(Some(schema_name), sequence_name),
    )
}

pub(super) fn postgres_sequence_structure_eq(
    source: &SchemaObjectSnapshot,
    target: &SchemaObjectSnapshot,
) -> bool {
    source.name == target.name
        && source.object_type.eq_ignore_ascii_case(&target.object_type)
        && source.parent_name == target.parent_name
        && source.description == target.description
        && source.definition == target.definition
        && source.dependencies == target.dependencies
}

/// Keep state restoration distinct from CREATE SEQUENCE: new relations that
/// use `nextval()` depend on sequence creation, while `OWNED BY table.column`
/// must run only after the relation has been created.
pub(super) fn postgres_sequence_state_change(
    schema_name: &str,
    object: &SchemaObjectSnapshot,
    target: Option<&SchemaObjectSnapshot>,
) -> Option<SchemaChange> {
    if !object.object_type.eq_ignore_ascii_case("sequence") {
        return None;
    }
    let mut sql = Vec::new();
    if target.is_none_or(|target| target.sequence_owner != object.sequence_owner) {
        if let Some(owner) = object.sequence_owner.as_ref() {
            sql.push(postgres_sequence_owner_ddl(
                schema_name,
                &object.name,
                owner,
            ));
        } else if target.is_some_and(|target| target.sequence_owner.is_some()) {
            sql.push(postgres_sequence_unowned_ddl(schema_name, &object.name));
        }
    }
    let state_changed = target.is_none_or(|target| {
        target.sequence_last_value != object.sequence_last_value
            || target.sequence_is_called != object.sequence_is_called
    });
    if let Some(last_value) = state_changed
        .then_some(object.sequence_last_value.as_deref())
        .flatten()
        .filter(|value| value.parse::<i64>().is_ok())
    {
        sql.push(postgres_sequence_setval_ddl(
            schema_name,
            &object.name,
            last_value,
            object.sequence_is_called.unwrap_or(true),
        ));
    }
    if sql.is_empty() {
        return None;
    }
    let mut change = change(
        SchemaChangeKind::SchemaObjectModify,
        SchemaChangeRisk::Review,
        schema_name,
        &object.name,
        Some(object.object_type.clone()),
        Some("ownership/state".to_string()),
        format!("Restore ownership/state for sequence {}", object.name),
        sql,
        false,
        true,
    );
    change.phase = SchemaChangePhase::ManualReview;
    Some(change)
}

/// MySQL compound triggers require a client-side delimiter protocol, which a
/// schema-diff plan deliberately does not emulate. A catalog-built, single
/// statement trigger can be applied safely as one review-gated unit; anything
/// with a statement separator stays blocked for manual migration.
pub(super) fn is_simple_mysql_trigger_definition(definition: &str) -> bool {
    let normalized = definition.trim().to_ascii_uppercase();
    normalized.starts_with("CREATE TRIGGER ")
        && !normalized.contains("DEFINER")
        && !definition.contains(';')
}

/// The snapshot command creates these definitions through the closed Event
/// administration vocabulary. Keep an independent structural gate here so a
/// hand-edited snapshot cannot turn an arbitrary schema object into executable
/// MySQL DDL.
pub(super) fn is_safe_mysql_event_definition(definition: &str) -> bool {
    let normalized = definition.trim().to_ascii_uppercase();
    normalized.starts_with("CREATE EVENT ")
        && normalized.contains(" ON SCHEDULE ")
        && normalized.contains(" DO ")
        && !normalized.contains("DEFINER")
        && definition.matches(';').count() == 1
        && definition.trim_end().ends_with(';')
}

pub(super) fn compare_schema_objects(
    database_kind: Option<DatabaseKind>,
    schema_mapping: SchemaNameMapping<'_>,
    source: &[SchemaObjectSnapshot],
    target: &[SchemaObjectSnapshot],
    schema_name: &str,
    changes: &mut Vec<SchemaChange>,
    warnings: &mut Vec<String>,
) {
    let source_objects = schema_object_map(source);
    let target_objects = schema_object_map(target);
    let mut identities = source_objects
        .keys()
        .chain(target_objects.keys())
        .cloned()
        .collect::<Vec<_>>();
    identities.sort();
    identities.dedup();

    let change_start = changes.len();
    for identity in identities {
        match (source_objects.get(&identity), target_objects.get(&identity)) {
            (Some(source_object), None) => {
                changes.push(schema_object_review_change_with_definition(
                    SchemaChangeKind::SchemaObjectCreate,
                    database_kind,
                    schema_mapping.source,
                    schema_mapping.target,
                    schema_name,
                    source_object,
                    format!("Review creation of {}", schema_object_label(source_object)),
                ));
                if database_kind == Some(DatabaseKind::Postgres) {
                    if let Some(state_change) =
                        postgres_sequence_state_change(schema_name, source_object, None)
                    {
                        changes.push(state_change);
                    }
                }
            }
            (None, Some(target_object)) => changes.push(schema_object_review_change(
                SchemaChangeKind::SchemaObjectDrop,
                schema_name,
                target_object,
                format!("Review removal of {}", schema_object_label(target_object)),
            )),
            (Some(source_object), Some(target_object))
                if database_kind == Some(DatabaseKind::Postgres)
                    && source_object.object_type.eq_ignore_ascii_case("sequence")
                    && target_object.object_type.eq_ignore_ascii_case("sequence")
                    && postgres_sequence_structure_eq(source_object, target_object) =>
            {
                if let Some(state_change) =
                    postgres_sequence_state_change(schema_name, source_object, Some(target_object))
                {
                    changes.push(state_change);
                }
            }
            (Some(source_object), Some(target_object)) if source_object != target_object => {
                changes.push(schema_object_review_change_with_definition(
                    SchemaChangeKind::SchemaObjectModify,
                    database_kind,
                    schema_mapping.source,
                    schema_mapping.target,
                    schema_name,
                    source_object,
                    format!("Review changed {}", schema_object_label(source_object)),
                ));
            }
            _ => {}
        }
    }
    if changes.len() > change_start {
        let catalog_backed = source.iter().any(|object| {
            object
                .definition
                .as_deref()
                .is_some_and(|definition| !definition.trim().is_empty())
                && (object.object_type.eq_ignore_ascii_case("trigger")
                    || object.object_type.eq_ignore_ascii_case("event")
                    || object.object_type.eq_ignore_ascii_case("sequence"))
        });
        warnings.push(if catalog_backed && database_kind == Some(DatabaseKind::Postgres) {
            "PostgreSQL catalog trigger/sequence DDL is included only for review-gated creation and sequence state restoration; object removal remains blocked."
                .to_string()
        } else if catalog_backed && database_kind == Some(DatabaseKind::Mysql) {
            "MySQL catalog trigger/event DDL is included only for review-gated single-statement creation; compound bodies and object removal remain blocked."
                .to_string()
        } else {
            "Schema object descriptor drift is review-only: source/DDL and automatic migration are intentionally unavailable."
                .to_string()
        });
    }
}
