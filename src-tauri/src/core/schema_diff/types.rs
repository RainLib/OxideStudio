use crate::core::protocol::{
    ColumnInfo, ConstraintInfo, FunctionInfo, FunctionParameterInfo, IndexInfo, SchemaObjectInfo,
};
use serde::{Deserialize, Serialize};

pub const SCHEMA_SNAPSHOT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaRelationSnapshot {
    pub name: String,
    pub object_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
    /// The read-only SELECT body for a view, or the native SQLite CREATE TABLE
    /// definition replayed through the guarded, catalog-validated rebuild path.
    /// Other table drivers leave it absent. Older snapshots deserialize
    /// without it and remain review-only where exact source is required.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub definition: Option<String>,
    /// PostgreSQL exposes whether a materialized view currently contains data.
    /// This stays absent for ordinary views, other drivers, and legacy snapshots.
    /// A missing value is deliberately restored as `WITH NO DATA` so review-only
    /// migration never causes an unexpected source query execution.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub materialized_view_populated: Option<bool>,
    /// Direct same-schema relation dependencies captured from the catalog for
    /// views. The planner uses these only to order reviewed DDL; they never
    /// broaden the set of objects selected for a migration.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub dependencies: Vec<String>,
    /// Direct PostgreSQL view prerequisites that are outside the captured
    /// schema. They are retained as qualified catalog names for review but
    /// never become plan edges because this snapshot does not own them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub external_dependencies: Vec<String>,
    /// Native PostgreSQL sequences referenced by this relation's defaults.
    /// Kept separate from relation dependencies so a sequence named like a
    /// table cannot be mistaken for a relation during planning.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sequence_dependencies: Vec<String>,
    pub columns: Vec<ColumnInfo>,
    pub indexes: Vec<IndexInfo>,
    pub constraints: Vec<ConstraintInfo>,
}

/// A compact routine signature. Native PostgreSQL snapshots may additionally
/// carry the catalog-provided create-or-replace DDL. It is always review-gated:
/// source text can be dialect-specific and can contain implementation details.
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
    /// Native, catalog-provided routine DDL. This is absent for legacy
    /// snapshots and every driver without an explicit safe source contract.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub definition: Option<String>,
}

impl From<FunctionInfo> for SchemaRoutineSnapshot {
    fn from(function: FunctionInfo) -> Self {
        Self {
            name: function.name,
            routine_type: function.routine_type,
            parameters: function.parameters,
            return_type: function.return_type,
            description: function.description,
            definition: None,
        }
    }
}

/// Ownership metadata for a PostgreSQL sequence. The sequence itself remains
/// the schema object; this is only the relation column it is attached to.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaSequenceOwnerSnapshot {
    pub table_name: String,
    pub column_name: String,
}

/// Schema object metadata. Catalog-backed native objects carry their source
/// only when the planner has a reviewed, driver-specific execution contract.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaObjectSnapshot {
    pub name: String,
    pub object_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub definition: Option<String>,
    /// PostgreSQL sequence ownership is applied only after the owning relation
    /// exists. Legacy snapshots leave this absent and preserve old behavior.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sequence_owner: Option<SchemaSequenceOwnerSnapshot>,
    /// Last observed PostgreSQL sequence value. This remains optional because
    /// `pg_sequence_last_value` can be unavailable to a restricted role.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sequence_last_value: Option<String>,
    /// Whether `nextval()` has returned a value for this PostgreSQL sequence.
    /// Legacy snapshots omit this field and retain the historical `true`
    /// interpretation whenever a readable last value is present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sequence_is_called: Option<bool>,
    /// Direct native object prerequisites. PostgreSQL currently captures the
    /// trigger callback routine name; the planner turns it into an exact
    /// dependency only when the corresponding routine create is unambiguous.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub dependencies: Vec<String>,
}

impl From<SchemaObjectInfo> for SchemaObjectSnapshot {
    fn from(object: SchemaObjectInfo) -> Self {
        Self {
            name: object.name,
            object_type: object.object_type,
            parent_name: object.parent_name,
            description: object.comment,
            definition: None,
            sequence_owner: None,
            sequence_last_value: None,
            sequence_is_called: None,
            dependencies: Vec::new(),
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

/// The explicit source-to-target namespace selected for a schema diff.
/// Keeping the pair together prevents helpers from accidentally mixing a
/// source identifier with the destination DDL namespace.
#[derive(Debug, Clone, Copy)]
pub(super) struct SchemaNameMapping<'a> {
    pub(super) source: &'a str,
    pub(super) target: &'a str,
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
