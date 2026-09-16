use super::metadata_children::compare_metadata_children;
use super::objects::{compare_schema_objects, schema_object_identity};
use super::plan_model::{change, hex_digest, relation_map, stable_id};
use super::render::{relation_flags, summarize_changes};
use super::routines::compare_routines;
use super::types::{
    SchemaChange, SchemaChangeKind, SchemaChangePhase, SchemaChangeRisk, SchemaDiffExecutionOwner,
    SchemaDiffPlan, SchemaNameMapping, SchemaObjectSnapshot, SchemaRelationSnapshot,
    SchemaSnapshot,
};
use crate::commands::table::{
    rewrite_sqlite_create_index_for_transfer, rewrite_sqlite_create_table_for_transfer,
    rewrite_sqlite_create_trigger_for_transfer, rewrite_sqlite_create_view_for_transfer,
};
use crate::core::protocol::IndexInfo;
use crate::core::statement::{split_sql_statements, StatementScanDialect};
use anyhow::Result;
use std::collections::{BTreeMap, BTreeSet};

/// Builds a catalog-backed SQLite migration plan. Existing-table changes use a
/// replacement table and bounded same-name column copy; table/view/trigger
/// create, replace, and drop operations replay exact `sqlite_schema` source.
/// Every executable plan remains inside the driver's verified backup, write
/// transaction, foreign-key check, and post-apply recapture boundary. Missing
/// catalog source, unsafe backfills, unknown retained-view dependencies, and
/// attached schemas remain review-only.
pub(super) fn compare_sqlite_schema_snapshots(
    source: &SchemaSnapshot,
    target: &SchemaSnapshot,
    generated_at: i64,
) -> Result<SchemaDiffPlan> {
    let source_relations = relation_map(&source.relations);
    let target_relations = relation_map(&target.relations);
    let mut relation_names = source_relations
        .keys()
        .chain(target_relations.keys())
        .cloned()
        .collect::<Vec<_>>();
    relation_names.sort();
    relation_names.dedup();
    let surviving_target_views = target
        .relations
        .iter()
        .filter(|relation| {
            let flags = relation_flags(relation.object_type.as_deref());
            flags.is_view
                && !flags.is_materialized_view
                && source_relations.contains_key(&relation.name)
        })
        .collect::<Vec<_>>();

    let mut changes = Vec::new();
    let mut handled_trigger_relations = BTreeSet::new();
    let mut warnings = source
        .warnings
        .iter()
        .chain(target.warnings.iter())
        .cloned()
        .collect::<Vec<_>>();

    for relation_name in relation_names {
        match (
            source_relations.get(&relation_name),
            target_relations.get(&relation_name),
        ) {
            (Some(source_relation), None) => {
                let (sql, relation_warnings) =
                    sqlite_create_exact_relation_sql(source, source_relation, &target.schema_name);
                warnings.extend(relation_warnings);
                let mut create = change(
                    SchemaChangeKind::RelationCreate,
                    SchemaChangeRisk::Review,
                    &target.schema_name,
                    &relation_name,
                    source_relation.object_type.clone(),
                    None,
                    format!("Create SQLite relation {relation_name}"),
                    sql,
                    true,
                    true,
                );
                create.phase = SchemaChangePhase::CreateRelations;
                if create.sql.is_empty() {
                    create.blocked_reason = Some(
                        "SQLite relation creation requires an exact catalog-backed table definition."
                            .to_string(),
                    );
                    create.phase = SchemaChangePhase::ManualReview;
                }
                handled_trigger_relations.insert(relation_name.clone());
                changes.push(create);
            }
            (None, Some(target_relation)) => {
                let target_flags = relation_flags(target_relation.object_type.as_deref());
                let is_table = sqlite_object_is_table(target_relation);
                let is_view = target_flags.is_view && !target_flags.is_materialized_view;
                let mut drop = change(
                    SchemaChangeKind::RelationDrop,
                    SchemaChangeRisk::Destructive,
                    &target.schema_name,
                    &relation_name,
                    target_relation.object_type.clone(),
                    None,
                    format!("Drop target-only SQLite relation {relation_name}"),
                    (is_table || is_view)
                        .then(|| {
                            format!(
                                "DROP {} {};",
                                if is_view { "VIEW" } else { "TABLE" },
                                sqlite_qualified_identifier(&target.schema_name, &relation_name)
                            )
                        })
                        .into_iter()
                        .collect(),
                    false,
                    true,
                );
                drop.phase = SchemaChangePhase::DropRelations;
                if !is_table && !is_view {
                    drop.phase = SchemaChangePhase::ManualReview;
                    drop.blocked_reason = Some(
                        "SQLite view removal remains review-only until view dependency ordering is captured."
                            .to_string(),
                    );
                } else if is_table {
                    let uncertain_views = surviving_target_views
                        .iter()
                        .filter(|view| {
                            view.dependencies.is_empty()
                                || view
                                    .dependencies
                                    .iter()
                                    .any(|dependency| dependency == &relation_name)
                        })
                        .map(|view| view.name.as_str())
                        .collect::<Vec<_>>();
                    if !uncertain_views.is_empty() {
                        let reason = format!(
                            "SQLite table {} cannot be dropped automatically while retained views have incomplete or matching dependency evidence: {}.",
                            relation_name,
                            uncertain_views.join(", ")
                        );
                        warnings.push(reason.clone());
                        drop.blocked_reason = Some(reason);
                        drop.phase = SchemaChangePhase::ManualReview;
                    }
                }
                handled_trigger_relations.insert(relation_name.clone());
                changes.push(drop);
            }
            (Some(source_relation), Some(target_relation))
                if relation_flags(source_relation.object_type.as_deref()).is_view
                    && !relation_flags(source_relation.object_type.as_deref())
                        .is_materialized_view
                    && relation_flags(target_relation.object_type.as_deref()).is_view
                    && !relation_flags(target_relation.object_type.as_deref())
                        .is_materialized_view
                    && source_relation != target_relation =>
            {
                let mut sql = vec![format!(
                    "DROP VIEW {};",
                    sqlite_qualified_identifier(&target.schema_name, &relation_name)
                )];
                let mut blocked_reason = None;
                match sqlite_exact_view_sql(source_relation, &target.schema_name) {
                    Ok(create_sql) => sql.push(create_sql),
                    Err(error) => {
                        warnings.push(error.clone());
                        sql.clear();
                        blocked_reason = Some(error);
                    }
                }
                let mut replace = change(
                    SchemaChangeKind::RelationModify,
                    SchemaChangeRisk::Destructive,
                    &target.schema_name,
                    &relation_name,
                    source_relation.object_type.clone(),
                    None,
                    format!("Replace SQLite view {relation_name}"),
                    sql,
                    false,
                    true,
                );
                replace.phase = SchemaChangePhase::AlterRelations;
                if let Some(reason) = blocked_reason {
                    replace.blocked_reason = Some(reason);
                    replace.phase = SchemaChangePhase::ManualReview;
                }
                handled_trigger_relations.insert(relation_name.clone());
                changes.push(replace);
            }
            (Some(source_relation), Some(target_relation))
                if sqlite_relation_requires_rebuild(source_relation, target_relation) =>
            {
                let (sql, relation_warnings) =
                    sqlite_rebuild_relation_sql(source, target, source_relation, target_relation);
                warnings.extend(relation_warnings);
                let mut rebuild = change(
                    SchemaChangeKind::RelationModify,
                    SchemaChangeRisk::Destructive,
                    &target.schema_name,
                    &relation_name,
                    source_relation.object_type.clone(),
                    None,
                    format!("Rebuild SQLite relation {relation_name}"),
                    sql,
                    false,
                    true,
                );
                rebuild.phase = SchemaChangePhase::AlterRelations;
                if rebuild.sql.is_empty() {
                    rebuild.blocked_reason = Some(
                        "SQLite rebuild metadata is incomplete or requires an explicit data conversion."
                            .to_string(),
                    );
                    rebuild.phase = SchemaChangePhase::ManualReview;
                }
                handled_trigger_relations.insert(relation_name.clone());
                changes.push(rebuild);
            }
            (Some(source_relation), Some(target_relation))
                if source_relation != target_relation =>
            {
                // SQLite does not persist column comments. Keep descriptor
                // drift visible without manufacturing a destructive rebuild
                // for metadata that cannot change the physical table.
                compare_metadata_children(
                    &target.schema_name,
                    source_relation,
                    target_relation,
                    &mut changes,
                );
            }
            (Some(_), Some(_)) | (None, None) => {}
        }
    }

    compare_routines(
        None,
        SchemaNameMapping {
            source: &source.schema_name,
            target: &target.schema_name,
        },
        &source.routines,
        &target.routines,
        &target.schema_name,
        &mut changes,
        &mut warnings,
    );
    compare_sqlite_schema_objects(
        &source.schema_objects,
        &target.schema_objects,
        &target.schema_name,
        &handled_trigger_relations,
        &mut changes,
        &mut warnings,
    );
    if !target.schema_name.trim().is_empty()
        && !target.schema_name.trim().eq_ignore_ascii_case("main")
    {
        let reason = format!(
            "SQLite attached schema {} is review-only because the current recovery backup and restore contract is bound to the main database file.",
            target.schema_name
        );
        for change in &mut changes {
            if change.blocked_reason.is_none() {
                change.blocked_reason = Some(reason.clone());
                change.manual_review = true;
                change.phase = SchemaChangePhase::ManualReview;
            }
        }
        warnings.push(reason);
    }
    for (order, change) in changes.iter_mut().enumerate() {
        change.order = order + 1;
    }
    let executable = !changes.is_empty()
        && changes.iter().all(|change| {
            matches!(
                change.kind,
                SchemaChangeKind::RelationCreate
                    | SchemaChangeKind::RelationDrop
                    | SchemaChangeKind::RelationModify
                    | SchemaChangeKind::SchemaObjectCreate
                    | SchemaChangeKind::SchemaObjectDrop
                    | SchemaChangeKind::SchemaObjectModify
            ) && change.blocked_reason.is_none()
                && !change.sql.is_empty()
        });
    if executable {
        warnings.push(
            "SQLite rebuild apply creates a verified recovery backup, holds a write lock, rolls back on any statement or foreign-key-check failure, and restores the original foreign_keys setting."
                .to_string(),
        );
    } else if !changes.is_empty() {
        warnings.push(
            "Only catalog-backed SQLite table, view, and trigger changes with complete safety evidence can be applied automatically; attached schemas and incomplete SQLite differences remain review-only."
                .to_string(),
        );
    }
    warnings.sort();
    warnings.dedup();
    let summary = summarize_changes(&changes);
    let id = stable_id(
        "sqlite-schema-diff",
        &format!(
            "sqlite-schema-diff:{}:{}:{}",
            source.fingerprint, target.fingerprint, target.schema_name
        ),
    );

    Ok(SchemaDiffPlan {
        id,
        source_snapshot_id: source.id.clone(),
        target_snapshot_id: target.id.clone(),
        driver: "sqlite".to_string(),
        target_connection_id: target.connection_id.clone(),
        target_database_name: target.database_name.clone(),
        target_schema_name: target.schema_name.clone(),
        generated_at,
        transactional: executable,
        execution_owner: if executable {
            SchemaDiffExecutionOwner::HostSql
        } else {
            SchemaDiffExecutionOwner::ReviewOnly
        },
        requires_review_approval: true,
        requires_destructive_approval: executable,
        summary,
        migration_sql: render_sqlite_rebuild_migration_sql(source, target, &changes, &warnings),
        preflight_checks: Vec::new(),
        preflight_sql: if executable {
            "-- SQLite driver performs backup, transaction, and PRAGMA foreign_key_check inside its atomic rebuild boundary.\n".to_string()
        } else {
            "-- SQLite differences require manual review because no complete rebuild plan is available.\n".to_string()
        },
        conversion_issues: Vec::new(),
        warnings,
        changes,
    })
}

pub(super) fn sqlite_quote_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

pub(super) fn sqlite_qualified_identifier(schema: &str, identifier: &str) -> String {
    if schema.trim().is_empty() {
        sqlite_quote_identifier(identifier)
    } else {
        format!(
            "{}.{}",
            sqlite_quote_identifier(schema),
            sqlite_quote_identifier(identifier)
        )
    }
}

pub(super) fn sqlite_object_is_table(relation: &SchemaRelationSnapshot) -> bool {
    let flags = relation_flags(relation.object_type.as_deref());
    !flags.is_view && !flags.is_materialized_view && !flags.is_foreign_table
}

pub(super) fn sqlite_relation_requires_rebuild(
    source: &SchemaRelationSnapshot,
    target: &SchemaRelationSnapshot,
) -> bool {
    if source.object_type != target.object_type
        || source.definition != target.definition
        || source.indexes != target.indexes
        || source.constraints != target.constraints
        || source.columns.len() != target.columns.len()
    {
        return true;
    }
    let target_columns = target
        .columns
        .iter()
        .map(|column| (column.name.as_str(), column))
        .collect::<BTreeMap<_, _>>();
    source.columns.iter().any(|source_column| {
        let Some(target_column) = target_columns.get(source_column.name.as_str()) else {
            return true;
        };
        source_column.data_type != target_column.data_type
            || source_column.is_nullable != target_column.is_nullable
            || source_column.is_primary_key != target_column.is_primary_key
            || source_column.is_unique != target_column.is_unique
            || source_column.is_indexed != target_column.is_indexed
            || source_column.is_auto_increment != target_column.is_auto_increment
            || source_column.identity_generation != target_column.identity_generation
            || source_column.is_generated != target_column.is_generated
            || source_column.is_hidden != target_column.is_hidden
            || source_column.default_value != target_column.default_value
    })
}

pub(super) fn sqlite_exact_rebuild_table_sql(
    relation: &SchemaRelationSnapshot,
    target_schema: &str,
    temporary_table: &str,
) -> Result<String, String> {
    let definition = relation
        .definition
        .as_deref()
        .map(str::trim)
        .filter(|definition| !definition.is_empty())
        .ok_or_else(|| {
            format!(
                "SQLite relation {} is missing its live sqlite_schema table definition.",
                relation.name
            )
        })?;
    // Passing the temporary identity as both the source and target tells the
    // shared catalog rewriter to preserve all REFERENCES targets verbatim.
    // Self-references already point at the final table name and remain correct
    // after the temporary table is renamed.
    rewrite_sqlite_create_table_for_transfer(
        definition,
        temporary_table,
        target_schema,
        temporary_table,
    )
    .map_err(|error| {
        format!(
            "SQLite relation {} has a catalog definition that cannot be rebuilt exactly: {error}",
            relation.name
        )
    })
}

pub(super) fn sqlite_exact_rebuild_index_sql(
    relation: &SchemaRelationSnapshot,
    target_schema: &str,
    index: &IndexInfo,
) -> Result<Option<String>, String> {
    let Some(definition) = index
        .definition
        .as_deref()
        .map(str::trim)
        .filter(|definition| !definition.is_empty())
    else {
        if index.is_primary || index.name.starts_with("sqlite_autoindex_") {
            return Ok(None);
        }
        return Err(format!(
            "Index {}.{} is missing its sqlite_schema definition.",
            relation.name, index.name
        ));
    };
    rewrite_sqlite_create_index_for_transfer(
        definition,
        target_schema,
        &relation.name,
        &index.name,
        index.is_unique,
    )
    .map(Some)
    .map_err(|error| {
        format!(
            "Index {}.{} has a catalog definition that cannot be rebuilt exactly: {error}",
            relation.name, index.name
        )
    })
}

pub(super) fn sqlite_exact_rebuild_trigger_sql(
    object: &SchemaObjectSnapshot,
    target_schema: &str,
) -> Result<String, String> {
    let definition = object
        .definition
        .as_deref()
        .map(str::trim)
        .filter(|definition| !definition.is_empty())
        .ok_or_else(|| {
            format!(
                "SQLite trigger {} is missing its sqlite_schema definition.",
                object.name
            )
        })?;
    if definition.contains('\0') || definition.len() > 1024 * 1024 {
        return Err(format!(
            "SQLite trigger {} has an invalid catalog definition.",
            object.name
        ));
    }
    // The MySQL statement scanner understands CREATE TRIGGER BEGIN/END bodies
    // and therefore does not mistake their internal semicolons for additional
    // top-level statements. SQLite remains the final parser authority.
    let statements = split_sql_statements(definition, StatementScanDialect::Mysql);
    if statements.len() != 1 {
        return Err(format!(
            "SQLite trigger {} catalog definition contains more than one statement.",
            object.name
        ));
    }
    let normalized = statements[0].trim_start().to_ascii_uppercase();
    if !normalized.starts_with("CREATE TRIGGER ")
        && !normalized.starts_with("CREATE TEMP TRIGGER ")
        && !normalized.starts_with("CREATE TEMPORARY TRIGGER ")
    {
        return Err(format!(
            "SQLite trigger {} catalog definition has an unexpected statement type.",
            object.name
        ));
    }
    rewrite_sqlite_create_trigger_for_transfer(
        statements[0],
        &object.name,
        target_schema,
        &object.name,
    )
    .map_err(|error| {
        format!(
            "SQLite trigger {} has a catalog definition that cannot be rebuilt exactly: {error}",
            object.name
        )
    })
}

pub(super) fn sqlite_exact_view_sql(
    relation: &SchemaRelationSnapshot,
    target_schema: &str,
) -> Result<String, String> {
    let definition = relation
        .definition
        .as_deref()
        .map(str::trim)
        .filter(|definition| !definition.is_empty())
        .ok_or_else(|| {
            format!(
                "SQLite view {} is missing its sqlite_schema definition.",
                relation.name
            )
        })?;
    rewrite_sqlite_create_view_for_transfer(
        definition,
        &relation.name,
        target_schema,
        &relation.name,
    )
    .map_err(|error| {
        format!(
            "SQLite view {} has a catalog definition that cannot be replayed exactly: {error}",
            relation.name
        )
    })
}

pub(super) fn sqlite_create_exact_relation_sql(
    source: &SchemaSnapshot,
    relation: &SchemaRelationSnapshot,
    target_schema: &str,
) -> (Vec<String>, Vec<String>) {
    let flags = relation_flags(relation.object_type.as_deref());
    if flags.is_view && !flags.is_materialized_view {
        return match sqlite_exact_view_sql(relation, target_schema) {
            Ok(sql) => (vec![sql], Vec::new()),
            Err(error) => (Vec::new(), vec![error]),
        };
    }
    if !sqlite_object_is_table(relation) {
        return (
            Vec::new(),
            vec![format!(
                "SQLite relation {} is a view or unsupported relation type; exact table creation is unavailable.",
                relation.name
            )],
        );
    }
    let mut sql = match sqlite_exact_rebuild_table_sql(relation, target_schema, &relation.name) {
        Ok(create_sql) => vec![create_sql],
        Err(error) => return (Vec::new(), vec![error]),
    };
    let mut warnings = Vec::new();
    for index in &relation.indexes {
        match sqlite_exact_rebuild_index_sql(relation, target_schema, index) {
            Ok(Some(index_sql)) => sql.push(index_sql),
            Ok(None) => {}
            Err(error) => warnings.push(error),
        }
    }
    for trigger in source.schema_objects.iter().filter(|object| {
        object.object_type.eq_ignore_ascii_case("trigger")
            && object.parent_name.as_deref() == Some(relation.name.as_str())
    }) {
        match sqlite_exact_rebuild_trigger_sql(trigger, target_schema) {
            Ok(trigger_sql) => sql.push(trigger_sql),
            Err(error) => warnings.push(error),
        }
    }
    if warnings.is_empty() {
        (sql, warnings)
    } else {
        (Vec::new(), warnings)
    }
}

pub(super) fn sqlite_trigger_drop_sql(schema_name: &str, trigger_name: &str) -> String {
    format!(
        "DROP TRIGGER {};",
        sqlite_qualified_identifier(schema_name, trigger_name)
    )
}

pub(super) fn compare_sqlite_schema_objects(
    source: &[SchemaObjectSnapshot],
    target: &[SchemaObjectSnapshot],
    schema_name: &str,
    rebuilt_relations: &BTreeSet<String>,
    changes: &mut Vec<SchemaChange>,
    warnings: &mut Vec<String>,
) {
    let source_triggers = source
        .iter()
        .filter(|object| object.object_type.eq_ignore_ascii_case("trigger"))
        .map(|object| (schema_object_identity(object), object))
        .collect::<BTreeMap<_, _>>();
    let target_triggers = target
        .iter()
        .filter(|object| object.object_type.eq_ignore_ascii_case("trigger"))
        .map(|object| (schema_object_identity(object), object))
        .collect::<BTreeMap<_, _>>();
    let mut identities = source_triggers
        .keys()
        .chain(target_triggers.keys())
        .cloned()
        .collect::<Vec<_>>();
    identities.sort();
    identities.dedup();
    for identity in identities {
        let source_trigger = source_triggers.get(&identity).copied();
        let target_trigger = target_triggers.get(&identity).copied();
        let parent_name = source_trigger
            .and_then(|object| object.parent_name.as_deref())
            .or_else(|| target_trigger.and_then(|object| object.parent_name.as_deref()));
        if parent_name.is_some_and(|parent| rebuilt_relations.contains(parent)) {
            continue;
        }
        let (kind, risk, summary, sql, blocked_reason) = match (source_trigger, target_trigger) {
            (Some(source_trigger), None) => {
                match sqlite_exact_rebuild_trigger_sql(source_trigger, schema_name) {
                    Ok(sql) => (
                        SchemaChangeKind::SchemaObjectCreate,
                        SchemaChangeRisk::Review,
                        format!("Create SQLite trigger {}", source_trigger.name),
                        vec![sql],
                        None,
                    ),
                    Err(error) => (
                        SchemaChangeKind::SchemaObjectCreate,
                        SchemaChangeRisk::Review,
                        format!("Review creation of SQLite trigger {}", source_trigger.name),
                        Vec::new(),
                        Some(error),
                    ),
                }
            }
            (None, Some(target_trigger)) => (
                SchemaChangeKind::SchemaObjectDrop,
                SchemaChangeRisk::Destructive,
                format!("Drop SQLite trigger {}", target_trigger.name),
                vec![sqlite_trigger_drop_sql(schema_name, &target_trigger.name)],
                None,
            ),
            (Some(source_trigger), Some(target_trigger)) if source_trigger != target_trigger => {
                match sqlite_exact_rebuild_trigger_sql(source_trigger, schema_name) {
                    Ok(create_sql) => (
                        SchemaChangeKind::SchemaObjectModify,
                        SchemaChangeRisk::Destructive,
                        format!("Replace SQLite trigger {}", source_trigger.name),
                        vec![
                            sqlite_trigger_drop_sql(schema_name, &target_trigger.name),
                            create_sql,
                        ],
                        None,
                    ),
                    Err(error) => (
                        SchemaChangeKind::SchemaObjectModify,
                        SchemaChangeRisk::Review,
                        format!("Review changed SQLite trigger {}", source_trigger.name),
                        Vec::new(),
                        Some(error),
                    ),
                }
            }
            _ => continue,
        };
        let object = source_trigger
            .or(target_trigger)
            .expect("trigger identity exists");
        let mut trigger_change = change(
            kind,
            risk,
            schema_name,
            &object.name,
            Some("trigger".to_string()),
            object.parent_name.clone(),
            summary,
            sql,
            false,
            true,
        );
        trigger_change.phase = match kind {
            SchemaChangeKind::SchemaObjectDrop => SchemaChangePhase::DropDependencies,
            SchemaChangeKind::SchemaObjectCreate => SchemaChangePhase::CreateDependencies,
            _ => SchemaChangePhase::AlterRelations,
        };
        if let Some(reason) = blocked_reason {
            warnings.push(reason.clone());
            trigger_change.blocked_reason = Some(reason);
            trigger_change.phase = SchemaChangePhase::ManualReview;
        }
        changes.push(trigger_change);
    }

    let source_other = source
        .iter()
        .filter(|object| !object.object_type.eq_ignore_ascii_case("trigger"))
        .cloned()
        .collect::<Vec<_>>();
    let target_other = target
        .iter()
        .filter(|object| !object.object_type.eq_ignore_ascii_case("trigger"))
        .cloned()
        .collect::<Vec<_>>();
    compare_schema_objects(
        None,
        SchemaNameMapping {
            source: schema_name,
            target: schema_name,
        },
        &source_other,
        &target_other,
        schema_name,
        changes,
        warnings,
    );
}

pub(super) fn sqlite_rebuild_relation_sql(
    source: &SchemaSnapshot,
    target: &SchemaSnapshot,
    source_relation: &SchemaRelationSnapshot,
    target_relation: &SchemaRelationSnapshot,
) -> (Vec<String>, Vec<String>) {
    if !sqlite_object_is_table(source_relation) || !sqlite_object_is_table(target_relation) {
        return (
            Vec::new(),
            vec![format!(
                "SQLite relation {} changes object type or is a view; an exact source-DDL migration is required.",
                source_relation.name
            )],
        );
    }
    let rebuild_suffix = &hex_digest(
        format!(
            "{}:{}:{}",
            source.fingerprint, target.fingerprint, source_relation.name
        )
        .as_bytes(),
    )[..12];
    let temporary_table = format!(
        "__oxide_rebuild_{}_{}",
        source_relation.name, rebuild_suffix
    );
    let create_sql = match sqlite_exact_rebuild_table_sql(
        source_relation,
        &target.schema_name,
        &temporary_table,
    ) {
        Ok(sql) => sql,
        Err(warning) => return (Vec::new(), vec![warning]),
    };
    let mut warnings = Vec::new();
    let target_columns = target_relation
        .columns
        .iter()
        .map(|column| (column.name.as_str(), column))
        .collect::<BTreeMap<_, _>>();
    let preserved_columns = source_relation
        .columns
        .iter()
        .filter(|source_column| {
            source_column.is_generated == Some(false)
                && source_column.is_hidden == Some(false)
                && target_columns.contains_key(source_column.name.as_str())
        })
        .collect::<Vec<_>>();
    if preserved_columns.is_empty() {
        warnings.push(format!(
            "SQLite rebuild for {} has no same-name columns to copy; manually provide a data transformation before execution.",
            source_relation.name
        ));
        return (Vec::new(), warnings);
    }
    for source_column in &source_relation.columns {
        if source_column.is_generated == Some(false)
            && source_column.is_hidden == Some(false)
            && !target_columns.contains_key(source_column.name.as_str())
            && !source_column.is_nullable
            && source_column.default_value.is_none()
        {
            warnings.push(format!(
                "SQLite rebuild for {} adds required column {} without a default; provide a backfill expression before execution.",
                source_relation.name, source_column.name
            ));
        }
    }
    for source_column in &preserved_columns {
        if let Some(target_column) = target_columns.get(source_column.name.as_str()) {
            if source_column.data_type != target_column.data_type {
                warnings.push(format!(
                    "SQLite rebuild for {} copies {} without an explicit type conversion; review affinity and data-loss behavior.",
                    source_relation.name, source_column.name
                ));
            }
        }
    }
    if !warnings.is_empty() {
        return (Vec::new(), warnings);
    }
    let copied_columns = preserved_columns
        .iter()
        .map(|column| sqlite_quote_identifier(&column.name))
        .collect::<Vec<_>>()
        .join(", ");
    let mut sql = vec![create_sql];
    sql.push(format!(
        "INSERT INTO {} ({copied_columns}) SELECT {copied_columns} FROM {};",
        sqlite_qualified_identifier(&target.schema_name, &temporary_table),
        sqlite_qualified_identifier(&target.schema_name, &target_relation.name)
    ));
    sql.push(format!(
        "DROP TABLE {};",
        sqlite_qualified_identifier(&target.schema_name, &target_relation.name)
    ));
    sql.push(format!(
        "ALTER TABLE {} RENAME TO {};",
        sqlite_qualified_identifier(&target.schema_name, &temporary_table),
        sqlite_quote_identifier(&source_relation.name)
    ));
    for index in &source_relation.indexes {
        match sqlite_exact_rebuild_index_sql(source_relation, &target.schema_name, index) {
            Ok(Some(index_sql)) => sql.push(index_sql),
            Ok(None) => {}
            Err(warning) => warnings.push(warning),
        }
    }
    for trigger in source.schema_objects.iter().filter(|object| {
        object.object_type.eq_ignore_ascii_case("trigger")
            && object.parent_name.as_deref() == Some(source_relation.name.as_str())
    }) {
        match sqlite_exact_rebuild_trigger_sql(trigger, &target.schema_name) {
            Ok(trigger_sql) => sql.push(trigger_sql),
            Err(warning) => warnings.push(warning),
        }
    }
    if !warnings.is_empty() {
        return (Vec::new(), warnings);
    }
    (sql, warnings)
}

pub(super) fn render_sqlite_rebuild_migration_sql(
    source: &SchemaSnapshot,
    target: &SchemaSnapshot,
    changes: &[SchemaChange],
    warnings: &[String],
) -> String {
    let mut lines = vec![
        "-- OxideStudio SQLite schema rebuild review".to_string(),
        format!("-- Desired source: {} / {}", source.connection_name, source.schema_name),
        format!("-- Actual target: {} / {}", target.connection_name, target.schema_name),
        "-- Catalog-backed table, view, and trigger changes are executed only through OxideStudio's backup + atomic SQLite migration boundary.".to_string(),
        "-- PRAGMA and transaction control are intentionally omitted from this artifact and remain driver-owned.".to_string(),
    ];
    for warning in warnings {
        lines.push(format!("-- WARNING: {warning}"));
    }
    lines.push(String::new());
    if changes.is_empty() {
        lines.push("-- No schema differences detected.".to_string());
    }
    for change in changes {
        lines.push(format!("-- Step {}: {}", change.order, change.summary));
        if let Some(reason) = change.blocked_reason.as_deref() {
            lines.push(format!("-- BLOCKED: {reason}"));
        }
        if change.sql.is_empty() {
            lines.push(
                "-- MANUAL REVIEW REQUIRED: no complete rebuild SQL was generated.".to_string(),
            );
        } else {
            lines.extend(change.sql.iter().cloned());
        }
        lines.push(String::new());
    }
    lines.join("\n")
}
