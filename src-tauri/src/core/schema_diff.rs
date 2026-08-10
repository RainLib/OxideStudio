use crate::core::{
    dialect::{database_spec_for_driver, DatabaseKind},
    protocol::{
        ColumnInfo, ConstraintInfo, FunctionInfo, FunctionParameterInfo, IndexInfo,
        SchemaObjectInfo,
    },
};
use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    str::FromStr,
};

pub const SCHEMA_SNAPSHOT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaRelationSnapshot {
    pub name: String,
    pub object_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    pub columns: Vec<ColumnInfo>,
    pub indexes: Vec<IndexInfo>,
    pub constraints: Vec<ConstraintInfo>,
}

/// A compact routine signature intentionally excludes source/DDL text. Routine
/// bodies can contain credentials, implementation details, and dialect-specific
/// syntax; signatures are enough for drift review but never for auto-migration.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaRoutineSnapshot {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub routine_type: Option<String>,
    #[serde(default)]
    pub parameters: Vec<FunctionParameterInfo>,
    pub return_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

impl From<FunctionInfo> for SchemaRoutineSnapshot {
    fn from(function: FunctionInfo) -> Self {
        Self {
            name: function.name,
            routine_type: function.routine_type,
            parameters: function.parameters,
            return_type: function.return_type,
            description: function.description,
        }
    }
}

/// Descriptor-only schema object metadata. Unlike relation metadata this never
/// contains source/DDL, so every resulting drift item remains manual review.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaObjectSnapshot {
    pub name: String,
    pub object_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

impl From<SchemaObjectInfo> for SchemaObjectSnapshot {
    fn from(object: SchemaObjectInfo) -> Self {
        Self {
            name: object.name,
            object_type: object.object_type,
            parent_name: object.parent_name,
            description: object.comment,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaSnapshot {
    pub version: u32,
    pub id: String,
    pub fingerprint: String,
    pub project_id: String,
    pub connection_id: String,
    pub connection_name: String,
    pub driver: String,
    pub database_name: Option<String>,
    pub schema_name: String,
    pub captured_at: i64,
    pub relations: Vec<SchemaRelationSnapshot>,
    /// Added after snapshot v1 shipped. Empty values preserve legacy v1
    /// fingerprints so existing stored snapshots remain comparable.
    #[serde(default)]
    pub routines: Vec<SchemaRoutineSnapshot>,
    /// Non-relation descriptors are captured only as review-safe metadata.
    /// Old snapshots intentionally deserialize as an empty list.
    #[serde(default)]
    pub schema_objects: Vec<SchemaObjectSnapshot>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum SchemaChangeRisk {
    Safe,
    Review,
    Destructive,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum SchemaChangeKind {
    RelationCreate,
    RelationDrop,
    RelationModify,
    ColumnAdd,
    ColumnDrop,
    ColumnModify,
    IndexAdd,
    IndexDrop,
    IndexModify,
    ConstraintAdd,
    ConstraintDrop,
    ConstraintModify,
    RoutineCreate,
    RoutineDrop,
    RoutineModify,
    SchemaObjectCreate,
    SchemaObjectDrop,
    SchemaObjectModify,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum SchemaChangePhase {
    DropDependencies,
    DropRelations,
    CreateRelations,
    AlterRelations,
    CreateDependencies,
    ManualReview,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaChange {
    pub id: String,
    pub kind: SchemaChangeKind,
    pub risk: SchemaChangeRisk,
    pub schema_name: String,
    pub relation_name: String,
    pub object_type: Option<String>,
    pub child_name: Option<String>,
    pub summary: String,
    pub sql: Vec<String>,
    pub reversible: bool,
    pub manual_review: bool,
    pub phase: SchemaChangePhase,
    pub order: usize,
    #[serde(default)]
    pub depends_on: Vec<String>,
    pub blocked_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SchemaPreflightAssertion {
    Advisory,
    EmptyRows,
    ZeroValue,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaPreflightCheck {
    pub id: String,
    pub change_id: String,
    pub label: String,
    pub sql: String,
    pub expectation: String,
    pub assertion: SchemaPreflightAssertion,
    pub result_column: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaDiffSummary {
    pub total: usize,
    pub safe: usize,
    pub review: usize,
    pub destructive: usize,
    pub blocked: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SchemaConversionCompatibility {
    Safe,
    Review,
    Unsupported,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SchemaConversionFeatureKind {
    #[default]
    Type,
    Array,
    Default,
    Index,
    CustomType,
    Schema,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaConversionIssue {
    #[serde(default)]
    pub feature_kind: SchemaConversionFeatureKind,
    pub relation_name: String,
    pub column_name: String,
    pub source_data_type: String,
    pub target_data_type: Option<String>,
    pub compatibility: SchemaConversionCompatibility,
    pub reason: String,
    #[serde(default)]
    pub remediation: String,
    #[serde(default)]
    pub blocks_automatic_conversion: bool,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SchemaDiffExecutionOwner {
    #[default]
    HostSql,
    ExternalDriver,
    ReviewOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaDiffPlan {
    pub id: String,
    pub source_snapshot_id: String,
    pub target_snapshot_id: String,
    pub driver: String,
    pub target_connection_id: String,
    pub target_database_name: Option<String>,
    pub target_schema_name: String,
    pub generated_at: i64,
    pub transactional: bool,
    #[serde(default)]
    pub execution_owner: SchemaDiffExecutionOwner,
    #[serde(default)]
    pub requires_review_approval: bool,
    #[serde(default)]
    pub requires_destructive_approval: bool,
    pub summary: SchemaDiffSummary,
    pub changes: Vec<SchemaChange>,
    pub migration_sql: String,
    pub preflight_checks: Vec<SchemaPreflightCheck>,
    pub preflight_sql: String,
    #[serde(default)]
    pub conversion_issues: Vec<SchemaConversionIssue>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

pub fn finalize_schema_snapshot(mut snapshot: SchemaSnapshot) -> Result<SchemaSnapshot> {
    snapshot.version = SCHEMA_SNAPSHOT_VERSION;
    snapshot
        .relations
        .sort_by(|left, right| left.name.cmp(&right.name));
    for relation in &mut snapshot.relations {
        relation
            .indexes
            .sort_by(|left, right| left.name.cmp(&right.name));
        relation
            .constraints
            .sort_by(|left, right| left.name.cmp(&right.name));
    }
    snapshot.routines.sort_by_key(routine_sort_key);
    snapshot.schema_objects.sort_by_key(schema_object_sort_key);
    snapshot.warnings.sort();
    snapshot.warnings.dedup();
    snapshot.fingerprint = snapshot_fingerprint(&snapshot)?;
    if snapshot.id.trim().is_empty() {
        snapshot.id = format!(
            "schema-snapshot-{}-{}",
            snapshot.captured_at,
            &snapshot.fingerprint[..12]
        );
    }
    Ok(snapshot)
}

pub fn compare_schema_snapshots(
    source: &SchemaSnapshot,
    target: &SchemaSnapshot,
    generated_at: i64,
) -> Result<SchemaDiffPlan> {
    if source.version != SCHEMA_SNAPSHOT_VERSION || target.version != SCHEMA_SNAPSHOT_VERSION {
        return Err(anyhow!(
            "Unsupported schema snapshot version; expected {}",
            SCHEMA_SNAPSHOT_VERSION
        ));
    }
    let source_spec = database_spec_for_driver(&source.driver);
    let target_spec = database_spec_for_driver(&target.driver);
    if source.schema_name != target.schema_name {
        return Err(anyhow!(
            "Cross-schema comparison requires an explicit schema mapping: {} -> {}",
            source.schema_name,
            target.schema_name
        ));
    }

    // A signed external package can provide a full metadata contract without
    // being compiled into the host's DDL planner. Keep those snapshots useful
    // for review, diagrams and drift detection, while deliberately refusing to
    // synthesize generic migration SQL for an unknown dialect.
    let (Some(source_spec), Some(target_spec)) = (source_spec, target_spec) else {
        if source.driver != target.driver {
            let mut plan =
                compare_metadata_snapshots(source, target, generated_at, &target.driver)?;
            annotate_cross_driver_review(&mut plan, source, target);
            return Ok(plan);
        }
        return compare_metadata_snapshots(source, target, generated_at, &target.driver);
    };
    if source_spec.driver != target_spec.driver {
        let mut plan =
            compare_metadata_snapshots(source, target, generated_at, target_spec.driver)?;
        annotate_cross_driver_review(&mut plan, source, target);
        return Ok(plan);
    }
    if !target_spec.supports_table_browsing {
        return compare_metadata_snapshots(source, target, generated_at, target_spec.driver);
    }
    // SQLite alters that touch a table definition have to rebuild the table.
    // Generate a bounded, review-only rebuild artifact instead of pretending
    // its generic ALTER support is equivalent to PostgreSQL or MySQL. The
    // command layer deliberately keeps SQLite execution disabled.
    if target_spec.driver == "sqlite" {
        return compare_sqlite_schema_snapshots(source, target, generated_at);
    }
    let kind = DatabaseKind::from_str(target_spec.driver)?;
    let target_schema = target.schema_name.as_str();
    let source_relations = relation_map(&source.relations);
    let target_relations = relation_map(&target.relations);
    let mut relation_names = source_relations
        .keys()
        .chain(target_relations.keys())
        .cloned()
        .collect::<Vec<_>>();
    relation_names.sort();
    relation_names.dedup();

    let mut changes = Vec::new();
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
                let (sql, manual_review, relation_warnings) =
                    create_relation_sql(kind, &source.schema_name, target_schema, source_relation);
                warnings.extend(relation_warnings);
                changes.push(change(
                    SchemaChangeKind::RelationCreate,
                    if manual_review {
                        SchemaChangeRisk::Review
                    } else {
                        SchemaChangeRisk::Safe
                    },
                    target_schema,
                    &relation_name,
                    source_relation.object_type.clone(),
                    None,
                    format!("Create relation {relation_name}"),
                    sql,
                    true,
                    manual_review,
                ));
                for constraint in source_relation
                    .constraints
                    .iter()
                    .filter(|constraint| is_foreign_constraint(constraint))
                {
                    let sql = add_constraint_sql(kind, target_schema, &relation_name, constraint);
                    if sql.is_none() {
                        warnings.push(format!(
                            "Foreign key {}.{} requires an exact source definition including referential actions.",
                            relation_name, constraint.name
                        ));
                    }
                    changes.push(change(
                        SchemaChangeKind::ConstraintAdd,
                        SchemaChangeRisk::Review,
                        target_schema,
                        &relation_name,
                        source_relation.object_type.clone(),
                        Some(constraint.name.clone()),
                        format!("Add foreign key {} on {}", constraint.name, relation_name),
                        sql.into_iter().collect(),
                        true,
                        true,
                    ));
                }
            }
            (None, Some(target_relation)) => {
                for constraint in target_relation
                    .constraints
                    .iter()
                    .filter(|constraint| is_foreign_constraint(constraint))
                {
                    changes.push(change(
                        SchemaChangeKind::ConstraintDrop,
                        SchemaChangeRisk::Review,
                        target_schema,
                        &relation_name,
                        target_relation.object_type.clone(),
                        Some(constraint.name.clone()),
                        format!(
                            "Drop foreign key {} before removing {}",
                            constraint.name, relation_name
                        ),
                        vec![kind.drop_constraint_query(
                            Some(target_schema),
                            &relation_name,
                            &constraint.name,
                            &constraint.constraint_type,
                        )],
                        true,
                        true,
                    ));
                }
                let object_flags = relation_flags(target_relation.object_type.as_deref());
                changes.push(change(
                    SchemaChangeKind::RelationDrop,
                    SchemaChangeRisk::Destructive,
                    target_schema,
                    &relation_name,
                    target_relation.object_type.clone(),
                    None,
                    format!("Drop target-only relation {relation_name}"),
                    vec![kind.drop_relation_query_with_kind(
                        Some(target_schema),
                        &relation_name,
                        object_flags.is_view,
                        object_flags.is_materialized_view,
                        object_flags.is_foreign_table,
                        false,
                    )],
                    false,
                    true,
                ));
            }
            (Some(source_relation), Some(target_relation)) => {
                compare_relation(
                    kind,
                    &source.schema_name,
                    target_schema,
                    source_relation,
                    target_relation,
                    &mut changes,
                    &mut warnings,
                );
            }
            (None, None) => unreachable!(),
        }
    }
    compare_routines(
        &source.routines,
        &target.routines,
        target_schema,
        &mut changes,
        &mut warnings,
    );
    compare_schema_objects(
        &source.schema_objects,
        &target.schema_objects,
        target_schema,
        &mut changes,
        &mut warnings,
    );

    let (changes, preflight_checks) =
        finalize_change_plan(kind, source, target, changes, &mut warnings);
    warnings.sort();
    warnings.dedup();
    let summary = summarize_changes(&changes);
    let transactional = kind == DatabaseKind::Postgres;
    let migration_sql = render_migration_sql(kind, source, target, &changes, &warnings);
    let preflight_sql = render_preflight_sql(source, target, &preflight_checks);
    let id = stable_id(
        "schema-diff",
        &format!(
            "schema-diff:{}:{}:{}",
            source.fingerprint, target.fingerprint, target.schema_name
        ),
    );

    Ok(SchemaDiffPlan {
        id,
        source_snapshot_id: source.id.clone(),
        target_snapshot_id: target.id.clone(),
        driver: kind.as_str().to_string(),
        target_connection_id: target.connection_id.clone(),
        target_database_name: target.database_name.clone(),
        target_schema_name: target.schema_name.clone(),
        generated_at,
        transactional,
        execution_owner: SchemaDiffExecutionOwner::HostSql,
        requires_review_approval: changes
            .iter()
            .any(|change| change.manual_review || change.risk == SchemaChangeRisk::Review),
        requires_destructive_approval: changes
            .iter()
            .any(|change| change.risk == SchemaChangeRisk::Destructive || !change.reversible),
        summary,
        changes,
        migration_sql,
        preflight_checks,
        preflight_sql,
        conversion_issues: Vec::new(),
        warnings,
    })
}

fn normalized_driver_family(driver: &str) -> String {
    let normalized = driver.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "postgresql" | "pgsql" => "postgres".to_string(),
        "mariadb" => "mysql".to_string(),
        "mssql" | "sql_server" => "sqlserver".to_string(),
        _ => normalized,
    }
}

fn normalized_type_base(data_type: &str) -> String {
    data_type
        .trim()
        .trim_end_matches("[]")
        .split('(')
        .next()
        .unwrap_or(data_type)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

fn postgres_conversion_note(data_type: &str, target_driver: &str) -> Option<(String, bool)> {
    let normalized = data_type.trim().to_ascii_lowercase();
    let is_array = normalized.ends_with("[]") || normalized.starts_with("array<");
    let base = normalized_type_base(&normalized);
    if is_array {
        let mapping = if target_driver == "mysql" {
            "JSON; array operators and indexes require manual redesign"
        } else {
            "NVARCHAR(MAX); store as a JSON array and redesign array operators and indexes"
        };
        return Some((format!("{data_type} -> {mapping}"), true));
    }
    let mapping = match target_driver {
        "mysql" => match base.as_str() {
            "uuid" => ("CHAR(36); validate UUID format and indexes", false),
            "jsonb" => ("JSON; GIN/operator semantics are not preserved", true),
            "bytea" => ("LONGBLOB", false),
            "boolean" | "bool" => ("BOOLEAN/TINYINT(1)", false),
            "money" => (
                "DECIMAL(19,4); verify currency, locale, range, and rounding semantics",
                true,
            ),
            "time with time zone" | "timetz" => ("TIME; timezone offset is not preserved", true),
            "timestamp with time zone" | "timestamptz" => (
                "DATETIME(6); normalize timezone values before transfer",
                true,
            ),
            "inet" | "cidr" | "macaddr" | "macaddr8" => (
                "VARCHAR; network validation/operators are not preserved",
                true,
            ),
            "interval" => ("VARCHAR; interval arithmetic is not preserved", true),
            "varbit" | "bit varying" => (
                "BIT(64); verify maximum length and bit-string behavior",
                true,
            ),
            "line" => (
                "LINESTRING; PostgreSQL infinite-line semantics are not preserved",
                true,
            ),
            "circle" => ("POLYGON; circle geometry is approximated", true),
            "tsvector" | "tsquery" => ("TEXT; redesign with MySQL full-text search", true),
            "int4range" | "int8range" | "numrange" | "tsrange" | "tstzrange" | "daterange" => (
                "JSON; range operators, bounds, and indexes are not preserved",
                true,
            ),
            "xml" => (
                "TEXT; XML validation and query semantics are not preserved",
                true,
            ),
            "smallserial" => ("SMALLINT AUTO_INCREMENT; review sequence ownership", true),
            "serial" => ("INTEGER AUTO_INCREMENT; review sequence ownership", true),
            "bigserial" => ("BIGINT AUTO_INCREMENT; review sequence ownership", true),
            _ => return None,
        },
        "sqlserver" => match base.as_str() {
            "uuid" => ("UNIQUEIDENTIFIER", false),
            "json" | "jsonb" => (
                "NVARCHAR(MAX); add ISJSON validation and redesign JSON indexes",
                true,
            ),
            "bytea" => ("VARBINARY(MAX)", false),
            "boolean" | "bool" => ("BIT", false),
            "time with time zone" | "timetz" => ("TIME; timezone offset is not preserved", true),
            "timestamp with time zone" | "timestamptz" => ("DATETIMEOFFSET", false),
            "timestamp without time zone" | "timestamp" => ("DATETIME2", false),
            "inet" | "cidr" | "macaddr" | "macaddr8" => (
                "NVARCHAR; network validation/operators are not preserved",
                true,
            ),
            "interval" => ("NVARCHAR; interval arithmetic is not preserved", true),
            "varbit" | "bit varying" => (
                "VARBINARY(64); verify bit length and ordering semantics",
                true,
            ),
            "circle" => (
                "GEOMETRY; represent and validate the radius explicitly",
                true,
            ),
            "tsvector" | "tsquery" => (
                "NVARCHAR(MAX); redesign with SQL Server Full-Text Search",
                true,
            ),
            "int4range" | "int8range" | "numrange" | "tsrange" | "tstzrange" | "daterange" => (
                "NVARCHAR(MAX); prefer explicit lower/upper bound columns",
                true,
            ),
            "smallserial" => ("SMALLINT IDENTITY; review sequence ownership", true),
            "serial" => ("INT IDENTITY; review sequence ownership", true),
            "bigserial" => ("BIGINT IDENTITY; review sequence ownership", true),
            _ => return None,
        },
        _ => return None,
    };
    Some((format!("{data_type} -> {}", mapping.0), mapping.1))
}

fn postgres_default_conversion_note(
    default_value: &str,
    target_driver: &str,
) -> Option<(Option<String>, String, bool)> {
    let normalized = default_value.trim().to_ascii_lowercase();
    if normalized.contains("nextval(") {
        return Some((
            Some(if target_driver == "mysql" {
                "AUTO_INCREMENT".to_string()
            } else {
                "IDENTITY(1,1)".to_string()
            }),
            "Sequence ownership, start value, increment, and current value require explicit target review."
                .to_string(),
            true,
        ));
    }
    if normalized.contains("gen_random_uuid(") || normalized.contains("uuid_generate_") {
        return Some((
            Some(if target_driver == "mysql" {
                "UUID()".to_string()
            } else {
                "NEWID()".to_string()
            }),
            "Use the target-native UUID generator and verify ordering/index expectations."
                .to_string(),
            false,
        ));
    }
    if normalized.contains("array[") || normalized == "'{}'" || normalized == "'{}'::text[]" {
        return Some((
            Some(if target_driver == "mysql" {
                "JSON_ARRAY()".to_string()
            } else {
                "N'[]'".to_string()
            }),
            "Array defaults require a target JSON representation and value-shape validation."
                .to_string(),
            true,
        ));
    }
    if normalized.contains("currval(")
        || normalized.contains("setval(")
        || normalized.contains("current_setting(")
    {
        return Some((
            None,
            "PostgreSQL session or sequence state has no context-free target default.".to_string(),
            true,
        ));
    }
    if normalized.contains("::") {
        return Some((
            None,
            "PostgreSQL cast syntax must be removed or replaced with a target-owned expression."
                .to_string(),
            true,
        ));
    }
    None
}

fn postgres_index_conversion_note(
    index: &IndexInfo,
    target_driver: &str,
) -> Option<(Option<String>, String, bool)> {
    let index_type = index
        .index_type
        .as_deref()
        .unwrap_or("btree")
        .trim()
        .to_ascii_lowercase();
    let definition = index
        .definition
        .as_deref()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let special_method = !index_type.is_empty() && index_type != "btree";
    let partial = definition.contains(" where ");
    let expression = index.columns.iter().any(|column| {
        column.contains('(')
            || column.contains(')')
            || column.contains("::")
            || column.contains(' ')
    });
    if partial || expression {
        return Some((
            None,
            "Partial or expression index predicates require a target-owned equivalent.".to_string(),
            true,
        ));
    }
    if !special_method {
        return None;
    }
    let (target_type, reason, blocks): (Option<&str>, String, bool) = match (
        target_driver,
        index_type.as_str(),
    ) {
        ("mysql", "hash") => (
            Some("HASH"),
            "HASH availability depends on the target storage engine.".to_string(),
            true,
        ),
        ("mysql", "gin" | "gist" | "spgist" | "sp-gist" | "brin") => (
            Some("BTREE"),
            "PostgreSQL operator-class and access-method semantics are not preserved."
                .to_string(),
            true,
        ),
        ("sqlserver", "gist") => (
            None,
            "Choose SPATIAL for geometry-compatible data or NONCLUSTERED for scalar data."
                .to_string(),
            true,
        ),
        ("sqlserver", "hash" | "gin" | "spgist" | "sp-gist" | "brin") => (
            Some("NONCLUSTERED"),
            "PostgreSQL access-method semantics are not preserved; full-text or specialized indexes may be required."
                .to_string(),
            true,
        ),
        (_, unknown) => (
            None,
            if unknown.is_empty() {
                "The source index access method is missing.".to_string()
            } else {
                format!("No deterministic target mapping exists for {unknown} indexes.")
            },
            true,
        ),
    };
    Some((target_type.map(str::to_string), reason, blocks))
}

fn postgres_type_looks_custom(data_type: &str) -> bool {
    let normalized = data_type.trim().to_ascii_lowercase();
    normalized == "user-defined"
        || normalized.starts_with("user-defined ")
        || normalized.starts_with("enum ")
        || normalized.starts_with("domain ")
        || normalized.contains('"')
        || normalized_type_base(&normalized).contains('.')
}

fn cross_driver_conversion_issues(
    source: &SchemaSnapshot,
    target: &SchemaSnapshot,
) -> Vec<SchemaConversionIssue> {
    let source_driver = normalized_driver_family(&source.driver);
    let target_driver = normalized_driver_family(&target.driver);
    if source_driver != "postgres" || !matches!(target_driver.as_str(), "mysql" | "sqlserver") {
        return vec![SchemaConversionIssue {
            feature_kind: SchemaConversionFeatureKind::Schema,
            relation_name: "*".to_string(),
            column_name: "*".to_string(),
            source_data_type: "*".to_string(),
            target_data_type: None,
            compatibility: SchemaConversionCompatibility::Unsupported,
            reason: format!(
                "No deterministic type-mapping profile is installed for {} -> {}; every column type requires manual review.",
                source.driver, target.driver
            ),
            remediation: "Install a signed target-owned semantic migration profile or define and review every target type mapping.".to_string(),
            blocks_automatic_conversion: true,
        }];
    }

    let mut issues = Vec::new();
    for relation in &source.relations {
        for column in &relation.columns {
            if let Some((mapping, lossy)) =
                postgres_conversion_note(&column.data_type, &target_driver)
            {
                let mapped = mapping
                    .strip_prefix(&format!("{} -> ", column.data_type))
                    .unwrap_or(mapping.as_str());
                let mut mapping_parts = mapped.splitn(2, ';');
                let target_data_type = mapping_parts.next().unwrap_or(mapped).trim();
                let mapping_reason = mapping_parts.next().map(str::trim).unwrap_or("");
                let reason = match (mapping_reason.is_empty(), lossy) {
                    (true, true) => "Target-side validation is required.".to_string(),
                    (true, false) => "Deterministic target type mapping.".to_string(),
                    (false, true) => {
                        format!("{mapping_reason}; target-side validation is required")
                    }
                    (false, false) => mapping_reason.to_string(),
                };
                issues.push(SchemaConversionIssue {
                    feature_kind: if column.data_type.trim().ends_with("[]")
                        || column.data_type.trim().to_ascii_lowercase().starts_with("array<")
                    {
                        SchemaConversionFeatureKind::Array
                    } else {
                        SchemaConversionFeatureKind::Type
                    },
                    relation_name: relation.name.clone(),
                    column_name: column.name.clone(),
                    source_data_type: column.data_type.clone(),
                    target_data_type: Some(target_data_type.to_string()),
                    compatibility: if lossy {
                        SchemaConversionCompatibility::Review
                    } else {
                        SchemaConversionCompatibility::Safe
                    },
                    reason,
                    remediation: if lossy {
                        format!(
                            "Confirm the {} representation, value range, null/default behavior, and round-trip expectations.",
                            target.driver
                        )
                    } else {
                        format!(
                            "Verify the deterministic mapping against the installed {} driver capability profile.",
                            target.driver
                        )
                    },
                    blocks_automatic_conversion: lossy,
                });
            } else if postgres_type_looks_custom(&column.data_type) {
                issues.push(SchemaConversionIssue {
                    feature_kind: SchemaConversionFeatureKind::CustomType,
                    relation_name: relation.name.clone(),
                    column_name: column.name.clone(),
                    source_data_type: column.data_type.clone(),
                    target_data_type: None,
                    compatibility: SchemaConversionCompatibility::Unsupported,
                    reason: format!(
                        "Custom PostgreSQL type requires an explicit {} type and value-conversion policy.",
                        target.driver
                    ),
                    remediation: format!(
                        "Define a target-owned {} type plus a deterministic value conversion before generating DDL.",
                        target.driver
                    ),
                    blocks_automatic_conversion: true,
                });
            }
            if let Some(default_value) = column.default_value.as_deref() {
                if let Some((target_default, reason, blocks_automatic_conversion)) =
                    postgres_default_conversion_note(default_value, &target_driver)
                {
                    issues.push(SchemaConversionIssue {
                        feature_kind: SchemaConversionFeatureKind::Default,
                        relation_name: relation.name.clone(),
                        column_name: column.name.clone(),
                        source_data_type: format!("DEFAULT {default_value}"),
                        target_data_type: target_default.map(|value| format!("DEFAULT {value}")),
                        compatibility: SchemaConversionCompatibility::Review,
                        reason,
                        remediation: format!(
                            "Confirm the target-owned {} default and verify generated values before enabling DDL.",
                            target.driver
                        ),
                        blocks_automatic_conversion,
                    });
                }
            }
        }
        for index in &relation.indexes {
            if let Some((target_index_type, reason, blocks_automatic_conversion)) =
                postgres_index_conversion_note(index, &target_driver)
            {
                let index_type = index.index_type.as_deref().unwrap_or("btree");
                issues.push(SchemaConversionIssue {
                    feature_kind: SchemaConversionFeatureKind::Index,
                    relation_name: relation.name.clone(),
                    column_name: format!("index:{}", index.name),
                    source_data_type: format!("{} INDEX", index_type.to_ascii_uppercase()),
                    target_data_type: target_index_type
                        .map(|value| format!("{} INDEX", value.to_ascii_uppercase())),
                    compatibility: SchemaConversionCompatibility::Review,
                    reason,
                    remediation: format!(
                        "Choose an equivalent {} index strategy, or explicitly accept the indexing behavior loss.",
                        target.driver
                    ),
                    blocks_automatic_conversion,
                });
            }
        }
    }
    issues.sort_by(|left, right| {
        (
            &left.relation_name,
            &left.column_name,
            &left.source_data_type,
        )
            .cmp(&(
                &right.relation_name,
                &right.column_name,
                &right.source_data_type,
            ))
    });
    issues.dedup();
    issues
}

fn cross_driver_conversion_note(issue: &SchemaConversionIssue) -> String {
    if issue.relation_name == "*" && issue.column_name == "*" {
        return issue.reason.clone();
    }
    let prefix = match issue.compatibility {
        SchemaConversionCompatibility::Safe => "",
        SchemaConversionCompatibility::Review => "LOSSY ",
        SchemaConversionCompatibility::Unsupported => "UNSUPPORTED ",
    };
    format!(
        "{}{}.{}: {} -> {}{}",
        prefix,
        issue.relation_name,
        issue.column_name,
        issue.source_data_type,
        issue.target_data_type.as_deref().unwrap_or("unmapped"),
        if issue.reason.is_empty() {
            String::new()
        } else {
            format!("; {}", issue.reason)
        }
    )
}

fn annotate_cross_driver_review(
    plan: &mut SchemaDiffPlan,
    source: &SchemaSnapshot,
    target: &SchemaSnapshot,
) {
    let issues = cross_driver_conversion_issues(source, target);
    let notes = issues
        .iter()
        .map(cross_driver_conversion_note)
        .collect::<Vec<_>>();
    plan.conversion_issues = issues;
    plan.warnings.push(format!(
        "Cross-driver comparison {} -> {} is review-only. Automatic DDL generation and apply are disabled.",
        source.driver, target.driver
    ));
    plan.warnings.extend(notes.iter().cloned());
    plan.warnings.sort();
    plan.warnings.dedup();

    let mut artifact = vec![
        format!(
            "-- Cross-driver metadata comparison: {} -> {}.",
            source.driver, target.driver
        ),
        "-- No migration commands were generated or executed.".to_string(),
        "-- Deterministic conversion review notes:".to_string(),
    ];
    if notes.is_empty() {
        artifact.push("--   No special mappings detected in captured columns.".to_string());
    } else {
        artifact.extend(notes.iter().map(|note| format!("--   {note}")));
    }
    artifact.push("-- Build and revalidate a target-driver plan before any execution.".to_string());
    artifact.push(String::new());
    plan.migration_sql = artifact.join("\n");
}

fn compare_metadata_snapshots(
    source: &SchemaSnapshot,
    target: &SchemaSnapshot,
    generated_at: i64,
    driver: &str,
) -> Result<SchemaDiffPlan> {
    let source_objects = relation_map(&source.relations);
    let target_objects = relation_map(&target.relations);
    let mut object_names = source_objects
        .keys()
        .chain(target_objects.keys())
        .cloned()
        .collect::<Vec<_>>();
    object_names.sort();
    object_names.dedup();
    let mut changes = Vec::new();

    for object_name in object_names {
        match (
            source_objects.get(&object_name),
            target_objects.get(&object_name),
        ) {
            (Some(source_object), None) => changes.push(metadata_only_change(
                SchemaChangeKind::RelationCreate,
                &target.schema_name,
                &object_name,
                source_object.object_type.clone(),
                None,
                format!("Object {object_name} exists in the snapshot but not in live metadata"),
            )),
            (None, Some(target_object)) => changes.push(metadata_only_change(
                SchemaChangeKind::RelationDrop,
                &target.schema_name,
                &object_name,
                target_object.object_type.clone(),
                None,
                format!("Live object {object_name} is absent from the snapshot"),
            )),
            (Some(source_object), Some(target_object)) => {
                compare_metadata_children(
                    &target.schema_name,
                    source_object,
                    target_object,
                    &mut changes,
                );
            }
            (None, None) => unreachable!(),
        }
    }
    let mut routine_warnings = Vec::new();
    compare_routines(
        &source.routines,
        &target.routines,
        &target.schema_name,
        &mut changes,
        &mut routine_warnings,
    );
    compare_schema_objects(
        &source.schema_objects,
        &target.schema_objects,
        &target.schema_name,
        &mut changes,
        &mut routine_warnings,
    );

    for (order, change) in changes.iter_mut().enumerate() {
        change.order = order;
    }
    let summary = summarize_changes(&changes);
    let id = stable_id(
        "metadata-diff",
        &format!(
            "metadata-diff:{}:{}:{}",
            source.fingerprint, target.fingerprint, target.schema_name
        ),
    );

    Ok(SchemaDiffPlan {
        id,
        source_snapshot_id: source.id.clone(),
        target_snapshot_id: target.id.clone(),
        driver: driver.to_string(),
        target_connection_id: target.connection_id.clone(),
        target_database_name: target.database_name.clone(),
        target_schema_name: target.schema_name.clone(),
        generated_at,
        transactional: false,
        execution_owner: SchemaDiffExecutionOwner::ReviewOnly,
        requires_review_approval: true,
        requires_destructive_approval: false,
        summary,
        changes,
        migration_sql: "-- Metadata-only comparison; no migration commands were generated.\n"
            .to_string(),
        preflight_checks: Vec::new(),
        preflight_sql: String::new(),
        conversion_issues: Vec::new(),
        warnings: {
            let mut warnings = vec![
                "This driver requires review-specific schema handling; automatic restore is disabled."
                    .to_string(),
            ];
            warnings.extend(routine_warnings);
            warnings.sort();
            warnings.dedup();
            warnings
        },
    })
}

/// Builds a SQLite-specific rebuild *review* plan. SQLite can only add a
/// narrow class of columns directly; changing a table definition safely needs
/// a replacement table, a bounded copy of the columns that still exist, and
/// recreation of compatible indexes. This module intentionally does not make
/// the generated SQL executable through the migration command: a backup,
/// foreign-key check, and live-engine validation are mandatory first.
fn compare_sqlite_schema_snapshots(
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

    let mut changes = Vec::new();
    let mut warnings = source
        .warnings
        .iter()
        .chain(target.warnings.iter())
        .cloned()
        .collect::<Vec<_>>();
    warnings.push(
        "SQLite plans are rebuild-review artifacts only. Automatic apply remains disabled until backup, foreign-key, rollback, and live-engine validation are implemented."
            .to_string(),
    );

    for relation_name in relation_names {
        match (
            source_relations.get(&relation_name),
            target_relations.get(&relation_name),
        ) {
            (Some(source_relation), None) => {
                let (sql, relation_warnings) =
                    sqlite_create_relation_sql(source_relation, &relation_name);
                warnings.extend(relation_warnings);
                let mut create = change(
                    SchemaChangeKind::RelationCreate,
                    SchemaChangeRisk::Review,
                    &target.schema_name,
                    &relation_name,
                    source_relation.object_type.clone(),
                    None,
                    format!("Review creation of SQLite relation {relation_name}"),
                    sql,
                    false,
                    true,
                );
                create.phase = SchemaChangePhase::ManualReview;
                create.blocked_reason = Some(
                    "SQLite creation is supplied for review only; automatic apply is disabled."
                        .to_string(),
                );
                changes.push(create);
            }
            (None, Some(target_relation)) => {
                let mut drop = change(
                    SchemaChangeKind::RelationDrop,
                    SchemaChangeRisk::Destructive,
                    &target.schema_name,
                    &relation_name,
                    target_relation.object_type.clone(),
                    None,
                    format!("Review removal of target-only SQLite relation {relation_name}"),
                    Vec::new(),
                    false,
                    true,
                );
                drop.phase = SchemaChangePhase::ManualReview;
                drop.blocked_reason = Some(
                    "SQLite relation removal requires a backup and foreign-key dependency review."
                        .to_string(),
                );
                changes.push(drop);
            }
            (Some(source_relation), Some(target_relation))
                if sqlite_relation_requires_rebuild(source_relation, target_relation) =>
            {
                // Keep the child-level drift visible in the UI, then add one
                // table-level artifact that describes the only safe SQLite
                // strategy for applying those changes as a unit.
                compare_metadata_children(
                    &target.schema_name,
                    source_relation,
                    target_relation,
                    &mut changes,
                );
                let (sql, relation_warnings) =
                    sqlite_rebuild_relation_sql(source, target, source_relation, target_relation);
                warnings.extend(relation_warnings);
                let mut rebuild = change(
                    SchemaChangeKind::RelationModify,
                    SchemaChangeRisk::Review,
                    &target.schema_name,
                    &relation_name,
                    source_relation.object_type.clone(),
                    None,
                    format!("Review SQLite rebuild for {relation_name}"),
                    sql,
                    false,
                    true,
                );
                rebuild.phase = SchemaChangePhase::ManualReview;
                rebuild.blocked_reason = Some(
                    "SQLite rebuild plans must be reviewed, backed up, and foreign-key checked before manual execution; automatic apply is disabled."
                        .to_string(),
                );
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
        &source.routines,
        &target.routines,
        &target.schema_name,
        &mut changes,
        &mut warnings,
    );
    compare_schema_objects(
        &source.schema_objects,
        &target.schema_objects,
        &target.schema_name,
        &mut changes,
        &mut warnings,
    );
    for (order, change) in changes.iter_mut().enumerate() {
        change.order = order + 1;
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
        transactional: false,
        execution_owner: SchemaDiffExecutionOwner::ReviewOnly,
        requires_review_approval: true,
        requires_destructive_approval: false,
        summary,
        migration_sql: render_sqlite_rebuild_migration_sql(source, target, &changes, &warnings),
        preflight_checks: Vec::new(),
        preflight_sql: "-- SQLite rebuild preflight is intentionally manual until its backup and foreign-key checks have a verified runtime contract.\n".to_string(),
        conversion_issues: Vec::new(),
        warnings,
        changes,
    })
}

fn sqlite_quote_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

fn sqlite_object_is_table(relation: &SchemaRelationSnapshot) -> bool {
    let flags = relation_flags(relation.object_type.as_deref());
    !flags.is_view && !flags.is_materialized_view && !flags.is_foreign_table
}

fn sqlite_relation_requires_rebuild(
    source: &SchemaRelationSnapshot,
    target: &SchemaRelationSnapshot,
) -> bool {
    if source.object_type != target.object_type
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
            || source_column.is_generated != target_column.is_generated
            || source_column.is_hidden != target_column.is_hidden
            || source_column.default_value != target_column.default_value
    })
}

fn sqlite_sql_fragment_is_safe(fragment: &str) -> bool {
    !fragment.contains('\0') && !fragment.contains(';')
}

fn sqlite_column_definition(column: &ColumnInfo) -> Result<String, String> {
    if column.is_generated != Some(false) || column.is_hidden != Some(false) {
        return Err(format!(
            "Column {} has generated/hidden metadata that is true or unknown, but its lossless SQLite expression or visibility clause was not captured.",
            column.name
        ));
    }
    let data_type = column.data_type.trim();
    if data_type.is_empty() || !sqlite_sql_fragment_is_safe(data_type) {
        return Err(format!(
            "Column {} has an empty or unsafe SQLite type declaration.",
            column.name
        ));
    }
    let mut definition = format!("{} {data_type}", sqlite_quote_identifier(&column.name));
    if column.is_auto_increment {
        if column.is_primary_key && data_type.eq_ignore_ascii_case("INTEGER") {
            definition.push_str(" PRIMARY KEY AUTOINCREMENT");
        } else {
            return Err(format!(
                "Column {} requests AUTOINCREMENT but SQLite only permits it on an INTEGER PRIMARY KEY.",
                column.name
            ));
        }
    }
    if let Some(default_value) = column.default_value.as_deref() {
        if !sqlite_sql_fragment_is_safe(default_value) {
            return Err(format!(
                "Column {} has an unsafe default expression that cannot be placed in a rebuild artifact.",
                column.name
            ));
        }
        definition.push_str(" DEFAULT ");
        definition.push_str(default_value.trim());
    }
    if !column.is_nullable {
        definition.push_str(" NOT NULL");
    }
    Ok(definition)
}

fn sqlite_constraint_clause(
    relation: &SchemaRelationSnapshot,
    constraint: &ConstraintInfo,
) -> Result<String, String> {
    let normalized = constraint.constraint_type.to_ascii_uppercase();
    let valid_columns = relation
        .columns
        .iter()
        .map(|column| column.name.as_str())
        .collect::<BTreeSet<_>>();
    if (!normalized.contains("CHECK") && constraint.columns.is_empty())
        || constraint
            .columns
            .iter()
            .any(|column| !valid_columns.contains(column.as_str()))
    {
        return Err(format!(
            "Constraint {}.{} references columns not present in the desired table.",
            relation.name, constraint.name
        ));
    }
    let name = if constraint.name.trim().is_empty() {
        String::new()
    } else {
        format!("CONSTRAINT {} ", sqlite_quote_identifier(&constraint.name))
    };
    let columns = constraint
        .columns
        .iter()
        .map(|column| sqlite_quote_identifier(column))
        .collect::<Vec<_>>()
        .join(", ");
    if normalized.contains("PRIMARY") {
        return Ok(format!("{name}PRIMARY KEY ({columns})"));
    }
    if normalized.contains("UNIQUE") {
        return Ok(format!("{name}UNIQUE ({columns})"));
    }
    if normalized.contains("FOREIGN") {
        let referenced_table = constraint.referenced_table.as_deref().ok_or_else(|| {
            format!(
                "Foreign key {}.{} is missing its referenced table.",
                relation.name, constraint.name
            )
        })?;
        if constraint.referenced_columns.is_empty()
            || constraint.referenced_columns.len() != constraint.columns.len()
        {
            return Err(format!(
                "Foreign key {}.{} has an incomplete referenced-column mapping.",
                relation.name, constraint.name
            ));
        }
        let referenced_columns = constraint
            .referenced_columns
            .iter()
            .map(|column| sqlite_quote_identifier(column))
            .collect::<Vec<_>>()
            .join(", ");
        return Ok(format!(
            "{name}FOREIGN KEY ({columns}) REFERENCES {} ({referenced_columns})",
            sqlite_quote_identifier(referenced_table)
        ));
    }
    if normalized.contains("CHECK") {
        let definition = constraint
            .definition
            .as_deref()
            .map(str::trim)
            .filter(|definition| !definition.is_empty() && sqlite_sql_fragment_is_safe(definition))
            .ok_or_else(|| {
                format!(
                    "CHECK constraint {}.{} needs its exact source definition.",
                    relation.name, constraint.name
                )
            })?;
        let uppercase_definition = definition.to_ascii_uppercase();
        if uppercase_definition.starts_with("CONSTRAINT ") {
            return Ok(definition.to_string());
        }
        let definition = if uppercase_definition.starts_with("CHECK") {
            definition.to_string()
        } else {
            format!("CHECK ({definition})")
        };
        return Ok(format!("{name}{definition}"));
    }
    Err(format!(
        "Constraint {}.{} has an unsupported SQLite constraint type {}.",
        relation.name, constraint.name, constraint.constraint_type
    ))
}

fn sqlite_create_index_sql(
    relation: &SchemaRelationSnapshot,
    table_name: &str,
    index: &IndexInfo,
) -> Result<String, String> {
    let valid_columns = relation
        .columns
        .iter()
        .map(|column| column.name.as_str())
        .collect::<BTreeSet<_>>();
    let index_type = index.index_type.as_deref().map(str::trim);
    let supported_index_type =
        index_type.is_none_or(|value| value.is_empty() || value.eq_ignore_ascii_case("BTREE"));
    if index.columns.is_empty()
        || index
            .columns
            .iter()
            .any(|column| !valid_columns.contains(column.as_str()))
        || !supported_index_type
    {
        return Err(format!(
            "Index {}.{} is expression-based, has an unsupported type, or references an unavailable column.",
            relation.name, index.name
        ));
    }
    let columns = index
        .columns
        .iter()
        .map(|column| sqlite_quote_identifier(column))
        .collect::<Vec<_>>()
        .join(", ");
    Ok(format!(
        "CREATE {}INDEX {} ON {} ({});",
        if index.is_unique { "UNIQUE " } else { "" },
        sqlite_quote_identifier(&index.name),
        sqlite_quote_identifier(table_name),
        columns
    ))
}

fn sqlite_create_relation_sql(
    relation: &SchemaRelationSnapshot,
    table_name: &str,
) -> (Vec<String>, Vec<String>) {
    if !sqlite_object_is_table(relation) {
        return (
            Vec::new(),
            vec![format!(
                "SQLite relation {} is a view or unsupported object and requires exact source DDL.",
                relation.name
            )],
        );
    }
    if relation.columns.is_empty() {
        return (
            Vec::new(),
            vec![format!(
                "SQLite relation {} has no captured columns, so no CREATE TABLE artifact was generated.",
                relation.name
            )],
        );
    }
    let mut warnings = Vec::new();
    let mut definitions = Vec::new();
    for column in &relation.columns {
        match sqlite_column_definition(column) {
            Ok(definition) => definitions.push(format!("  {definition}")),
            Err(warning) => warnings.push(warning),
        }
    }
    let has_auto_increment_primary = relation
        .columns
        .iter()
        .any(|column| column.is_auto_increment && column.is_primary_key);
    let has_primary_constraint = relation.constraints.iter().any(|constraint| {
        constraint
            .constraint_type
            .to_ascii_uppercase()
            .contains("PRIMARY")
    });
    for constraint in &relation.constraints {
        match sqlite_constraint_clause(relation, constraint) {
            Ok(clause) => definitions.push(format!("  {clause}")),
            Err(warning) => warnings.push(warning),
        }
    }
    if !has_primary_constraint && !has_auto_increment_primary {
        let primary_columns = relation
            .columns
            .iter()
            .filter(|column| column.is_primary_key)
            .map(|column| sqlite_quote_identifier(&column.name))
            .collect::<Vec<_>>();
        if !primary_columns.is_empty() {
            definitions.push(format!("  PRIMARY KEY ({})", primary_columns.join(", ")));
        }
    }
    if !warnings.is_empty() {
        return (Vec::new(), warnings);
    }
    let mut sql = vec![format!(
        "CREATE TABLE {} (\n{}\n);",
        sqlite_quote_identifier(table_name),
        definitions.join(",\n")
    )];
    let constraint_names = relation
        .constraints
        .iter()
        .map(|constraint| constraint.name.as_str())
        .collect::<BTreeSet<_>>();
    for index in relation
        .indexes
        .iter()
        .filter(|index| !index.is_primary && !constraint_names.contains(index.name.as_str()))
    {
        match sqlite_create_index_sql(relation, table_name, index) {
            Ok(index_sql) => sql.push(index_sql),
            Err(warning) => warnings.push(warning),
        }
    }
    if !warnings.is_empty() {
        sql.clear();
    }
    (sql, warnings)
}

fn sqlite_rebuild_relation_sql(
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
    let (create_sql, mut warnings) = sqlite_create_relation_sql(source_relation, &temporary_table);
    if create_sql.is_empty() {
        return (Vec::new(), warnings);
    }
    let target_columns = target_relation
        .columns
        .iter()
        .map(|column| (column.name.as_str(), column))
        .collect::<BTreeMap<_, _>>();
    let preserved_columns = source_relation
        .columns
        .iter()
        .filter(|source_column| target_columns.contains_key(source_column.name.as_str()))
        .collect::<Vec<_>>();
    if preserved_columns.is_empty() {
        warnings.push(format!(
            "SQLite rebuild for {} has no same-name columns to copy; manually provide a data transformation before execution.",
            source_relation.name
        ));
        return (Vec::new(), warnings);
    }
    for source_column in &source_relation.columns {
        if !target_columns.contains_key(source_column.name.as_str())
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
    let mut sql = vec![
        "-- REVIEW ONLY: take a verified backup and inspect PRAGMA foreign_key_check before running any rebuild steps.".to_string(),
        "PRAGMA foreign_keys = OFF;".to_string(),
        "BEGIN IMMEDIATE;".to_string(),
    ];
    sql.extend(create_sql.into_iter().filter(|statement| {
        !statement.starts_with("CREATE INDEX") && !statement.starts_with("CREATE UNIQUE INDEX")
    }));
    sql.push(format!(
        "INSERT INTO {} ({copied_columns}) SELECT {copied_columns} FROM {};",
        sqlite_quote_identifier(&temporary_table),
        sqlite_quote_identifier(&target_relation.name)
    ));
    sql.push(format!(
        "DROP TABLE {};",
        sqlite_quote_identifier(&target_relation.name)
    ));
    sql.push(format!(
        "ALTER TABLE {} RENAME TO {};",
        sqlite_quote_identifier(&temporary_table),
        sqlite_quote_identifier(&source_relation.name)
    ));
    let constraint_names = source_relation
        .constraints
        .iter()
        .map(|constraint| constraint.name.as_str())
        .collect::<BTreeSet<_>>();
    for index in source_relation
        .indexes
        .iter()
        .filter(|index| !index.is_primary && !constraint_names.contains(index.name.as_str()))
    {
        match sqlite_create_index_sql(source_relation, &source_relation.name, index) {
            Ok(index_sql) => sql.push(index_sql),
            Err(warning) => warnings.push(warning),
        }
    }
    if !warnings.is_empty() {
        return (Vec::new(), warnings);
    }
    sql.extend([
        "PRAGMA foreign_key_check;".to_string(),
        "COMMIT;".to_string(),
        "PRAGMA foreign_keys = ON;".to_string(),
    ]);
    (sql, warnings)
}

fn render_sqlite_rebuild_migration_sql(
    source: &SchemaSnapshot,
    target: &SchemaSnapshot,
    changes: &[SchemaChange],
    warnings: &[String],
) -> String {
    let mut lines = vec![
        "-- OxideStudio SQLite schema rebuild review".to_string(),
        format!("-- Desired source: {} / {}", source.connection_name, source.schema_name),
        format!("-- Actual target: {} / {}", target.connection_name, target.schema_name),
        "-- This artifact is not executable through OxideStudio. Take a verified backup and validate a copy first.".to_string(),
        "-- Run PRAGMA foreign_key_check before and after every manually reviewed rebuild.".to_string(),
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

fn routine_map(routines: &[SchemaRoutineSnapshot]) -> BTreeMap<String, &SchemaRoutineSnapshot> {
    routines
        .iter()
        .map(|routine| (routine_identity(routine), routine))
        .collect()
}

/// Use the executable signature as the identity so overloaded routines remain
/// distinct. Parameter names are intentionally excluded: a rename can be
/// reviewed as a modification, while a type/arity change becomes drop/create.
fn routine_identity(routine: &SchemaRoutineSnapshot) -> String {
    format!(
        "{}:{}({})",
        routine
            .routine_type
            .as_deref()
            .unwrap_or("FUNCTION")
            .to_ascii_uppercase(),
        routine.name,
        routine
            .parameters
            .iter()
            .map(|parameter| parameter.data_type.to_ascii_lowercase())
            .collect::<Vec<_>>()
            .join(","),
    )
}

fn routine_label(routine: &SchemaRoutineSnapshot) -> String {
    format!(
        "{}({})",
        routine.name,
        routine
            .parameters
            .iter()
            .map(|parameter| parameter.data_type.as_str())
            .collect::<Vec<_>>()
            .join(", "),
    )
}

fn routine_object_type(routine: &SchemaRoutineSnapshot) -> Option<String> {
    Some(
        routine
            .routine_type
            .as_deref()
            .unwrap_or("FUNCTION")
            .to_ascii_uppercase(),
    )
}

fn routine_review_change(
    kind: SchemaChangeKind,
    schema_name: &str,
    routine: &SchemaRoutineSnapshot,
    summary: String,
) -> SchemaChange {
    let mut change = change(
        kind,
        SchemaChangeRisk::Review,
        schema_name,
        &routine.name,
        routine_object_type(routine),
        Some(routine_label(routine)),
        summary,
        Vec::new(),
        false,
        true,
    );
    change.phase = SchemaChangePhase::ManualReview;
    change.blocked_reason = Some(
        "Routine bodies and executable DDL are intentionally excluded from schema snapshots; review and apply this change manually."
            .to_string(),
    );
    change
}

fn compare_routines(
    source: &[SchemaRoutineSnapshot],
    target: &[SchemaRoutineSnapshot],
    schema_name: &str,
    changes: &mut Vec<SchemaChange>,
    warnings: &mut Vec<String>,
) {
    let source_routines = routine_map(source);
    let target_routines = routine_map(target);
    let mut identities = source_routines
        .keys()
        .chain(target_routines.keys())
        .cloned()
        .collect::<Vec<_>>();
    identities.sort();
    identities.dedup();

    let change_start = changes.len();
    for identity in identities {
        match (
            source_routines.get(&identity),
            target_routines.get(&identity),
        ) {
            (Some(source_routine), None) => changes.push(routine_review_change(
                SchemaChangeKind::RoutineCreate,
                schema_name,
                source_routine,
                format!(
                    "Review creation of routine {}",
                    routine_label(source_routine)
                ),
            )),
            (None, Some(target_routine)) => changes.push(routine_review_change(
                SchemaChangeKind::RoutineDrop,
                schema_name,
                target_routine,
                format!(
                    "Review removal of routine {}",
                    routine_label(target_routine)
                ),
            )),
            (Some(source_routine), Some(target_routine)) if source_routine != target_routine => {
                changes.push(routine_review_change(
                    SchemaChangeKind::RoutineModify,
                    schema_name,
                    source_routine,
                    format!("Review changed routine {}", routine_label(source_routine)),
                ));
            }
            _ => {}
        }
    }
    if changes.len() > change_start {
        warnings.push(
            "Routine signature drift is review-only: routine bodies and automatic routine DDL are intentionally unavailable."
                .to_string(),
        );
    }
}

fn schema_object_map(objects: &[SchemaObjectSnapshot]) -> BTreeMap<String, &SchemaObjectSnapshot> {
    objects
        .iter()
        .map(|object| (schema_object_identity(object), object))
        .collect()
}

fn schema_object_identity(object: &SchemaObjectSnapshot) -> String {
    format!(
        "{}:{}",
        object.object_type.to_ascii_uppercase(),
        object.name
    )
}

fn schema_object_label(object: &SchemaObjectSnapshot) -> String {
    match object.parent_name.as_deref() {
        Some(parent) => format!("{} {} (parent: {parent})", object.object_type, object.name),
        None => format!("{} {}", object.object_type, object.name),
    }
}

fn schema_object_review_change(
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

fn compare_schema_objects(
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
            (Some(source_object), None) => changes.push(schema_object_review_change(
                SchemaChangeKind::SchemaObjectCreate,
                schema_name,
                source_object,
                format!("Review creation of {}", schema_object_label(source_object)),
            )),
            (None, Some(target_object)) => changes.push(schema_object_review_change(
                SchemaChangeKind::SchemaObjectDrop,
                schema_name,
                target_object,
                format!("Review removal of {}", schema_object_label(target_object)),
            )),
            (Some(source_object), Some(target_object)) if source_object != target_object => {
                changes.push(schema_object_review_change(
                    SchemaChangeKind::SchemaObjectModify,
                    schema_name,
                    source_object,
                    format!("Review changed {}", schema_object_label(source_object)),
                ));
            }
            _ => {}
        }
    }
    if changes.len() > change_start {
        warnings.push(
            "Schema object descriptor drift is review-only: source/DDL and automatic migration are intentionally unavailable."
                .to_string(),
        );
    }
}

fn compare_metadata_children(
    schema_name: &str,
    source: &SchemaRelationSnapshot,
    target: &SchemaRelationSnapshot,
    changes: &mut Vec<SchemaChange>,
) {
    let source_columns = source
        .columns
        .iter()
        .map(|column| (column.name.as_str(), column))
        .collect::<BTreeMap<_, _>>();
    let target_columns = target
        .columns
        .iter()
        .map(|column| (column.name.as_str(), column))
        .collect::<BTreeMap<_, _>>();
    let mut column_names = source_columns
        .keys()
        .chain(target_columns.keys())
        .copied()
        .collect::<Vec<_>>();
    column_names.sort();
    column_names.dedup();
    for column_name in column_names {
        let (kind, summary) = match (
            source_columns.get(column_name),
            target_columns.get(column_name),
        ) {
            (Some(_), None) => (
                SchemaChangeKind::ColumnAdd,
                format!("Field {column_name} is missing from live metadata"),
            ),
            (None, Some(_)) => (
                SchemaChangeKind::ColumnDrop,
                format!("Live field {column_name} is absent from the snapshot"),
            ),
            (Some(source_column), Some(target_column)) if source_column != target_column => (
                SchemaChangeKind::ColumnModify,
                format!("Field {column_name} metadata changed"),
            ),
            _ => continue,
        };
        changes.push(metadata_only_change(
            kind,
            schema_name,
            &source.name,
            source.object_type.clone(),
            Some(column_name.to_string()),
            summary,
        ));
    }

    // A number of engines expose the backing index for a primary/unique
    // constraint in both metadata collections. Mirror the native planner's
    // view so a read-only diff explains the logical constraint once instead
    // of reporting a duplicate index change as well.
    let source_constraint_names = source
        .constraints
        .iter()
        .map(|constraint| constraint.name.as_str())
        .collect::<std::collections::HashSet<_>>();
    let target_constraint_names = target
        .constraints
        .iter()
        .map(|constraint| constraint.name.as_str())
        .collect::<std::collections::HashSet<_>>();
    let source_indexes = source
        .indexes
        .iter()
        .filter(|index| !index.is_primary && !source_constraint_names.contains(index.name.as_str()))
        .map(|index| (index.name.as_str(), index))
        .collect::<BTreeMap<_, _>>();
    let target_indexes = target
        .indexes
        .iter()
        .filter(|index| !index.is_primary && !target_constraint_names.contains(index.name.as_str()))
        .map(|index| (index.name.as_str(), index))
        .collect::<BTreeMap<_, _>>();
    let mut index_names = source_indexes
        .keys()
        .chain(target_indexes.keys())
        .copied()
        .collect::<Vec<_>>();
    index_names.sort();
    index_names.dedup();
    for index_name in index_names {
        let (kind, summary) = match (
            source_indexes.get(index_name),
            target_indexes.get(index_name),
        ) {
            (Some(_), None) => (
                SchemaChangeKind::IndexAdd,
                format!("Index {index_name} is missing from live metadata"),
            ),
            (None, Some(_)) => (
                SchemaChangeKind::IndexDrop,
                format!("Live index {index_name} is absent from the snapshot"),
            ),
            (Some(source_index), Some(target_index)) if source_index != target_index => (
                SchemaChangeKind::IndexModify,
                format!("Index {index_name} metadata changed"),
            ),
            _ => continue,
        };
        changes.push(metadata_only_change(
            kind,
            schema_name,
            &source.name,
            source.object_type.clone(),
            Some(index_name.to_string()),
            summary,
        ));
    }

    let source_constraints = source
        .constraints
        .iter()
        .map(|constraint| (constraint.name.as_str(), constraint))
        .collect::<BTreeMap<_, _>>();
    let target_constraints = target
        .constraints
        .iter()
        .map(|constraint| (constraint.name.as_str(), constraint))
        .collect::<BTreeMap<_, _>>();
    let mut constraint_names = source_constraints
        .keys()
        .chain(target_constraints.keys())
        .copied()
        .collect::<Vec<_>>();
    constraint_names.sort();
    constraint_names.dedup();
    for constraint_name in constraint_names {
        let (kind, summary) = match (
            source_constraints.get(constraint_name),
            target_constraints.get(constraint_name),
        ) {
            (Some(_), None) => (
                SchemaChangeKind::ConstraintAdd,
                format!("Constraint {constraint_name} is missing from live metadata"),
            ),
            (None, Some(_)) => (
                SchemaChangeKind::ConstraintDrop,
                format!("Live constraint {constraint_name} is absent from the snapshot"),
            ),
            (Some(source_constraint), Some(target_constraint))
                if source_constraint != target_constraint =>
            {
                (
                    SchemaChangeKind::ConstraintModify,
                    format!("Constraint {constraint_name} metadata changed"),
                )
            }
            _ => continue,
        };
        changes.push(metadata_only_change(
            kind,
            schema_name,
            &source.name,
            source.object_type.clone(),
            Some(constraint_name.to_string()),
            summary,
        ));
    }
}

fn metadata_only_change(
    kind: SchemaChangeKind,
    schema_name: &str,
    relation_name: &str,
    object_type: Option<String>,
    child_name: Option<String>,
    summary: String,
) -> SchemaChange {
    let mut change = change(
        kind,
        SchemaChangeRisk::Review,
        schema_name,
        relation_name,
        object_type,
        child_name,
        summary,
        Vec::new(),
        false,
        true,
    );
    change.phase = SchemaChangePhase::ManualReview;
    change.blocked_reason =
        Some("Automatic migration is unavailable for this metadata-only comparison.".to_string());
    change
}

fn compare_relation(
    kind: DatabaseKind,
    source_schema: &str,
    target_schema: &str,
    source: &SchemaRelationSnapshot,
    target: &SchemaRelationSnapshot,
    changes: &mut Vec<SchemaChange>,
    warnings: &mut Vec<String>,
) {
    let source_flags = relation_flags(source.object_type.as_deref());
    let target_flags = relation_flags(target.object_type.as_deref());
    if source.object_type != target.object_type
        || source_flags.is_view
        || target_flags.is_view
        || source_flags.is_foreign_table
        || target_flags.is_foreign_table
    {
        if source != target {
            warnings.push(format!(
                "Relation {} requires manual review because view/foreign-table definitions are not captured yet.",
                source.name
            ));
            changes.push(change(
                SchemaChangeKind::RelationModify,
                SchemaChangeRisk::Review,
                target_schema,
                &source.name,
                source.object_type.clone(),
                None,
                format!("Review relation definition for {}", source.name),
                Vec::new(),
                false,
                true,
            ));
        }
        return;
    }

    compare_columns(kind, target_schema, source, target, changes, warnings);
    compare_constraints(kind, target_schema, source, target, changes, warnings);
    compare_indexes(
        kind,
        source_schema,
        target_schema,
        source,
        target,
        changes,
        warnings,
    );
    if source.comment != target.comment {
        changes.push(change(
            SchemaChangeKind::RelationModify,
            SchemaChangeRisk::Safe,
            target_schema,
            &source.name,
            source.object_type.clone(),
            None,
            format!("Update table comment for {}", source.name),
            vec![table_comment_sql(
                kind,
                target_schema,
                &source.name,
                source.comment.as_deref(),
            )],
            true,
            false,
        ));
    }
}

fn compare_columns(
    kind: DatabaseKind,
    target_schema: &str,
    source: &SchemaRelationSnapshot,
    target: &SchemaRelationSnapshot,
    changes: &mut Vec<SchemaChange>,
    warnings: &mut Vec<String>,
) {
    let source_columns = source
        .columns
        .iter()
        .map(|column| (column.name.as_str(), column))
        .collect::<BTreeMap<_, _>>();
    let target_columns = target
        .columns
        .iter()
        .map(|column| (column.name.as_str(), column))
        .collect::<BTreeMap<_, _>>();
    let mut names = source_columns
        .keys()
        .chain(target_columns.keys())
        .copied()
        .collect::<Vec<_>>();
    names.sort();
    names.dedup();

    for column_name in names {
        match (
            source_columns.get(column_name),
            target_columns.get(column_name),
        ) {
            (Some(source_column), None) => {
                let (definition, definition_warnings) = column_definition(kind, source_column);
                warnings.extend(definition_warnings);
                let ownership_unmodeled = source_column.is_generated != Some(false)
                    || source_column.is_hidden != Some(false);
                if ownership_unmodeled {
                    warnings.push(format!(
                        "Column {}.{} cannot be generated until its generated/hidden definition is captured losslessly.",
                        source.name, column_name
                    ));
                }
                let risk = if ownership_unmodeled {
                    SchemaChangeRisk::Review
                } else if source_column.is_nullable || source_column.default_value.is_some() {
                    SchemaChangeRisk::Safe
                } else {
                    SchemaChangeRisk::Review
                };
                let sql = (!ownership_unmodeled)
                    .then(|| {
                        format!(
                            "ALTER TABLE {} ADD COLUMN {};",
                            kind.qualified_table(Some(target_schema), &source.name),
                            definition
                        )
                    })
                    .into_iter()
                    .collect();
                changes.push(change(
                    SchemaChangeKind::ColumnAdd,
                    risk,
                    target_schema,
                    &source.name,
                    source.object_type.clone(),
                    Some(column_name.to_string()),
                    format!("Add column {}.{}", source.name, column_name),
                    sql,
                    !ownership_unmodeled,
                    risk == SchemaChangeRisk::Review,
                ));
            }
            (None, Some(_)) => changes.push(change(
                SchemaChangeKind::ColumnDrop,
                SchemaChangeRisk::Destructive,
                target_schema,
                &source.name,
                target.object_type.clone(),
                Some(column_name.to_string()),
                format!("Drop target-only column {}.{}", target.name, column_name),
                vec![kind.drop_column_query(Some(target_schema), &target.name, column_name, false)],
                false,
                true,
            )),
            (Some(source_column), Some(target_column))
                if column_structure_changed(source_column, target_column) =>
            {
                let (sql, manual_review, alter_warnings) = alter_column_sql(
                    kind,
                    target_schema,
                    &source.name,
                    source_column,
                    target_column,
                );
                warnings.extend(alter_warnings);
                let destructive = source_column.data_type != target_column.data_type
                    || (!source_column.is_nullable && target_column.is_nullable);
                changes.push(change(
                    SchemaChangeKind::ColumnModify,
                    if destructive {
                        SchemaChangeRisk::Destructive
                    } else if manual_review {
                        SchemaChangeRisk::Review
                    } else {
                        SchemaChangeRisk::Safe
                    },
                    target_schema,
                    &source.name,
                    source.object_type.clone(),
                    Some(column_name.to_string()),
                    format!("Modify column {}.{}", source.name, column_name),
                    sql,
                    false,
                    manual_review || destructive,
                ));
            }
            _ => {}
        }
    }
}

fn compare_indexes(
    kind: DatabaseKind,
    source_schema: &str,
    target_schema: &str,
    source: &SchemaRelationSnapshot,
    target: &SchemaRelationSnapshot,
    changes: &mut Vec<SchemaChange>,
    warnings: &mut Vec<String>,
) {
    let source_constraints = source
        .constraints
        .iter()
        .map(|constraint| constraint.name.as_str())
        .collect::<std::collections::HashSet<_>>();
    let target_constraints = target
        .constraints
        .iter()
        .map(|constraint| constraint.name.as_str())
        .collect::<std::collections::HashSet<_>>();
    let source_indexes = source
        .indexes
        .iter()
        .filter(|index| !index.is_primary && !source_constraints.contains(index.name.as_str()))
        .map(|index| (index.name.as_str(), index))
        .collect::<BTreeMap<_, _>>();
    let target_indexes = target
        .indexes
        .iter()
        .filter(|index| !index.is_primary && !target_constraints.contains(index.name.as_str()))
        .map(|index| (index.name.as_str(), index))
        .collect::<BTreeMap<_, _>>();
    let mut names = source_indexes
        .keys()
        .chain(target_indexes.keys())
        .copied()
        .collect::<Vec<_>>();
    names.sort();
    names.dedup();

    for index_name in names {
        match (
            source_indexes.get(index_name),
            target_indexes.get(index_name),
        ) {
            (Some(source_index), None) => {
                let sql = create_index_sql(
                    kind,
                    source_schema,
                    target_schema,
                    &source.name,
                    source_index,
                );
                let comment_requires_review = source_index
                    .comment
                    .as_deref()
                    .is_some_and(|comment| !comment.trim().is_empty());
                let (sql, manual_review) = match sql {
                    Ok(_) if comment_requires_review => {
                        warnings.push(format!(
                            "Index {}.{} has a comment that requires a product-specific semantic migration.",
                            source.name, index_name
                        ));
                        (Vec::new(), true)
                    }
                    Ok(sql) => (vec![sql], false),
                    Err(warning) => {
                        warnings.push(warning);
                        (Vec::new(), true)
                    }
                };
                changes.push(change(
                    SchemaChangeKind::IndexAdd,
                    if manual_review {
                        SchemaChangeRisk::Review
                    } else {
                        SchemaChangeRisk::Safe
                    },
                    target_schema,
                    &source.name,
                    source.object_type.clone(),
                    Some(index_name.to_string()),
                    format!("Create index {} on {}", index_name, source.name),
                    sql,
                    true,
                    manual_review,
                ));
            }
            (None, Some(_)) => changes.push(change(
                SchemaChangeKind::IndexDrop,
                SchemaChangeRisk::Review,
                target_schema,
                &target.name,
                target.object_type.clone(),
                Some(index_name.to_string()),
                format!("Drop target-only index {} on {}", index_name, target.name),
                vec![kind.drop_index_query(Some(target_schema), &target.name, index_name)],
                true,
                true,
            )),
            (Some(source_index), Some(target_index))
                if index_structure_changed(source_index, target_index) =>
            {
                let replacement = create_index_sql(
                    kind,
                    source_schema,
                    target_schema,
                    &source.name,
                    source_index,
                );
                let comment_requires_review = source_index
                    .comment
                    .as_deref()
                    .is_some_and(|comment| !comment.trim().is_empty());
                let can_rebuild = replacement.is_ok() && !comment_requires_review;
                if comment_requires_review {
                    warnings.push(format!(
                        "Index {}.{} has a comment that requires a product-specific semantic migration.",
                        source.name, index_name
                    ));
                }
                changes.push(change(
                    SchemaChangeKind::IndexDrop,
                    SchemaChangeRisk::Review,
                    target_schema,
                    &target.name,
                    target.object_type.clone(),
                    Some(index_name.to_string()),
                    format!("Drop changed index {} on {}", index_name, target.name),
                    if can_rebuild {
                        vec![kind.drop_index_query(Some(target_schema), &target.name, index_name)]
                    } else {
                        Vec::new()
                    },
                    true,
                    true,
                ));
                let sql = match replacement {
                    Ok(_) if comment_requires_review => Vec::new(),
                    Ok(replacement) => vec![replacement],
                    Err(warning) => {
                        warnings.push(warning);
                        Vec::new()
                    }
                };
                changes.push(change(
                    SchemaChangeKind::IndexAdd,
                    SchemaChangeRisk::Review,
                    target_schema,
                    &source.name,
                    source.object_type.clone(),
                    Some(index_name.to_string()),
                    format!("Create replacement index {} on {}", index_name, source.name),
                    sql,
                    true,
                    true,
                ));
            }
            (Some(source_index), Some(target_index))
                if source_index.comment != target_index.comment =>
            {
                changes.push(metadata_only_change(
                    SchemaChangeKind::IndexModify,
                    target_schema,
                    &source.name,
                    source.object_type.clone(),
                    Some(index_name.to_string()),
                    format!("Index {} comment changed", index_name),
                ));
            }
            _ => {}
        }
    }
}

fn compare_constraints(
    kind: DatabaseKind,
    target_schema: &str,
    source: &SchemaRelationSnapshot,
    target: &SchemaRelationSnapshot,
    changes: &mut Vec<SchemaChange>,
    warnings: &mut Vec<String>,
) {
    let source_constraints = source
        .constraints
        .iter()
        .map(|constraint| (constraint.name.as_str(), constraint))
        .collect::<BTreeMap<_, _>>();
    let target_constraints = target
        .constraints
        .iter()
        .map(|constraint| (constraint.name.as_str(), constraint))
        .collect::<BTreeMap<_, _>>();
    let mut names = source_constraints
        .keys()
        .chain(target_constraints.keys())
        .copied()
        .collect::<Vec<_>>();
    names.sort();
    names.dedup();

    for constraint_name in names {
        match (
            source_constraints.get(constraint_name),
            target_constraints.get(constraint_name),
        ) {
            (Some(source_constraint), None) => {
                let sql = add_constraint_sql(kind, target_schema, &source.name, source_constraint);
                let manual_review = sql.is_none();
                if manual_review {
                    warnings.push(format!(
                        "Constraint {}.{} has no executable definition.",
                        source.name, constraint_name
                    ));
                }
                changes.push(change(
                    SchemaChangeKind::ConstraintAdd,
                    SchemaChangeRisk::Review,
                    target_schema,
                    &source.name,
                    source.object_type.clone(),
                    Some(constraint_name.to_string()),
                    format!("Add constraint {} on {}", constraint_name, source.name),
                    sql.into_iter().collect(),
                    true,
                    true,
                ));
            }
            (None, Some(target_constraint)) => changes.push(change(
                SchemaChangeKind::ConstraintDrop,
                SchemaChangeRisk::Review,
                target_schema,
                &target.name,
                target.object_type.clone(),
                Some(constraint_name.to_string()),
                format!(
                    "Drop target-only constraint {} on {}",
                    constraint_name, target.name
                ),
                vec![kind.drop_constraint_query(
                    Some(target_schema),
                    &target.name,
                    constraint_name,
                    &target_constraint.constraint_type,
                )],
                true,
                true,
            )),
            (Some(source_constraint), Some(target_constraint))
                if source_constraint != target_constraint =>
            {
                let add_sql =
                    add_constraint_sql(kind, target_schema, &source.name, source_constraint);
                if add_sql.is_none() {
                    warnings.push(format!(
                        "Constraint {}.{} has no executable replacement definition.",
                        source.name, constraint_name
                    ));
                }
                changes.push(change(
                    SchemaChangeKind::ConstraintDrop,
                    SchemaChangeRisk::Review,
                    target_schema,
                    &target.name,
                    target.object_type.clone(),
                    Some(constraint_name.to_string()),
                    format!(
                        "Drop changed constraint {} on {}",
                        constraint_name, target.name
                    ),
                    add_sql.as_ref().map_or_else(Vec::new, |_| {
                        vec![kind.drop_constraint_query(
                            Some(target_schema),
                            &target.name,
                            constraint_name,
                            &target_constraint.constraint_type,
                        )]
                    }),
                    true,
                    true,
                ));
                changes.push(change(
                    SchemaChangeKind::ConstraintAdd,
                    SchemaChangeRisk::Review,
                    target_schema,
                    &source.name,
                    source.object_type.clone(),
                    Some(constraint_name.to_string()),
                    format!(
                        "Create replacement constraint {} on {}",
                        constraint_name, source.name
                    ),
                    add_sql.into_iter().collect(),
                    true,
                    true,
                ));
            }
            _ => {}
        }
    }
}

fn create_relation_sql(
    kind: DatabaseKind,
    source_schema: &str,
    target_schema: &str,
    relation: &SchemaRelationSnapshot,
) -> (Vec<String>, bool, Vec<String>) {
    let flags = relation_flags(relation.object_type.as_deref());
    if flags.is_view || flags.is_foreign_table {
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
            let (definition, column_warnings) = column_definition(kind, column);
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
        if let Some(clause) = inline_constraint_clause(kind, constraint) {
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

fn create_index_sql(
    kind: DatabaseKind,
    source_schema: &str,
    target_schema: &str,
    relation_name: &str,
    index: &IndexInfo,
) -> std::result::Result<String, String> {
    if kind == DatabaseKind::Postgres {
        if source_schema != target_schema {
            return Err(format!(
                "Index {}.{} requires schema-aware definition mapping from {} to {}.",
                relation_name, index.name, source_schema, target_schema
            ));
        }
        if let Some(definition) = index
            .definition
            .as_deref()
            .map(str::trim)
            .filter(|definition| !definition.is_empty())
        {
            return Ok(format!("{};", definition.trim_end_matches(';')));
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
    if !supported_type || index.columns.is_empty() {
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

fn column_definition(kind: DatabaseKind, column: &ColumnInfo) -> (String, Vec<String>) {
    let mut definition = format!(
        "{} {}",
        kind.quote_identifier(&column.name),
        column.data_type.trim()
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
    if column.is_auto_increment {
        match kind.auto_increment_clause_for_type(&column.data_type) {
            Ok(Some(clause)) => definition.push_str(clause),
            Ok(None) => {}
            Err(error) => warnings.push(format!("{}: {error}", column.name)),
        }
    }
    if column.is_generated != Some(true) {
        if let Some(default_value) = column.default_value.as_deref() {
            definition.push_str(" DEFAULT ");
            definition.push_str(&kind.metadata_default_sql(&column.data_type, default_value));
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

fn alter_column_sql(
    kind: DatabaseKind,
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
        let (definition, definition_warnings) = column_definition(kind, source);
        warnings.extend(definition_warnings);
        sql.push(format!(
            "ALTER TABLE {relation} MODIFY COLUMN {definition};"
        ));
        return (sql, !warnings.is_empty(), warnings);
    }

    if source.data_type != target.data_type {
        sql.push(format!(
            "ALTER TABLE {relation} ALTER COLUMN {column} TYPE {} USING {column}::{};",
            source.data_type.trim(),
            source.data_type.trim()
        ));
        manual_review = true;
    }
    if source.default_value != target.default_value {
        match source.default_value.as_deref() {
            Some(default_value) => sql.push(format!(
                "ALTER TABLE {relation} ALTER COLUMN {column} SET DEFAULT {};",
                kind.metadata_default_sql(&source.data_type, default_value)
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
    if source.is_auto_increment != target.is_auto_increment {
        manual_review = true;
        warnings.push(format!(
            "Identity change for {table}.{} requires manual PostgreSQL sequence/identity review.",
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

fn add_constraint_sql(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    constraint: &ConstraintInfo,
) -> Option<String> {
    if let Some(definition) = constraint_definition_sql(kind, constraint) {
        return Some(format!(
            "ALTER TABLE {} ADD CONSTRAINT {} {};",
            kind.qualified_table(Some(schema), table),
            kind.quote_identifier(&constraint.name),
            definition
        ));
    }
    let normalized = constraint.constraint_type.to_ascii_uppercase();
    if normalized.contains("PRIMARY") {
        return Some(kind.add_primary_key_constraint_query(
            Some(schema),
            table,
            &constraint.name,
            &constraint.columns,
        ));
    }
    if normalized.contains("UNIQUE") {
        return Some(kind.add_unique_constraint_query(
            Some(schema),
            table,
            &constraint.name,
            &constraint.columns,
        ));
    }
    if normalized.contains("FOREIGN") {
        if kind == DatabaseKind::Mysql {
            return None;
        }
        return constraint
            .referenced_table
            .as_deref()
            .map(|referenced_table| {
                kind.add_foreign_key_constraint_query(
                    Some(schema),
                    table,
                    &constraint.name,
                    &constraint.columns,
                    constraint.referenced_schema.as_deref().or(Some(schema)),
                    referenced_table,
                    &constraint.referenced_columns,
                    None,
                    None,
                )
            });
    }
    None
}

fn inline_constraint_clause(kind: DatabaseKind, constraint: &ConstraintInfo) -> Option<String> {
    if let Some(definition) = constraint_definition_sql(kind, constraint) {
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
        if kind == DatabaseKind::Mysql {
            return None;
        }
        let referenced_table = constraint.referenced_table.as_deref()?;
        let referenced_columns = constraint
            .referenced_columns
            .iter()
            .map(|column| kind.quote_identifier(column))
            .collect::<Vec<_>>()
            .join(", ");
        return Some(format!(
            "CONSTRAINT {} FOREIGN KEY ({columns}) REFERENCES {} ({referenced_columns})",
            kind.quote_identifier(&constraint.name),
            kind.qualified_table(constraint.referenced_schema.as_deref(), referenced_table)
        ));
    }
    None
}

fn constraint_definition_sql(kind: DatabaseKind, constraint: &ConstraintInfo) -> Option<String> {
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
    Some(definition.to_string())
}

fn is_foreign_constraint(constraint: &ConstraintInfo) -> bool {
    constraint
        .constraint_type
        .to_ascii_uppercase()
        .contains("FOREIGN")
}

fn column_structure_changed(source: &ColumnInfo, target: &ColumnInfo) -> bool {
    source.data_type != target.data_type
        || source.is_nullable != target.is_nullable
        || source.is_auto_increment != target.is_auto_increment
        || source.default_value != target.default_value
        || source.comment != target.comment
}

fn index_structure_changed(source: &IndexInfo, target: &IndexInfo) -> bool {
    source.name != target.name
        || source.columns != target.columns
        || source.is_unique != target.is_unique
        || source.is_primary != target.is_primary
        || source.index_type != target.index_type
        || source.definition != target.definition
}

fn relation_map(relations: &[SchemaRelationSnapshot]) -> BTreeMap<String, &SchemaRelationSnapshot> {
    relations
        .iter()
        .map(|relation| (relation.name.clone(), relation))
        .collect()
}

fn snapshot_fingerprint(snapshot: &SchemaSnapshot) -> Result<String> {
    // Stored v1 snapshots did not include routines or descriptor-only schema
    // objects. Keep their established fingerprint shape when both are absent.
    let payload = if snapshot.routines.is_empty() && snapshot.schema_objects.is_empty() {
        serde_json::to_vec(&(
            snapshot.version,
            &snapshot.driver,
            &snapshot.database_name,
            &snapshot.schema_name,
            &snapshot.relations,
        ))?
    } else {
        serde_json::to_vec(&(
            snapshot.version,
            &snapshot.driver,
            &snapshot.database_name,
            &snapshot.schema_name,
            &snapshot.relations,
            &snapshot.routines,
            &snapshot.schema_objects,
        ))?
    };
    Ok(hex_digest(&payload))
}

fn routine_sort_key(routine: &SchemaRoutineSnapshot) -> String {
    format!(
        "{}:{}:{}:{}",
        routine.routine_type.as_deref().unwrap_or_default(),
        routine.name,
        routine
            .parameters
            .iter()
            .map(|parameter| format!(
                "{}:{}:{}",
                parameter.name, parameter.data_type, parameter.optional
            ))
            .collect::<Vec<_>>()
            .join(","),
        routine.return_type,
    )
}

fn schema_object_sort_key(object: &SchemaObjectSnapshot) -> String {
    format!(
        "{}:{}:{}:{}",
        object.object_type,
        object.name,
        object.parent_name.as_deref().unwrap_or_default(),
        object.description.as_deref().unwrap_or_default(),
    )
}

#[allow(clippy::too_many_arguments)]
fn change(
    kind: SchemaChangeKind,
    risk: SchemaChangeRisk,
    schema_name: &str,
    relation_name: &str,
    object_type: Option<String>,
    child_name: Option<String>,
    summary: String,
    sql: Vec<String>,
    reversible: bool,
    manual_review: bool,
) -> SchemaChange {
    let id = stable_id(
        "schema-change",
        &format!(
            "{kind:?}:{schema_name}:{relation_name}:{}:{summary}",
            child_name.as_deref().unwrap_or("")
        ),
    );
    SchemaChange {
        id,
        kind,
        risk,
        schema_name: schema_name.to_string(),
        relation_name: relation_name.to_string(),
        object_type,
        child_name,
        summary,
        sql,
        reversible,
        manual_review,
        phase: phase_for_kind(kind),
        order: 0,
        depends_on: Vec::new(),
        blocked_reason: None,
    }
}

fn phase_for_kind(kind: SchemaChangeKind) -> SchemaChangePhase {
    match kind {
        SchemaChangeKind::ConstraintDrop | SchemaChangeKind::IndexDrop => {
            SchemaChangePhase::DropDependencies
        }
        SchemaChangeKind::RelationDrop => SchemaChangePhase::DropRelations,
        SchemaChangeKind::RelationCreate => SchemaChangePhase::CreateRelations,
        SchemaChangeKind::ColumnAdd
        | SchemaChangeKind::ColumnDrop
        | SchemaChangeKind::ColumnModify
        | SchemaChangeKind::RelationModify
        | SchemaChangeKind::ConstraintModify
        | SchemaChangeKind::IndexModify => SchemaChangePhase::AlterRelations,
        SchemaChangeKind::ConstraintAdd | SchemaChangeKind::IndexAdd => {
            SchemaChangePhase::CreateDependencies
        }
        SchemaChangeKind::RoutineCreate
        | SchemaChangeKind::RoutineDrop
        | SchemaChangeKind::RoutineModify
        | SchemaChangeKind::SchemaObjectCreate
        | SchemaChangeKind::SchemaObjectDrop
        | SchemaChangeKind::SchemaObjectModify => SchemaChangePhase::ManualReview,
    }
}

fn finalize_change_plan(
    kind: DatabaseKind,
    source: &SchemaSnapshot,
    target: &SchemaSnapshot,
    mut changes: Vec<SchemaChange>,
    warnings: &mut Vec<String>,
) -> (Vec<SchemaChange>, Vec<SchemaPreflightCheck>) {
    for change in &mut changes {
        if change.sql.is_empty() && change.blocked_reason.is_none() {
            change.blocked_reason =
                Some("No complete executable definition is available for this change.".to_string());
        }
    }

    let relation_creates = change_id_map(&changes, SchemaChangeKind::RelationCreate);
    let constraint_drops = child_change_id_map(&changes, SchemaChangeKind::ConstraintDrop);
    let index_drops = child_change_id_map(&changes, SchemaChangeKind::IndexDrop);
    let column_adds = child_change_id_map(&changes, SchemaChangeKind::ColumnAdd);

    for change in &mut changes {
        let mut dependencies = Vec::new();
        match change.kind {
            SchemaChangeKind::RelationDrop => {
                let mut unresolved = Vec::new();
                for relation in &target.relations {
                    for constraint in relation
                        .constraints
                        .iter()
                        .filter(|constraint| is_foreign_constraint(constraint))
                    {
                        let references_target = constraint.referenced_table.as_deref()
                            == Some(change.relation_name.as_str())
                            && constraint
                                .referenced_schema
                                .as_deref()
                                .is_none_or(|schema| schema == target.schema_name);
                        let belongs_to_target = relation.name == change.relation_name;
                        if references_target || belongs_to_target {
                            let dependency =
                                constraint_drops.get(&child_key(&relation.name, &constraint.name));
                            if dependency.is_none() {
                                unresolved.push(format!("{}.{}", relation.name, constraint.name));
                            }
                            add_dependency(&mut dependencies, dependency);
                        }
                    }
                }
                if !unresolved.is_empty() {
                    block_change(
                        change,
                        format!(
                            "Foreign keys must be removed before this relation: {}.",
                            unresolved.join(", ")
                        ),
                        warnings,
                    );
                }
            }
            SchemaChangeKind::ColumnDrop => {
                if let Some(column_name) = change.child_name.as_deref() {
                    if let Some(relation) = relation_by_name(target, &change.relation_name) {
                        let mut unresolved = Vec::new();
                        for constraint in relation.constraints.iter().filter(|constraint| {
                            constraint
                                .columns
                                .iter()
                                .any(|column| column == column_name)
                        }) {
                            let dependency =
                                constraint_drops.get(&child_key(&relation.name, &constraint.name));
                            if dependency.is_none() {
                                unresolved.push(constraint.name.clone());
                            }
                            add_dependency(&mut dependencies, dependency);
                        }
                        let constraint_names = relation
                            .constraints
                            .iter()
                            .map(|constraint| constraint.name.as_str())
                            .collect::<std::collections::HashSet<_>>();
                        for index in relation.indexes.iter().filter(|index| {
                            !index.is_primary
                                && !constraint_names.contains(index.name.as_str())
                                && index.columns.iter().any(|column| column == column_name)
                        }) {
                            let dependency =
                                index_drops.get(&child_key(&relation.name, &index.name));
                            if dependency.is_none() {
                                unresolved.push(index.name.clone());
                            }
                            add_dependency(&mut dependencies, dependency);
                        }
                        if !unresolved.is_empty() {
                            block_change(
                                change,
                                format!(
                                    "Dependent objects must be removed before this column: {}.",
                                    unresolved.join(", ")
                                ),
                                warnings,
                            );
                        }
                    }
                }
            }
            SchemaChangeKind::ColumnModify => {
                if let Some(column_name) = change.child_name.as_deref() {
                    let source_column = column_by_name(source, &change.relation_name, column_name);
                    let target_column = column_by_name(target, &change.relation_name, column_name);
                    if source_column
                        .zip(target_column)
                        .is_some_and(|(source, target)| source.data_type != target.data_type)
                    {
                        let mut unsupported_dependencies = Vec::new();
                        if let Some(relation) = relation_by_name(target, &change.relation_name) {
                            for constraint in relation.constraints.iter().filter(|constraint| {
                                constraint
                                    .columns
                                    .iter()
                                    .any(|column| column == column_name)
                            }) {
                                let dependency = constraint_drops
                                    .get(&child_key(&relation.name, &constraint.name));
                                if dependency.is_none() {
                                    unsupported_dependencies.push(constraint.name.clone());
                                }
                                add_dependency(&mut dependencies, dependency);
                            }
                            let constraint_names = relation
                                .constraints
                                .iter()
                                .map(|constraint| constraint.name.as_str())
                                .collect::<std::collections::HashSet<_>>();
                            for index in relation.indexes.iter().filter(|index| {
                                !index.is_primary
                                    && !constraint_names.contains(index.name.as_str())
                                    && index.columns.iter().any(|column| column == column_name)
                            }) {
                                let dependency =
                                    index_drops.get(&child_key(&relation.name, &index.name));
                                if dependency.is_none() {
                                    unsupported_dependencies.push(index.name.clone());
                                }
                                add_dependency(&mut dependencies, dependency);
                            }
                        }
                        if !unsupported_dependencies.is_empty() {
                            let reason = format!(
                                "Type change depends on unchanged objects that require an explicit rebuild: {}.",
                                unsupported_dependencies.join(", ")
                            );
                            warnings.push(format!(
                                "{}.{}: {reason}",
                                change.relation_name, column_name
                            ));
                            change.blocked_reason = Some(reason);
                            change.sql.clear();
                            change.manual_review = true;
                        }
                    }
                }
            }
            SchemaChangeKind::ConstraintAdd => {
                add_dependency(
                    &mut dependencies,
                    relation_creates.get(&change.relation_name),
                );
                if let Some(child_name) = change.child_name.as_deref() {
                    add_dependency(
                        &mut dependencies,
                        constraint_drops.get(&child_key(&change.relation_name, child_name)),
                    );
                    if let Some(constraint) =
                        constraint_by_name(source, &change.relation_name, child_name)
                    {
                        if let Some(referenced_table) = constraint.referenced_table.as_deref() {
                            if constraint
                                .referenced_schema
                                .as_deref()
                                .is_none_or(|schema| schema == source.schema_name)
                            {
                                add_dependency(
                                    &mut dependencies,
                                    relation_creates.get(referenced_table),
                                );
                            }
                        }
                        for column in &constraint.columns {
                            add_dependency(
                                &mut dependencies,
                                column_adds.get(&child_key(&change.relation_name, column)),
                            );
                        }
                    }
                }
            }
            SchemaChangeKind::IndexAdd => {
                add_dependency(
                    &mut dependencies,
                    relation_creates.get(&change.relation_name),
                );
                if let Some(child_name) = change.child_name.as_deref() {
                    add_dependency(
                        &mut dependencies,
                        index_drops.get(&child_key(&change.relation_name, child_name)),
                    );
                    if let Some(index) = index_by_name(source, &change.relation_name, child_name) {
                        for column in &index.columns {
                            add_dependency(
                                &mut dependencies,
                                column_adds.get(&child_key(&change.relation_name, column)),
                            );
                        }
                    }
                }
            }
            _ => {}
        }
        dependencies.sort();
        dependencies.dedup();
        change.depends_on = dependencies;
    }

    propagate_blocked_dependencies(&mut changes, warnings);
    let mut changes = topologically_order_changes(changes, warnings);
    for (index, change) in changes.iter_mut().enumerate() {
        change.order = index + 1;
        if change.blocked_reason.is_some() {
            change.phase = SchemaChangePhase::ManualReview;
        }
    }
    let preflight_checks = build_preflight_checks(kind, source, target, &changes);
    (changes, preflight_checks)
}

fn change_id_map(changes: &[SchemaChange], kind: SchemaChangeKind) -> BTreeMap<String, String> {
    changes
        .iter()
        .filter(|change| change.kind == kind)
        .map(|change| (change.relation_name.clone(), change.id.clone()))
        .collect()
}

fn child_change_id_map(
    changes: &[SchemaChange],
    kind: SchemaChangeKind,
) -> BTreeMap<String, String> {
    changes
        .iter()
        .filter(|change| change.kind == kind)
        .filter_map(|change| {
            change.child_name.as_deref().map(|child_name| {
                (
                    child_key(&change.relation_name, child_name),
                    change.id.clone(),
                )
            })
        })
        .collect()
}

fn child_key(relation_name: &str, child_name: &str) -> String {
    format!("{relation_name}\0{child_name}")
}

fn add_dependency(dependencies: &mut Vec<String>, dependency: Option<&String>) {
    if let Some(dependency) = dependency {
        dependencies.push(dependency.clone());
    }
}

fn block_change(change: &mut SchemaChange, reason: String, warnings: &mut Vec<String>) {
    warnings.push(format!("{}: {reason}", change.summary));
    change.blocked_reason = Some(reason);
    change.sql.clear();
    change.manual_review = true;
}

fn relation_by_name<'a>(
    snapshot: &'a SchemaSnapshot,
    relation_name: &str,
) -> Option<&'a SchemaRelationSnapshot> {
    snapshot
        .relations
        .iter()
        .find(|relation| relation.name == relation_name)
}

fn column_by_name<'a>(
    snapshot: &'a SchemaSnapshot,
    relation_name: &str,
    column_name: &str,
) -> Option<&'a ColumnInfo> {
    relation_by_name(snapshot, relation_name)?
        .columns
        .iter()
        .find(|column| column.name == column_name)
}

fn constraint_by_name<'a>(
    snapshot: &'a SchemaSnapshot,
    relation_name: &str,
    constraint_name: &str,
) -> Option<&'a ConstraintInfo> {
    relation_by_name(snapshot, relation_name)?
        .constraints
        .iter()
        .find(|constraint| constraint.name == constraint_name)
}

fn index_by_name<'a>(
    snapshot: &'a SchemaSnapshot,
    relation_name: &str,
    index_name: &str,
) -> Option<&'a IndexInfo> {
    relation_by_name(snapshot, relation_name)?
        .indexes
        .iter()
        .find(|index| index.name == index_name)
}

fn propagate_blocked_dependencies(changes: &mut [SchemaChange], warnings: &mut Vec<String>) {
    loop {
        let blocked_ids = changes
            .iter()
            .filter(|change| change.blocked_reason.is_some())
            .map(|change| change.id.as_str())
            .collect::<std::collections::HashSet<_>>();
        let mut next_blocked = Vec::new();
        for (index, change) in changes.iter().enumerate() {
            if change.blocked_reason.is_none()
                && change
                    .depends_on
                    .iter()
                    .any(|dependency| blocked_ids.contains(dependency.as_str()))
            {
                next_blocked.push(index);
            }
        }
        if next_blocked.is_empty() {
            break;
        }
        for index in next_blocked {
            let change = &mut changes[index];
            let reason =
                "A required predecessor is blocked and must be resolved first.".to_string();
            warnings.push(format!("{}: {reason}", change.summary));
            change.blocked_reason = Some(reason);
            change.sql.clear();
            change.manual_review = true;
        }
    }
}

fn topologically_order_changes(
    changes: Vec<SchemaChange>,
    warnings: &mut Vec<String>,
) -> Vec<SchemaChange> {
    let mut changes_by_id = changes
        .into_iter()
        .map(|change| (change.id.clone(), change))
        .collect::<BTreeMap<_, _>>();
    let known_ids = changes_by_id
        .keys()
        .cloned()
        .collect::<std::collections::HashSet<_>>();
    let mut indegrees = BTreeMap::<String, usize>::new();
    let mut dependents = BTreeMap::<String, Vec<String>>::new();
    for change in changes_by_id.values() {
        let dependencies = change
            .depends_on
            .iter()
            .filter(|dependency| known_ids.contains(*dependency))
            .collect::<Vec<_>>();
        indegrees.insert(change.id.clone(), dependencies.len());
        for dependency in dependencies {
            dependents
                .entry(dependency.clone())
                .or_default()
                .push(change.id.clone());
        }
    }

    let mut ready = changes_by_id
        .values()
        .filter(|change| indegrees.get(&change.id).copied().unwrap_or(0) == 0)
        .map(owned_change_sort_key)
        .collect::<BTreeSet<_>>();
    let mut ordered = Vec::with_capacity(changes_by_id.len());
    while let Some(key) = ready.pop_first() {
        let id = key.4;
        let Some(change) = changes_by_id.remove(&id) else {
            continue;
        };
        if let Some(children) = dependents.get(&id) {
            for child_id in children {
                let Some(indegree) = indegrees.get_mut(child_id) else {
                    continue;
                };
                *indegree = indegree.saturating_sub(1);
                if *indegree == 0 {
                    if let Some(child) = changes_by_id.get(child_id) {
                        ready.insert(owned_change_sort_key(child));
                    }
                }
            }
        }
        ordered.push(change);
    }

    if !changes_by_id.is_empty() {
        warnings.push(
            "Migration dependency cycle detected; remaining changes require manual ordering."
                .to_string(),
        );
        let mut remaining = changes_by_id.into_values().collect::<Vec<_>>();
        remaining.sort_by_key(owned_change_sort_key);
        for mut change in remaining {
            change.blocked_reason = Some(
                "Dependency cycle requires manual ordering before SQL can be generated."
                    .to_string(),
            );
            change.sql.clear();
            change.manual_review = true;
            ordered.push(change);
        }
    }
    ordered
}

fn owned_change_sort_key(
    change: &SchemaChange,
) -> (SchemaChangePhase, String, String, SchemaChangeKind, String) {
    (
        change.phase,
        change.relation_name.clone(),
        change.child_name.clone().unwrap_or_default(),
        change.kind,
        change.id.clone(),
    )
}

fn build_preflight_checks(
    kind: DatabaseKind,
    source: &SchemaSnapshot,
    target: &SchemaSnapshot,
    changes: &[SchemaChange],
) -> Vec<SchemaPreflightCheck> {
    let mut checks = Vec::new();
    let created_relations = changes
        .iter()
        .filter(|change| change.kind == SchemaChangeKind::RelationCreate)
        .map(|change| change.relation_name.as_str())
        .collect::<std::collections::HashSet<_>>();
    for change in changes {
        let relation = kind.qualified_table(Some(&target.schema_name), &change.relation_name);
        match change.kind {
            SchemaChangeKind::RelationDrop => checks.push(preflight_check(
                change,
                "Count rows before relation drop",
                format!("SELECT COUNT(*) AS affected_rows FROM {relation};"),
                "Review affected_rows and confirm that backups or rollback procedures exist.",
                SchemaPreflightAssertion::Advisory,
                Some("affected_rows"),
            )),
            SchemaChangeKind::ColumnDrop => {
                if let Some(column_name) = change.child_name.as_deref() {
                    let column = kind.quote_identifier(column_name);
                    checks.push(preflight_check(
                        change,
                        "Count populated values before column drop",
                        format!(
                            "SELECT COUNT(*) AS populated_rows FROM {relation} WHERE {column} IS NOT NULL;"
                        ),
                        "Review populated_rows; any value greater than zero represents data loss.",
                        SchemaPreflightAssertion::Advisory,
                        Some("populated_rows"),
                    ));
                }
            }
            SchemaChangeKind::ColumnAdd => {
                if let Some(column_name) = change.child_name.as_deref() {
                    if column_by_name(source, &change.relation_name, column_name)
                        .is_some_and(|column| !column.is_nullable && column.default_value.is_none())
                    {
                        checks.push(preflight_check(
                            change,
                            "Verify table is empty before adding required column",
                            format!("SELECT COUNT(*) AS blocking_rows FROM {relation};"),
                            "blocking_rows must be 0 unless a backfill/default strategy is added.",
                            SchemaPreflightAssertion::ZeroValue,
                            Some("blocking_rows"),
                        ));
                    }
                }
            }
            SchemaChangeKind::ColumnModify => {
                if let Some(column_name) = change.child_name.as_deref() {
                    let source_column = column_by_name(source, &change.relation_name, column_name);
                    let target_column = column_by_name(target, &change.relation_name, column_name);
                    if source_column
                        .zip(target_column)
                        .is_some_and(|(source, target)| !source.is_nullable && target.is_nullable)
                    {
                        let column = kind.quote_identifier(column_name);
                        checks.push(preflight_check(
                            change,
                            "Verify nullable values before SET NOT NULL",
                            format!(
                                "SELECT COUNT(*) AS blocking_rows FROM {relation} WHERE {column} IS NULL;"
                            ),
                            "blocking_rows must be 0.",
                            SchemaPreflightAssertion::ZeroValue,
                            Some("blocking_rows"),
                        ));
                    }
                }
            }
            SchemaChangeKind::ConstraintAdd => {
                if let Some(constraint_name) = change.child_name.as_deref() {
                    if let Some(constraint) =
                        constraint_by_name(source, &change.relation_name, constraint_name)
                    {
                        let normalized = constraint.constraint_type.to_ascii_uppercase();
                        if normalized.contains("UNIQUE") && !constraint.columns.is_empty() {
                            let columns = constraint
                                .columns
                                .iter()
                                .map(|column| kind.quote_identifier(column))
                                .collect::<Vec<_>>()
                                .join(", ");
                            let non_null = constraint
                                .columns
                                .iter()
                                .map(|column| {
                                    format!("{} IS NOT NULL", kind.quote_identifier(column))
                                })
                                .collect::<Vec<_>>()
                                .join(" AND ");
                            let nulls_not_distinct =
                                constraint.definition.as_deref().is_some_and(|definition| {
                                    definition
                                        .to_ascii_uppercase()
                                        .contains("NULLS NOT DISTINCT")
                                });
                            let where_clause = if nulls_not_distinct {
                                String::new()
                            } else {
                                format!(" WHERE {non_null}")
                            };
                            checks.push(preflight_check(
                                change,
                                "Find duplicate keys before UNIQUE constraint",
                                format!(
                                    "SELECT {columns}, COUNT(*) AS duplicate_count FROM {relation}{where_clause} GROUP BY {columns} HAVING COUNT(*) > 1 LIMIT 50;"
                                ),
                                "The query must return no rows.",
                                SchemaPreflightAssertion::EmptyRows,
                                None,
                            ));
                        } else if is_foreign_constraint(constraint) {
                            let depends_on_new_relation = created_relations
                                .contains(change.relation_name.as_str())
                                || constraint
                                    .referenced_table
                                    .as_deref()
                                    .is_some_and(|table| created_relations.contains(table));
                            if depends_on_new_relation {
                                continue;
                            }
                            if let Some(sql) = foreign_key_preflight_sql(
                                kind,
                                &target.schema_name,
                                &change.relation_name,
                                constraint,
                            ) {
                                checks.push(preflight_check(
                                    change,
                                    "Find orphan rows before FOREIGN KEY",
                                    sql,
                                    "blocking_rows must be 0.",
                                    SchemaPreflightAssertion::ZeroValue,
                                    Some("blocking_rows"),
                                ));
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }
    checks
}

fn foreign_key_preflight_sql(
    kind: DatabaseKind,
    target_schema: &str,
    relation_name: &str,
    constraint: &ConstraintInfo,
) -> Option<String> {
    let referenced_table = constraint.referenced_table.as_deref()?;
    if constraint.columns.is_empty()
        || constraint.columns.len() != constraint.referenced_columns.len()
    {
        return None;
    }
    let local_relation = kind.qualified_table(Some(target_schema), relation_name);
    let referenced_relation = kind.qualified_table(
        constraint
            .referenced_schema
            .as_deref()
            .or(Some(target_schema)),
        referenced_table,
    );
    let local_not_null = constraint
        .columns
        .iter()
        .map(|column| format!("child.{} IS NOT NULL", kind.quote_identifier(column)))
        .collect::<Vec<_>>()
        .join(" AND ");
    let joins = constraint
        .columns
        .iter()
        .zip(&constraint.referenced_columns)
        .map(|(local, referenced)| {
            format!(
                "parent.{} = child.{}",
                kind.quote_identifier(referenced),
                kind.quote_identifier(local)
            )
        })
        .collect::<Vec<_>>()
        .join(" AND ");
    Some(format!(
        "SELECT COUNT(*) AS blocking_rows FROM {local_relation} AS child WHERE {local_not_null} AND NOT EXISTS (SELECT 1 FROM {referenced_relation} AS parent WHERE {joins});"
    ))
}

fn preflight_check(
    change: &SchemaChange,
    label: &str,
    sql: String,
    expectation: &str,
    assertion: SchemaPreflightAssertion,
    result_column: Option<&str>,
) -> SchemaPreflightCheck {
    SchemaPreflightCheck {
        id: stable_id("schema-preflight", &format!("{}:{label}", change.id)),
        change_id: change.id.clone(),
        label: label.to_string(),
        sql,
        expectation: expectation.to_string(),
        assertion,
        result_column: result_column.map(ToString::to_string),
    }
}

fn summarize_changes(changes: &[SchemaChange]) -> SchemaDiffSummary {
    SchemaDiffSummary {
        total: changes.len(),
        safe: changes
            .iter()
            .filter(|change| change.risk == SchemaChangeRisk::Safe)
            .count(),
        review: changes
            .iter()
            .filter(|change| change.risk == SchemaChangeRisk::Review)
            .count(),
        destructive: changes
            .iter()
            .filter(|change| change.risk == SchemaChangeRisk::Destructive)
            .count(),
        blocked: changes
            .iter()
            .filter(|change| change.blocked_reason.is_some())
            .count(),
    }
}

fn render_migration_sql(
    kind: DatabaseKind,
    source: &SchemaSnapshot,
    target: &SchemaSnapshot,
    changes: &[SchemaChange],
    warnings: &[String],
) -> String {
    let mut lines = vec![
        "-- OxideStudio schema migration preview".to_string(),
        format!(
            "-- Desired source: {} / {}",
            source.connection_name, source.schema_name
        ),
        format!(
            "-- Actual target: {} / {}",
            target.connection_name, target.schema_name
        ),
        "-- Generated only for review; nothing has been executed.".to_string(),
    ];
    if kind == DatabaseKind::Mysql {
        lines.push(
            "-- MySQL DDL may auto-commit; review every statement before running.".to_string(),
        );
    }
    for warning in warnings {
        lines.push(format!("-- WARNING: {warning}"));
    }
    let blocked_count = changes
        .iter()
        .filter(|change| change.blocked_reason.is_some())
        .count();
    if blocked_count > 0 {
        lines.push(format!(
            "-- PLAN BLOCKED: {blocked_count} change(s) require resolution; do not execute this script as a migration."
        ));
    }
    lines.push(String::new());
    if kind == DatabaseKind::Postgres && !changes.is_empty() {
        lines.push("BEGIN;".to_string());
        lines.push(String::new());
    }
    if changes.is_empty() {
        lines.push("-- No schema differences detected.".to_string());
    }
    for change in changes {
        lines.push(format!(
            "-- Step {} · {:?} · {:?}: {}",
            change.order, change.phase, change.risk, change.summary
        ));
        if !change.depends_on.is_empty() {
            lines.push(format!("-- Depends on: {}", change.depends_on.join(", ")));
        }
        if let Some(reason) = change.blocked_reason.as_deref() {
            lines.push(format!("-- BLOCKED: {reason}"));
        }
        if change.sql.is_empty() {
            lines.push("-- MANUAL REVIEW REQUIRED: no safe SQL was generated.".to_string());
        } else {
            lines.extend(change.sql.iter().cloned());
        }
        lines.push(String::new());
    }
    if kind == DatabaseKind::Postgres && !changes.is_empty() {
        lines.push("-- Replace ROLLBACK with COMMIT only after review and validation.".to_string());
        lines.push("ROLLBACK;".to_string());
    }
    lines.join("\n")
}

fn render_preflight_sql(
    source: &SchemaSnapshot,
    target: &SchemaSnapshot,
    checks: &[SchemaPreflightCheck],
) -> String {
    let mut lines = vec![
        "-- OxideStudio schema migration preflight".to_string(),
        format!(
            "-- Desired source: {} / {}",
            source.connection_name, source.schema_name
        ),
        format!(
            "-- Actual target: {} / {}",
            target.connection_name, target.schema_name
        ),
        "-- Read-only checks only; inspect every expectation before migration execution."
            .to_string(),
        String::new(),
    ];
    if checks.is_empty() {
        lines.push("-- No generated preflight checks for this plan.".to_string());
    }
    for (index, check) in checks.iter().enumerate() {
        lines.push(format!("-- Check {}: {}", index + 1, check.label));
        lines.push(format!("-- Expectation: {}", check.expectation));
        lines.push(check.sql.clone());
        lines.push(String::new());
    }
    lines.join("\n")
}

#[derive(Default)]
struct RelationFlags {
    is_view: bool,
    is_materialized_view: bool,
    is_foreign_table: bool,
}

fn relation_flags(object_type: Option<&str>) -> RelationFlags {
    let normalized = object_type.unwrap_or("").trim().to_ascii_uppercase();
    RelationFlags {
        is_view: normalized.contains("VIEW"),
        is_materialized_view: normalized.contains("MATERIALIZED"),
        is_foreign_table: normalized.contains("FOREIGN"),
    }
}

fn stable_id(prefix: &str, value: &str) -> String {
    format!("{prefix}-{}", &hex_digest(value.as_bytes())[..16])
}

fn hex_digest(value: &[u8]) -> String {
    let digest = Sha256::digest(value);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn sql_string_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn table_comment_sql(
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

#[cfg(test)]
mod tests {
    use super::*;

    fn column(name: &str, data_type: &str, nullable: bool) -> ColumnInfo {
        ColumnInfo {
            name: name.to_string(),
            data_type: data_type.to_string(),
            is_nullable: nullable,
            is_primary_key: name == "id",
            is_unique: name == "id",
            is_indexed: name == "id",
            is_auto_increment: name == "id",
            default_value: None,
            comment: None,
            is_generated: Some(false),
            is_hidden: Some(false),
        }
    }

    fn snapshot(id: &str, columns: Vec<ColumnInfo>) -> SchemaSnapshot {
        finalize_schema_snapshot(SchemaSnapshot {
            version: SCHEMA_SNAPSHOT_VERSION,
            id: id.to_string(),
            fingerprint: String::new(),
            project_id: "project-1".to_string(),
            connection_id: "connection-1".to_string(),
            connection_name: "Local".to_string(),
            driver: "postgres".to_string(),
            database_name: Some("app".to_string()),
            schema_name: "public".to_string(),
            captured_at: 1,
            relations: vec![SchemaRelationSnapshot {
                name: "users".to_string(),
                object_type: Some("BASE TABLE".to_string()),
                comment: None,
                columns,
                indexes: Vec::new(),
                constraints: Vec::new(),
            }],
            routines: Vec::new(),
            schema_objects: Vec::new(),
            warnings: Vec::new(),
        })
        .unwrap()
    }

    fn routine(name: &str, return_type: &str) -> SchemaRoutineSnapshot {
        SchemaRoutineSnapshot {
            name: name.to_string(),
            routine_type: Some("FUNCTION".to_string()),
            parameters: vec![FunctionParameterInfo {
                name: "input".to_string(),
                data_type: "text".to_string(),
                optional: false,
            }],
            return_type: return_type.to_string(),
            description: None,
        }
    }

    fn constraint(name: &str, constraint_type: &str, columns: &[&str]) -> ConstraintInfo {
        ConstraintInfo {
            name: name.to_string(),
            constraint_type: constraint_type.to_string(),
            columns: columns.iter().map(|value| (*value).to_string()).collect(),
            referenced_schema: None,
            referenced_table: None,
            referenced_columns: Vec::new(),
            definition: None,
        }
    }

    fn index(name: &str, columns: &[&str], index_type: &str) -> IndexInfo {
        IndexInfo {
            name: name.to_string(),
            columns: columns.iter().map(|value| (*value).to_string()).collect(),
            is_unique: false,
            is_primary: false,
            index_type: Some(index_type.to_string()),
            definition: None,
            comment: None,
        }
    }

    #[test]
    fn index_comment_change_is_review_only_and_never_rebuilds_the_index() {
        let mut source = snapshot("desired", vec![column("id", "bigint", false)]);
        let mut target = snapshot("actual", vec![column("id", "bigint", false)]);
        source.relations[0]
            .indexes
            .push(index("users_id_idx", &["id"], "btree"));
        target.relations[0]
            .indexes
            .push(index("users_id_idx", &["id"], "btree"));
        source.relations[0].indexes[0].comment = Some("lookup path".to_string());
        source = finalize_schema_snapshot(source).unwrap();
        target = finalize_schema_snapshot(target).unwrap();

        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

        let change = plan
            .changes
            .iter()
            .find(|change| change.kind == SchemaChangeKind::IndexModify)
            .expect("index comment change");
        assert!(change.sql.is_empty());
        assert!(change.manual_review);
        assert_eq!(change.phase, SchemaChangePhase::ManualReview);
        assert!(change.blocked_reason.is_some());
        assert!(!plan.migration_sql.contains("DROP INDEX"));
        assert!(!plan.migration_sql.contains("CREATE INDEX"));
    }

    #[test]
    fn table_comment_changes_use_semantic_postgres_ddl() {
        let mut source = snapshot("desired", vec![column("id", "bigint", false)]);
        let target = snapshot("actual", vec![column("id", "bigint", false)]);
        source.relations[0].comment = Some("Owner's audit table".to_string());
        source = finalize_schema_snapshot(source).unwrap();

        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
        let change = plan
            .changes
            .iter()
            .find(|change| {
                change.kind == SchemaChangeKind::RelationModify
                    && change.summary.contains("table comment")
            })
            .expect("table comment change");

        assert_eq!(change.risk, SchemaChangeRisk::Safe);
        assert!(!change.manual_review);
        assert_eq!(
            change.sql,
            vec!["COMMENT ON TABLE \"public\".\"users\" IS 'Owner''s audit table';"]
        );
    }

    #[test]
    fn created_mysql_tables_restore_comments_after_creation() {
        let mut source = snapshot("desired", vec![column("id", "bigint", false)]);
        source.driver = "mysql".to_string();
        source.schema_name = "app".to_string();
        source.relations[0].comment = Some("audit trail".to_string());
        source = finalize_schema_snapshot(source).unwrap();
        let mut target = source.clone();
        target.id = "actual".to_string();
        target.relations.clear();
        target = finalize_schema_snapshot(target).unwrap();

        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

        assert!(plan
            .migration_sql
            .contains("ALTER TABLE `app`.`users` COMMENT = 'audit trail';"));
    }

    #[test]
    fn fingerprint_is_stable_after_relation_sorting() {
        let mut first = snapshot("first", vec![column("id", "int4", false)]);
        first.relations.push(SchemaRelationSnapshot {
            name: "accounts".to_string(),
            object_type: Some("BASE TABLE".to_string()),
            comment: None,
            columns: vec![column("id", "int4", false)],
            indexes: Vec::new(),
            constraints: Vec::new(),
        });
        let first = finalize_schema_snapshot(first).unwrap();
        let mut second = first.clone();
        second.id = "second".to_string();
        second.relations.reverse();
        let second = finalize_schema_snapshot(second).unwrap();
        assert_eq!(first.fingerprint, second.fingerprint);
    }

    #[test]
    fn routine_signatures_change_the_snapshot_fingerprint() {
        let legacy = snapshot("legacy", vec![column("id", "int4", false)]);
        let mut with_routine = legacy.clone();
        with_routine.id = "with-routine".to_string();
        with_routine.routines = vec![routine("normalize_email", "text")];
        let with_routine = finalize_schema_snapshot(with_routine).unwrap();

        assert_ne!(legacy.fingerprint, with_routine.fingerprint);
    }

    #[test]
    fn generated_and_hidden_classification_changes_the_snapshot_fingerprint() {
        let ordinary = snapshot("ordinary", vec![column("total", "numeric", true)]);
        let mut generated_column = column("total", "numeric", true);
        generated_column.is_generated = Some(true);
        let generated = snapshot("generated", vec![generated_column]);
        let mut hidden_column = column("total", "numeric", true);
        hidden_column.is_hidden = Some(true);
        let hidden = snapshot("hidden", vec![hidden_column]);

        assert_ne!(ordinary.fingerprint, generated.fingerprint);
        assert_ne!(ordinary.fingerprint, hidden.fingerprint);
        assert_ne!(generated.fingerprint, hidden.fingerprint);
    }

    #[test]
    fn generated_or_unknown_column_ddl_is_review_only_without_partial_sql() {
        for classification in [Some(true), None] {
            let mut owned = column("computed_total", "numeric", true);
            owned.is_generated = classification;
            let source = snapshot("desired", vec![owned]);
            let target = snapshot("actual", Vec::new());

            let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
            let change = plan
                .changes
                .iter()
                .find(|change| change.kind == SchemaChangeKind::ColumnAdd)
                .unwrap();
            assert!(change.manual_review);
            assert!(change.sql.is_empty());
            assert!(change.blocked_reason.is_some());
        }
    }

    #[test]
    fn generated_visibility_changes_do_not_emit_incomplete_alter_sql() {
        let mut generated_column = column("total", "numeric", true);
        generated_column.is_generated = Some(true);
        let source = snapshot("desired", vec![generated_column]);
        let target = snapshot("actual", vec![column("total", "numeric", true)]);

        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
        let change = plan
            .changes
            .iter()
            .find(|change| change.kind == SchemaChangeKind::ColumnModify)
            .unwrap();
        assert!(change.manual_review);
        assert!(change.sql.is_empty());
        assert!(change.blocked_reason.is_some());
    }

    #[test]
    fn routine_drift_is_review_only_and_blocks_automatic_migration() {
        let mut source = snapshot("desired", vec![column("id", "int4", false)]);
        source.routines = vec![routine("normalize_email", "text")];
        let source = finalize_schema_snapshot(source).unwrap();
        let target = snapshot("actual", vec![column("id", "int4", false)]);

        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
        let change = plan
            .changes
            .iter()
            .find(|change| change.kind == SchemaChangeKind::RoutineCreate)
            .expect("routine creation should be visible in drift review");

        assert_eq!(change.phase, SchemaChangePhase::ManualReview);
        assert_eq!(change.risk, SchemaChangeRisk::Review);
        assert!(change.manual_review);
        assert!(change.sql.is_empty());
        assert!(change.blocked_reason.is_some());
        assert_eq!(plan.summary.blocked, 1);
        assert!(plan.migration_sql.contains("MANUAL REVIEW REQUIRED"));
        assert!(plan
            .warnings
            .iter()
            .any(|warning| warning.contains("Routine signature drift")));
    }

    #[test]
    fn descriptor_object_drift_is_review_only_and_never_generates_ddl() {
        let mut source = snapshot("desired", vec![column("id", "int4", false)]);
        source.schema_objects = vec![SchemaObjectSnapshot {
            name: "orders_id_seq".to_string(),
            object_type: "sequence".to_string(),
            parent_name: Some("orders".to_string()),
            description: Some("Primary-key generator".to_string()),
        }];
        let source = finalize_schema_snapshot(source).unwrap();
        let target = snapshot("actual", vec![column("id", "int4", false)]);

        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
        let change = plan
            .changes
            .iter()
            .find(|change| change.kind == SchemaChangeKind::SchemaObjectCreate)
            .expect("schema object creation should be visible in drift review");

        assert_eq!(change.phase, SchemaChangePhase::ManualReview);
        assert_eq!(change.risk, SchemaChangeRisk::Review);
        assert!(change.manual_review);
        assert!(change.sql.is_empty());
        assert!(change.blocked_reason.is_some());
        assert_eq!(plan.summary.blocked, 1);
        assert!(plan
            .warnings
            .iter()
            .any(|warning| warning.contains("Schema object descriptor drift")));
    }

    #[test]
    fn adds_missing_nullable_column_with_safe_preview() {
        let source = snapshot(
            "desired",
            vec![
                column("id", "int4", false),
                column("nickname", "text", true),
            ],
        );
        let target = snapshot("actual", vec![column("id", "int4", false)]);
        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
        assert_eq!(plan.summary.safe, 1);
        assert_eq!(plan.summary.destructive, 0);
        assert_eq!(plan.changes[0].kind, SchemaChangeKind::ColumnAdd);
        assert!(plan
            .migration_sql
            .contains("ALTER TABLE \"public\".\"users\" ADD COLUMN \"nickname\" text;"));
        assert!(plan.migration_sql.ends_with("ROLLBACK;"));
    }

    #[test]
    fn marks_target_only_column_as_destructive() {
        let source = snapshot("desired", vec![column("id", "int4", false)]);
        let target = snapshot(
            "actual",
            vec![column("id", "int4", false), column("legacy", "text", true)],
        );
        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
        assert_eq!(plan.summary.destructive, 1);
        assert!(!plan.changes[0].reversible);
        assert!(plan.migration_sql.contains("DROP COLUMN \"legacy\""));
    }

    #[test]
    fn type_changes_require_manual_review() {
        let source = snapshot("desired", vec![column("id", "bigint", false)]);
        let target = snapshot("actual", vec![column("id", "int4", false)]);
        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
        assert_eq!(plan.changes[0].risk, SchemaChangeRisk::Destructive);
        assert!(plan.changes[0].manual_review);
        assert!(plan
            .migration_sql
            .contains("TYPE bigint USING \"id\"::bigint"));
    }

    #[test]
    fn cross_driver_comparison_is_metadata_only_and_never_generates_sql() {
        let source = snapshot("desired", vec![column("id", "bigint", false)]);
        let mut target = snapshot("actual", vec![column("id", "bigint", false)]);
        target.driver = "mysql".to_string();
        target.relations[0]
            .columns
            .push(column("legacy", "varchar", true));
        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
        assert!(!plan.transactional);
        assert!(plan
            .migration_sql
            .contains("Cross-driver metadata comparison"));
        assert!(plan.changes.iter().all(|change| change.sql.is_empty()));
        assert!(plan
            .warnings
            .iter()
            .any(|warning| warning.contains("review-only")));
    }

    #[test]
    fn postgres_cross_driver_review_lists_deterministic_lossy_mappings() {
        let mut source = snapshot(
            "desired",
            vec![
                column("id", "uuid", false),
                column("tags", "text[]", true),
                column("created_at", "timestamptz", false),
                column("status", "\"public\".\"order_state\"", false),
            ],
        );
        source.relations[0].columns[2].default_value =
            Some("now()::timestamp with time zone".to_string());
        source.relations[0].indexes.push(IndexInfo {
            name: "users_tags_gin".to_string(),
            columns: vec!["tags".to_string()],
            is_unique: false,
            is_primary: false,
            index_type: Some("gin".to_string()),
            definition: Some("CREATE INDEX users_tags_gin ON users USING gin (tags)".to_string()),
            comment: None,
        });
        source = finalize_schema_snapshot(source).unwrap();
        let mut target = snapshot("actual", vec![column("id", "char(36)", false)]);
        target.driver = "mysql".to_string();

        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

        assert!(plan.migration_sql.contains("uuid -> CHAR(36)"));
        assert!(plan.migration_sql.contains("LOSSY users.tags"));
        assert!(plan.migration_sql.contains("DATETIME(6)"));
        assert!(plan.conversion_issues.iter().any(|issue| issue.feature_kind
            == SchemaConversionFeatureKind::Default
            && issue.source_data_type.starts_with("DEFAULT ")));
        assert!(plan.conversion_issues.iter().any(|issue| issue.feature_kind
            == SchemaConversionFeatureKind::Index
            && issue.column_name == "index:users_tags_gin"
            && issue.target_data_type.as_deref() == Some("BTREE INDEX")));
        assert!(plan
            .conversion_issues
            .iter()
            .any(|issue| issue.column_name == "status"
                && issue.feature_kind == SchemaConversionFeatureKind::CustomType
                && issue.compatibility == SchemaConversionCompatibility::Unsupported));
        assert!(plan.changes.iter().all(|change| change.sql.is_empty()));
        assert!(plan
            .warnings
            .iter()
            .any(|warning| warning.contains("target-side validation is required")));
    }

    #[test]
    fn postgres_conversion_review_categorizes_extended_chartdb_mappings() {
        let mut source = snapshot(
            "desired",
            vec![
                column("event_id", "uuid", false),
                column("active_window", "int4range", true),
                column("search_vector", "tsvector", true),
                column("meeting_time", "timetz", true),
                column("sequence_id", "smallserial", false),
                column("flags", "varbit", true),
            ],
        );
        source.relations[0].columns[0].default_value = Some("gen_random_uuid()".to_string());
        source.relations[0].indexes.push(IndexInfo {
            name: "users_search_gist".to_string(),
            columns: vec!["search_vector".to_string()],
            is_unique: false,
            is_primary: false,
            index_type: Some("gist".to_string()),
            definition: Some(
                "CREATE INDEX users_search_gist ON users USING gist (search_vector)".to_string(),
            ),
            comment: None,
        });
        source = finalize_schema_snapshot(source).unwrap();
        let mut target = snapshot(
            "actual",
            vec![column("event_id", "uniqueidentifier", false)],
        );
        target.driver = "sqlserver".to_string();

        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

        assert!(plan.conversion_issues.iter().any(|issue| {
            issue.column_name == "active_window"
                && issue.feature_kind == SchemaConversionFeatureKind::Type
                && issue.target_data_type.as_deref() == Some("NVARCHAR(MAX)")
                && issue.blocks_automatic_conversion
        }));
        assert!(plan.conversion_issues.iter().any(|issue| {
            issue.column_name == "meeting_time" && issue.target_data_type.as_deref() == Some("TIME")
        }));
        assert!(plan.conversion_issues.iter().any(|issue| {
            issue.column_name == "event_id"
                && issue.feature_kind == SchemaConversionFeatureKind::Default
                && issue.target_data_type.as_deref() == Some("DEFAULT NEWID()")
                && !issue.blocks_automatic_conversion
        }));
        assert!(plan.conversion_issues.iter().any(|issue| {
            issue.column_name == "index:users_search_gist"
                && issue.feature_kind == SchemaConversionFeatureKind::Index
                && issue.target_data_type.is_none()
        }));
    }

    #[test]
    fn driver_aliases_keep_their_shared_native_migration_planner() {
        let mut source = snapshot("desired", vec![column("id", "bigint", false)]);
        let mut target = snapshot("actual", vec![column("id", "bigint", false)]);
        source.driver = "mariadb".to_string();
        target.driver = "mysql".to_string();
        target.relations.clear();
        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();
        assert_eq!(plan.driver, "mysql");
        assert!(plan.migration_sql.contains("CREATE TABLE"));
    }

    #[test]
    fn external_driver_snapshots_are_compared_as_read_only_metadata() {
        let mut source = snapshot("desired", vec![column("id", "INTEGER", false)]);
        let mut target = snapshot("actual", vec![column("id", "INTEGER", false)]);
        source.driver = "duckdb".to_string();
        target.driver = "duckdb".to_string();
        target.relations[0]
            .columns
            .push(column("legacy", "VARCHAR", true));
        source = finalize_schema_snapshot(source).unwrap();
        target = finalize_schema_snapshot(target).unwrap();

        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

        assert_eq!(plan.driver, "duckdb");
        assert!(!plan.transactional);
        assert!(plan.migration_sql.contains("Metadata-only comparison"));
        assert!(plan.changes.iter().all(|change| change.sql.is_empty()));
    }

    #[test]
    fn mysql_preview_warns_about_auto_commit_and_uses_mysql_alter_syntax() {
        let mut source = snapshot("desired", vec![column("id", "bigint", false)]);
        let mut target = snapshot("actual", vec![column("id", "int", false)]);
        source.driver = "mysql".to_string();
        target.driver = "mysql".to_string();

        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

        assert!(!plan.transactional);
        assert!(plan.id.starts_with("schema-diff-"));
        assert!(plan.migration_sql.contains("MySQL DDL may auto-commit"));
        assert!(plan
            .migration_sql
            .contains("ALTER TABLE `public`.`users` MODIFY COLUMN `id` bigint"));
        assert!(!plan.migration_sql.contains("ROLLBACK;"));
    }

    #[test]
    fn created_relation_with_foreign_key_requires_dependency_review() {
        let mut source = snapshot("desired", vec![column("id", "int4", false)]);
        source.relations[0].constraints = vec![ConstraintInfo {
            referenced_schema: Some("public".to_string()),
            referenced_table: Some("accounts".to_string()),
            referenced_columns: vec!["id".to_string()],
            ..constraint("users_account_fk", "FOREIGN KEY", &["id"])
        }];
        source.relations.push(SchemaRelationSnapshot {
            name: "accounts".to_string(),
            object_type: Some("BASE TABLE".to_string()),
            comment: None,
            columns: vec![column("id", "int4", false)],
            indexes: Vec::new(),
            constraints: Vec::new(),
        });
        source = finalize_schema_snapshot(source).unwrap();
        let mut target = snapshot("actual", vec![column("id", "int4", false)]);
        target.relations.clear();
        target = finalize_schema_snapshot(target).unwrap();

        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

        let relation_creates = plan
            .changes
            .iter()
            .filter(|change| change.kind == SchemaChangeKind::RelationCreate)
            .collect::<Vec<_>>();
        let foreign_key = plan
            .changes
            .iter()
            .find(|change| change.child_name.as_deref() == Some("users_account_fk"))
            .unwrap();
        assert_eq!(relation_creates.len(), 2);
        assert_eq!(foreign_key.kind, SchemaChangeKind::ConstraintAdd);
        assert_eq!(foreign_key.risk, SchemaChangeRisk::Review);
        assert!(foreign_key.manual_review);
        assert_eq!(foreign_key.depends_on.len(), 2);
        assert!(relation_creates
            .iter()
            .all(|create| create.order < foreign_key.order));
        assert!(plan.migration_sql.contains("FOREIGN KEY"));
    }

    #[test]
    fn changed_view_or_foreign_table_is_a_manual_artifact_without_generated_sql() {
        for object_type in ["VIEW", "FOREIGN TABLE"] {
            let mut source = snapshot("desired", vec![column("id", "int4", false)]);
            let mut target = snapshot("actual", vec![column("id", "int4", false)]);
            source.relations[0].object_type = Some(object_type.to_string());
            target.relations[0].object_type = Some(object_type.to_string());
            target.relations[0]
                .columns
                .push(column("legacy", "text", true));
            source = finalize_schema_snapshot(source).unwrap();
            target = finalize_schema_snapshot(target).unwrap();

            let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

            assert_eq!(plan.changes[0].kind, SchemaChangeKind::RelationModify);
            assert!(plan.changes[0].sql.is_empty());
            assert!(plan.changes[0].manual_review);
            assert!(plan.migration_sql.contains("MANUAL REVIEW REQUIRED"));
        }
    }

    #[test]
    fn relation_without_captured_columns_does_not_emit_invalid_create_sql() {
        let mut source = snapshot("desired", Vec::new());
        let mut target = snapshot("actual", Vec::new());
        target.relations.clear();
        source = finalize_schema_snapshot(source).unwrap();
        target = finalize_schema_snapshot(target).unwrap();

        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

        assert!(plan.changes[0].sql.is_empty());
        assert_eq!(plan.changes[0].risk, SchemaChangeRisk::Review);
        assert!(plan
            .warnings
            .iter()
            .any(|warning| warning.contains("no captured columns")));
    }

    #[test]
    fn postgres_expression_index_preserves_exact_database_definition() {
        let mut source = snapshot(
            "desired",
            vec![column("id", "int4", false), column("email", "text", true)],
        );
        source.relations[0].indexes = vec![IndexInfo {
            definition: Some(
                "CREATE INDEX users_email_lower_idx ON public.users USING btree (lower(email)) WHERE (email IS NOT NULL)"
                    .to_string(),
            ),
            ..index("users_email_lower_idx", &[], "btree")
        }];
        source = finalize_schema_snapshot(source).unwrap();
        let target = snapshot(
            "actual",
            vec![column("id", "int4", false), column("email", "text", true)],
        );

        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

        assert_eq!(plan.changes[0].risk, SchemaChangeRisk::Safe);
        assert_eq!(plan.changes[0].sql.len(), 1);
        assert!(plan.migration_sql.contains("lower(email)"));
        assert!(plan.migration_sql.contains("WHERE (email IS NOT NULL);"));
    }

    #[test]
    fn unknown_mysql_index_definition_never_emits_partial_rebuild_sql() {
        let mut mysql_source = snapshot(
            "desired",
            vec![column("id", "int4", false), column("body", "text", true)],
        );
        let mut mysql_target = snapshot(
            "actual",
            vec![column("id", "int4", false), column("body", "text", true)],
        );
        mysql_source.driver = "mysql".to_string();
        mysql_source.relations[0].indexes =
            vec![index("users_body_fulltext", &["body"], "FULLTEXT")];
        mysql_source = finalize_schema_snapshot(mysql_source).unwrap();
        mysql_target.driver = "mysql".to_string();
        mysql_target = finalize_schema_snapshot(mysql_target).unwrap();

        let mysql_plan = compare_schema_snapshots(&mysql_source, &mysql_target, 2).unwrap();
        assert_eq!(mysql_plan.changes[0].risk, SchemaChangeRisk::Review);
        assert!(mysql_plan.changes[0].sql.is_empty());
    }

    #[test]
    fn rejects_cross_schema_comparison_without_explicit_mapping() {
        let mut source = snapshot("desired", vec![column("id", "int4", false)]);
        source.schema_name = "template".to_string();
        source = finalize_schema_snapshot(source).unwrap();
        let target = snapshot("actual", vec![column("id", "int4", false)]);

        let error = compare_schema_snapshots(&source, &target, 2).unwrap_err();

        assert!(error.to_string().contains("explicit schema mapping"));
    }

    #[test]
    fn mysql_check_is_normalized_but_foreign_key_rules_are_not_guessed() {
        let mut source = snapshot(
            "desired",
            vec![column("id", "int", false), column("age", "int", true)],
        );
        source.driver = "mysql".to_string();
        source.relations[0].constraints = vec![
            ConstraintInfo {
                definition: Some("age >= 0".to_string()),
                ..constraint("users_age_check", "CHECK", &[])
            },
            ConstraintInfo {
                referenced_schema: Some("public".to_string()),
                referenced_table: Some("accounts".to_string()),
                referenced_columns: vec!["id".to_string()],
                ..constraint("users_account_fk", "FOREIGN KEY", &["id"])
            },
        ];
        source = finalize_schema_snapshot(source).unwrap();
        let mut target = snapshot(
            "actual",
            vec![column("id", "int", false), column("age", "int", true)],
        );
        target.driver = "mysql".to_string();
        target = finalize_schema_snapshot(target).unwrap();

        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

        let check = plan
            .changes
            .iter()
            .find(|change| change.child_name.as_deref() == Some("users_age_check"))
            .unwrap();
        assert!(check.sql[0].contains("CHECK (age >= 0)"));
        let foreign_key = plan
            .changes
            .iter()
            .find(|change| change.child_name.as_deref() == Some("users_account_fk"))
            .unwrap();
        assert!(foreign_key.sql.is_empty());
        assert!(foreign_key.manual_review);
    }

    #[test]
    fn target_only_relations_drop_foreign_keys_before_both_sides() {
        let mut source = snapshot("desired", vec![column("id", "int4", false)]);
        source.relations.clear();
        source = finalize_schema_snapshot(source).unwrap();

        let mut target = snapshot("actual", vec![column("id", "int4", false)]);
        target.relations[0].constraints = vec![ConstraintInfo {
            referenced_schema: Some("public".to_string()),
            referenced_table: Some("accounts".to_string()),
            referenced_columns: vec!["id".to_string()],
            ..constraint("users_account_fk", "FOREIGN KEY", &["id"])
        }];
        target.relations.push(SchemaRelationSnapshot {
            name: "accounts".to_string(),
            object_type: Some("BASE TABLE".to_string()),
            comment: None,
            columns: vec![column("id", "int4", false)],
            indexes: Vec::new(),
            constraints: Vec::new(),
        });
        target = finalize_schema_snapshot(target).unwrap();

        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

        let foreign_key_drop = plan
            .changes
            .iter()
            .find(|change| change.child_name.as_deref() == Some("users_account_fk"))
            .unwrap();
        let relation_drops = plan
            .changes
            .iter()
            .filter(|change| change.kind == SchemaChangeKind::RelationDrop)
            .collect::<Vec<_>>();
        assert_eq!(foreign_key_drop.phase, SchemaChangePhase::DropDependencies);
        assert_eq!(relation_drops.len(), 2);
        assert!(relation_drops.iter().all(|drop| {
            drop.depends_on.contains(&foreign_key_drop.id) && foreign_key_drop.order < drop.order
        }));
        assert_eq!(plan.preflight_checks.len(), 2);
    }

    #[test]
    fn preflight_covers_required_columns_not_null_and_unique_constraints() {
        let mut source = snapshot(
            "desired",
            vec![
                column("id", "int4", false),
                column("email", "text", false),
                column("tenant_id", "int4", false),
            ],
        );
        source.relations[0].constraints = vec![constraint("users_email_key", "UNIQUE", &["email"])];
        source = finalize_schema_snapshot(source).unwrap();
        let target = snapshot(
            "actual",
            vec![column("id", "int4", false), column("email", "text", true)],
        );

        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

        assert_eq!(plan.preflight_checks.len(), 3);
        assert_eq!(
            plan.preflight_checks
                .iter()
                .filter(|check| check.assertion == SchemaPreflightAssertion::ZeroValue)
                .count(),
            2
        );
        assert!(plan.preflight_checks.iter().any(|check| {
            check.assertion == SchemaPreflightAssertion::EmptyRows && check.result_column.is_none()
        }));
        assert!(plan.preflight_sql.contains("blocking_rows"));
        assert!(plan.preflight_sql.contains("IS NULL"));
        assert!(plan.preflight_sql.contains("duplicate_count"));
        assert!(plan.preflight_sql.contains("HAVING COUNT(*) > 1"));
    }

    #[test]
    fn type_change_with_unchanged_dependency_is_blocked_instead_of_half_generated() {
        let mut source = snapshot("desired", vec![column("id", "bigint", false)]);
        source.relations[0].indexes = vec![index("users_id_idx", &["id"], "btree")];
        source = finalize_schema_snapshot(source).unwrap();
        let mut target = snapshot("actual", vec![column("id", "int4", false)]);
        target.relations[0].indexes = vec![index("users_id_idx", &["id"], "btree")];
        target = finalize_schema_snapshot(target).unwrap();

        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

        let type_change = plan
            .changes
            .iter()
            .find(|change| change.kind == SchemaChangeKind::ColumnModify)
            .unwrap();
        assert!(type_change.blocked_reason.is_some());
        assert!(type_change.sql.is_empty());
        assert_eq!(type_change.phase, SchemaChangePhase::ManualReview);
        assert_eq!(plan.summary.blocked, 1);
        assert!(plan.migration_sql.contains("PLAN BLOCKED"));
        assert!(!plan.migration_sql.contains("ALTER COLUMN \"id\" TYPE"));
    }

    #[test]
    fn mongodb_snapshots_produce_metadata_only_diffs() {
        let mut source = snapshot(
            "desired",
            vec![
                column("_id", "objectId", false),
                column("email", "string", true),
            ],
        );
        source.driver = "mongodb".to_string();
        source.database_name = None;
        source.schema_name = "app".to_string();
        source.relations[0].object_type = Some("collection".to_string());
        source.relations[0].indexes = vec![
            index("email_1", &["email"], "btree"),
            // MongoDB reports the backing unique index and its logical
            // constraint through two metadata endpoints. The review plan
            // must present the latter once, not as a second index action.
            index("email_unique", &["email"], "btree"),
        ];
        source.relations[0].constraints = vec![constraint("email_unique", "UNIQUE", &["email"])];
        source = finalize_schema_snapshot(source).unwrap();

        let mut target = snapshot("actual", vec![column("_id", "objectId", false)]);
        target.driver = "mongodb".to_string();
        target.database_name = None;
        target.schema_name = "app".to_string();
        target.relations[0].object_type = Some("collection".to_string());
        target = finalize_schema_snapshot(target).unwrap();

        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

        assert!(plan
            .changes
            .iter()
            .any(|change| change.kind == SchemaChangeKind::ColumnAdd));
        assert!(plan
            .changes
            .iter()
            .any(|change| change.kind == SchemaChangeKind::IndexAdd));
        assert!(plan
            .changes
            .iter()
            .any(|change| change.kind == SchemaChangeKind::ConstraintAdd));
        assert!(!plan.changes.iter().any(|change| {
            change.kind == SchemaChangeKind::IndexAdd
                && change.child_name.as_deref() == Some("email_unique")
        }));
        assert!(plan.changes.iter().all(|change| change.sql.is_empty()));
        assert!(plan
            .changes
            .iter()
            .all(|change| change.blocked_reason.is_some()));
        assert!(!plan.transactional);
        assert!(plan.migration_sql.contains("Metadata-only comparison"));
    }

    #[test]
    fn sqlite_snapshots_produce_blocked_rebuild_review_artifacts() {
        let mut source = snapshot(
            "desired",
            vec![
                column("id", "INTEGER", false),
                column("email", "TEXT", true),
            ],
        );
        source.driver = "sqlite".to_string();
        source.database_name = None;
        source.schema_name = "main".to_string();
        source = finalize_schema_snapshot(source).unwrap();

        let mut target = snapshot("actual", vec![column("id", "INTEGER", false)]);
        target.driver = "sqlite".to_string();
        target.database_name = None;
        target.schema_name = "main".to_string();
        target = finalize_schema_snapshot(target).unwrap();

        let plan = compare_schema_snapshots(&source, &target, 2).unwrap();

        assert_eq!(plan.driver, "sqlite");
        assert!(!plan.transactional);
        assert!(plan
            .changes
            .iter()
            .any(|change| change.kind == SchemaChangeKind::ColumnAdd));
        let rebuild = plan
            .changes
            .iter()
            .find(|change| change.kind == SchemaChangeKind::RelationModify)
            .expect("SQLite table drift should produce a rebuild artifact");
        assert!(rebuild.manual_review);
        assert!(rebuild.blocked_reason.is_some());
        assert!(rebuild.sql.iter().any(|sql| sql.contains("CREATE TABLE")));
        assert!(plan.migration_sql.contains("BEGIN IMMEDIATE"));
        assert!(plan.migration_sql.contains("PRAGMA foreign_key_check"));
    }

    #[test]
    fn sqlite_generated_columns_never_emit_lossy_rebuild_definitions() {
        let mut computed = column("computed_total", "INTEGER", true);
        computed.is_generated = Some(true);
        assert!(sqlite_column_definition(&computed)
            .unwrap_err()
            .contains("lossless SQLite expression"));

        let mut unknown = column("legacy_package_column", "TEXT", true);
        unknown.is_hidden = None;
        assert!(sqlite_column_definition(&unknown)
            .unwrap_err()
            .contains("true or unknown"));
    }

    #[test]
    fn dependency_cycle_is_blocked_without_emitting_partial_sql() {
        let mut first = change(
            SchemaChangeKind::ColumnAdd,
            SchemaChangeRisk::Safe,
            "public",
            "users",
            Some("BASE TABLE".to_string()),
            Some("first".to_string()),
            "Add first".to_string(),
            vec!["ALTER TABLE users ADD first int;".to_string()],
            true,
            false,
        );
        let mut second = change(
            SchemaChangeKind::ColumnAdd,
            SchemaChangeRisk::Safe,
            "public",
            "users",
            Some("BASE TABLE".to_string()),
            Some("second".to_string()),
            "Add second".to_string(),
            vec!["ALTER TABLE users ADD second int;".to_string()],
            true,
            false,
        );
        first.depends_on = vec![second.id.clone()];
        second.depends_on = vec![first.id.clone()];
        let mut warnings = Vec::new();

        let ordered = topologically_order_changes(vec![first, second], &mut warnings);

        assert!(ordered.iter().all(|change| change.sql.is_empty()));
        assert!(ordered.iter().all(|change| change.blocked_reason.is_some()));
        assert!(warnings.iter().any(|warning| warning.contains("cycle")));
    }
}
