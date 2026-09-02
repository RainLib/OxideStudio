use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

pub const DRIVER_PROTOCOL_VERSION: &str = "1.0";

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SecretConnectionConfig {
    pub url: String,
    #[serde(default)]
    pub options: BTreeMap<String, String>,
}

impl std::fmt::Debug for SecretConnectionConfig {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("SecretConnectionConfig")
            .field("url", &"<redacted>")
            .field("options", &format_args!("<{} entries>", self.options.len()))
            .finish()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HandshakeRequest {
    pub protocol_version: String,
    pub host_version: String,
    pub package_id: String,
    pub driver_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HandshakeResponse {
    pub protocol_version: String,
    pub package_id: String,
    pub package_version: String,
    pub driver_id: String,
    pub capabilities: DriverRuntimeCapabilities,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct DriverRuntimeCapabilities {
    pub metadata: bool,
    pub query: bool,
    pub cancellation: bool,
    pub transactions: bool,
    pub database_scoped_queries: bool,
    /// The sidecar owns a dialect-specific namespace/database creation flow.
    /// This must be explicit because `CREATE DATABASE` syntax and lifecycle
    /// differ across server, embedded, document, and warehouse families.
    pub database_creation: bool,
    /// The sidecar implements bounded server-side reverse foreign-key lookup.
    /// Older protocol-compatible packages omit this and therefore safely
    /// degrade relationship navigation to an empty result.
    pub referencing_foreign_keys: bool,
    /// The sidecar can enumerate descriptor-only schema objects such as
    /// types, packages, sequences, and extensions. Older packages omit this
    /// and keep the Explorer's supplemental-object tree empty.
    pub schema_objects: bool,
    /// The sidecar can lazily enumerate children of an explicitly marked
    /// descriptor object (for example Xugu TYPE attributes or package
    /// routines). This is separate from `schema_objects` so older packages
    /// cannot accidentally turn every descriptor into an expandable node.
    pub schema_object_members: bool,
    /// The sidecar independently rejects mutation requests when
    /// `DriverQueryContext.read_only` is set. Agent-owned external drivers
    /// require this capability instead of trusting a host-side SQL parser.
    pub read_only_enforcement: bool,
    /// The sidecar owns the complete schema-migration state machine. A Host
    /// must also require the signed package contract before sending semantic
    /// snapshots; this runtime bit alone never enables execution.
    pub semantic_schema_migration: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DriverRequestEnvelope {
    pub id: u64,
    #[serde(flatten)]
    pub request: DriverRequest,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "method", content = "params", rename_all = "camelCase")]
pub enum DriverRequest {
    Handshake(HandshakeRequest),
    Connect {
        connection_id: String,
        config: SecretConnectionConfig,
    },
    Disconnect {
        connection_id: String,
    },
    Ping {
        connection_id: String,
    },
    ServerVersion {
        connection_id: String,
    },
    CreateDatabase {
        connection_id: String,
        request: DatabaseCreateRequest,
    },
    Query {
        connection_id: String,
        statement: String,
        #[serde(default)]
        parameters: Vec<DriverQueryParameter>,
        #[serde(default)]
        context: DriverQueryContext,
        #[serde(default)]
        query_id: Option<String>,
    },
    Cancel {
        connection_id: String,
        query_id: String,
    },
    Metadata {
        connection_id: String,
        request: MetadataRequest,
    },
    /// Build a target-owned plan from bounded semantic snapshots. No Host SQL
    /// is present in this request or in any later mutation request.
    PlanSchemaMigration {
        connection_id: String,
        request: SchemaMigrationPlanRequest,
    },
    PreflightSchemaMigration {
        connection_id: String,
        request: SchemaMigrationPreflightRequest,
    },
    ApplySchemaMigration {
        connection_id: String,
        request: SchemaMigrationApplyRequest,
    },
    VerifySchemaMigration {
        connection_id: String,
        request: SchemaMigrationVerifyRequest,
    },
    BeginTransaction {
        connection_id: String,
        transaction_id: String,
        #[serde(default)]
        context: DriverQueryContext,
    },
    CommitTransaction {
        connection_id: String,
        transaction_id: String,
    },
    RollbackTransaction {
        connection_id: String,
        transaction_id: String,
    },
    Shutdown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DriverQueryParameter {
    pub value: Value,
    #[serde(default)]
    pub data_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct DriverQueryContext {
    #[serde(default)]
    pub database: Option<String>,
    #[serde(default)]
    pub schema: Option<String>,
    #[serde(default)]
    pub transaction_id: Option<String>,
    #[serde(default)]
    pub read_only: bool,
}

/// A semantic create request. The sidecar owns its dialect syntax, server
/// version checks, and whether `name` denotes a catalog, schema, namespace, or
/// another top-level container. Host callers never interpolate these fields
/// into SQL for an external driver.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseCreateRequest {
    pub name: String,
    #[serde(default)]
    pub charset: Option<String>,
    #[serde(default)]
    pub collation: Option<String>,
    #[serde(default)]
    pub owner: Option<String>,
    /// Optional semantic namespace kind. Existing v1 sidecars may omit it.
    #[serde(default)]
    pub namespace_kind: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SchemaMigrationMode {
    Transactional,
    NonTransactional,
}

/// A normalized, descriptor-only schema snapshot. `descriptor` may contain
/// relation, column, index and constraint metadata, but never credentials,
/// SQL source, row values or local paths.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SemanticSchemaSnapshot {
    pub snapshot_version: u32,
    pub fingerprint: String,
    #[serde(default)]
    pub database: Option<String>,
    pub namespace: String,
    pub descriptor: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaMigrationPlanRequest {
    pub source: SemanticSchemaSnapshot,
    pub target: SemanticSchemaSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaMigrationPreviewChange {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub risk: String,
    pub reversible: bool,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaMigrationPlanResult {
    pub plan_id: String,
    /// Opaque sidecar-owned token. The Host persists neither this token nor a
    /// resumable migration after process exit.
    pub plan_token: String,
    pub target_fingerprint: String,
    pub mode: SchemaMigrationMode,
    pub change_count: u32,
    pub blocked_change_count: u32,
    pub requires_review: bool,
    pub requires_destructive: bool,
    pub preview: Vec<SchemaMigrationPreviewChange>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaMigrationPreflightRequest {
    pub plan_token: String,
    pub target_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaMigrationPreflightCheckResult {
    pub id: String,
    pub label: String,
    pub status: String,
    pub blocks_execution: bool,
    pub observed: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaMigrationPreflightResult {
    pub plan_id: String,
    pub preflight_token: String,
    pub target_fingerprint: String,
    pub ready: bool,
    pub checks: Vec<SchemaMigrationPreflightCheckResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaMigrationApplyRequest {
    pub plan_token: String,
    pub preflight_token: String,
    pub target_fingerprint: String,
    pub allow_review: bool,
    pub allow_destructive: bool,
    pub allow_non_transactional: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SchemaMigrationApplyStatus {
    Applied,
    PartiallyApplied,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaMigrationApplyResult {
    pub plan_id: String,
    pub apply_token: String,
    pub status: SchemaMigrationApplyStatus,
    pub committed_change_count: u32,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaMigrationVerifyRequest {
    pub plan_token: String,
    pub apply_token: String,
    pub expected_source_fingerprint: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaMigrationVerifyResult {
    pub plan_id: String,
    pub matches_source: bool,
    pub target_fingerprint_after: String,
    pub remaining_change_count: u32,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MetadataRequest {
    Databases,
    Schemas {
        #[serde(default)]
        database: Option<String>,
    },
    Relations {
        #[serde(default)]
        database: Option<String>,
        namespace: String,
    },
    Collections {
        namespace: String,
        #[serde(default)]
        cursor: Option<String>,
        #[serde(default)]
        limit: Option<u32>,
        #[serde(default)]
        filter: Option<String>,
    },
    Columns {
        #[serde(default)]
        database: Option<String>,
        namespace: String,
        relation: String,
    },
    Indexes {
        #[serde(default)]
        database: Option<String>,
        namespace: String,
        relation: String,
    },
    Constraints {
        #[serde(default)]
        database: Option<String>,
        namespace: String,
        relation: String,
    },
    /// Reverse FK lookup keeps relationship navigation server-side instead of
    /// requiring the host to enumerate every relation in a large catalog.
    ReferencingForeignKeys {
        #[serde(default)]
        database: Option<String>,
        namespace: String,
        relation: String,
    },
    Routines {
        #[serde(default)]
        database: Option<String>,
        namespace: String,
    },
    /// Descriptor-only objects that are not relations. This is intentionally
    /// separate from `Relations` so a host never treats a type or package as
    /// a table/grid/DDL target.
    SchemaObjects {
        #[serde(default)]
        database: Option<String>,
        namespace: String,
    },
    /// Read-only members of one descriptor object. A caller must have first
    /// received `membersExpandable: true` for that object from SchemaObjects.
    SchemaObjectMembers {
        #[serde(default)]
        database: Option<String>,
        namespace: String,
        object_name: String,
        object_type: String,
    },
    /// Return a driver-rendered, read-only source definition for one object.
    /// This is intentionally metadata rather than Query: the Host must never
    /// synthesize catalog SQL for a signed external package whose dialect may
    /// differ from a built-in driver sharing the same id.
    ObjectSource {
        #[serde(default)]
        database: Option<String>,
        namespace: String,
        object_name: String,
        object_type: String,
        /// Required by object kinds (such as triggers) whose name is only
        /// unique within a parent relation.
        #[serde(default)]
        relation_name: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DriverResponseEnvelope {
    pub id: u64,
    #[serde(flatten)]
    pub response: DriverResponse,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "status", content = "result", rename_all = "camelCase")]
pub enum DriverResponse {
    Ok(DriverResult),
    Error(DriverProtocolError),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum DriverResult {
    Handshake(HandshakeResponse),
    Empty,
    Boolean(bool),
    ServerVersion(Option<String>),
    Query(Vec<DriverQueryResult>),
    Metadata(Value),
    SchemaMigrationPlan(SchemaMigrationPlanResult),
    SchemaMigrationPreflight(SchemaMigrationPreflightResult),
    SchemaMigrationApply(SchemaMigrationApplyResult),
    SchemaMigrationVerify(SchemaMigrationVerifyResult),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DriverQueryResult {
    pub columns: Vec<DriverColumn>,
    pub rows: Vec<Vec<Value>>,
    #[serde(default)]
    pub truncated: bool,
    #[serde(default)]
    pub row_limit: Option<u64>,
    #[serde(default)]
    pub rows_affected: Option<u64>,
    #[serde(default)]
    pub statement_type: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DriverColumn {
    pub name: String,
    pub data_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DriverProtocolError {
    pub code: String,
    pub message: String,
    #[serde(default)]
    pub retryable: bool,
    #[serde(default)]
    pub details: BTreeMap<String, String>,
}

pub fn protocol_major(version: &str) -> Option<u64> {
    version.split('.').next()?.parse().ok()
}

pub fn protocol_is_compatible(version: &str) -> bool {
    protocol_major(version) == protocol_major(DRIVER_PROTOCOL_VERSION)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connection_debug_output_redacts_secrets() {
        let config = SecretConnectionConfig {
            url: "postgres://user:password@localhost/app".to_string(),
            options: BTreeMap::from([("password".to_string(), "secret".to_string())]),
        };
        let output = format!("{config:?}");
        assert!(!output.contains("password@"));
        assert!(!output.contains("secret"));
        assert!(output.contains("redacted"));
    }

    #[test]
    fn request_envelope_round_trips_without_losing_context() {
        let envelope = DriverRequestEnvelope {
            id: 7,
            request: DriverRequest::Query {
                connection_id: "connection-1".to_string(),
                statement: "SELECT 1".to_string(),
                parameters: Vec::new(),
                context: DriverQueryContext {
                    database: Some("app".to_string()),
                    schema: Some("public".to_string()),
                    read_only: true,
                    ..DriverQueryContext::default()
                },
                query_id: Some("query-1".to_string()),
            },
        };
        let json = serde_json::to_string(&envelope).unwrap();
        let decoded: DriverRequestEnvelope = serde_json::from_str(&json).unwrap();
        assert_eq!(decoded, envelope);
    }

    #[test]
    fn request_wire_contract_keeps_enum_fields_snake_case_and_nested_context_camel_case() {
        let envelope = DriverRequestEnvelope {
            id: 8,
            request: DriverRequest::Query {
                connection_id: "connection-1".to_string(),
                statement: "SELECT ?".to_string(),
                parameters: Vec::new(),
                context: DriverQueryContext {
                    transaction_id: Some("tx-1".to_string()),
                    read_only: true,
                    ..DriverQueryContext::default()
                },
                query_id: Some("query-1".to_string()),
            },
        };
        let encoded = serde_json::to_value(&envelope).unwrap();
        assert_eq!(encoded["params"]["connection_id"], "connection-1");
        assert_eq!(encoded["params"]["query_id"], "query-1");
        assert_eq!(encoded["params"]["context"]["transactionId"], "tx-1");
        assert_eq!(encoded["params"]["context"]["readOnly"], true);
        assert!(encoded["params"].get("connectionId").is_none());
        assert!(encoded["params"].get("queryId").is_none());
    }

    #[test]
    fn create_database_request_stays_semantic_and_never_carries_sql() {
        let envelope = DriverRequestEnvelope {
            id: 11,
            request: DriverRequest::CreateDatabase {
                connection_id: "connection-1".to_string(),
                request: DatabaseCreateRequest {
                    name: "analytics".to_string(),
                    charset: Some("utf8mb4".to_string()),
                    collation: None,
                    owner: Some("reporting".to_string()),
                    namespace_kind: Some("database".to_string()),
                },
            },
        };
        let encoded = serde_json::to_value(&envelope).unwrap();
        assert_eq!(encoded["method"], "createDatabase");
        assert_eq!(encoded["params"]["request"]["name"], "analytics");
        assert_eq!(encoded["params"]["request"]["namespaceKind"], "database");
        assert!(encoded.to_string().contains("analytics"));
        assert!(!encoded
            .to_string()
            .to_ascii_lowercase()
            .contains("create schema"));
        assert_eq!(
            serde_json::from_value::<DriverRequestEnvelope>(encoded).unwrap(),
            envelope
        );
    }

    #[test]
    fn migration_requests_are_token_bound_and_never_carry_host_sql() {
        let envelope = DriverRequestEnvelope {
            id: 12,
            request: DriverRequest::ApplySchemaMigration {
                connection_id: "connection-1".to_string(),
                request: SchemaMigrationApplyRequest {
                    plan_token: "plan-token".to_string(),
                    preflight_token: "preflight-token".to_string(),
                    target_fingerprint: "target-fingerprint".to_string(),
                    allow_review: true,
                    allow_destructive: false,
                    allow_non_transactional: false,
                },
            },
        };
        let encoded = serde_json::to_value(&envelope).unwrap();
        assert_eq!(encoded["method"], "applySchemaMigration");
        assert_eq!(encoded["params"]["connection_id"], "connection-1");
        assert_eq!(encoded["params"]["request"]["planToken"], "plan-token");
        assert!(encoded["params"]["request"].get("sql").is_none());
        assert!(encoded["params"]["request"].get("statements").is_none());
        assert_eq!(
            serde_json::from_value::<DriverRequestEnvelope>(encoded).unwrap(),
            envelope
        );
    }

    #[test]
    fn only_matching_protocol_majors_are_compatible() {
        assert!(protocol_is_compatible("1.9"));
        assert!(!protocol_is_compatible("2.0"));
        assert!(!protocol_is_compatible("not-a-version"));
    }

    #[test]
    fn older_runtime_capabilities_default_reverse_fk_lookup_to_disabled() {
        let capabilities: DriverRuntimeCapabilities = serde_json::from_value(serde_json::json!({
            "metadata": true,
            "query": true,
            "databaseScopedQueries": true
        }))
        .unwrap();
        assert!(capabilities.metadata);
        assert!(!capabilities.referencing_foreign_keys);
        assert!(!capabilities.schema_objects);
        assert!(!capabilities.schema_object_members);
        assert!(!capabilities.semantic_schema_migration);
    }

    #[test]
    fn schema_object_member_requests_keep_parent_identity_explicit() {
        let request = MetadataRequest::SchemaObjectMembers {
            database: Some("app".to_string()),
            namespace: "public".to_string(),
            object_name: "customer_type".to_string(),
            object_type: "TYPE".to_string(),
        };
        let encoded = serde_json::to_value(&request).unwrap();
        assert_eq!(encoded["kind"], "schemaObjectMembers");
        assert_eq!(encoded["database"], "app");
        // MetadataRequest keeps its existing snake_case field wire contract;
        // only the tagged enum discriminator is camelCase.
        assert_eq!(encoded["object_name"], "customer_type");
        assert_eq!(
            serde_json::from_value::<MetadataRequest>(encoded).unwrap(),
            request
        );
    }

    #[test]
    fn object_source_requests_keep_the_object_and_optional_parent_bound() {
        let request = MetadataRequest::ObjectSource {
            database: None,
            namespace: "public".to_string(),
            object_name: "report_view".to_string(),
            object_type: "VIEW".to_string(),
            relation_name: Some("reports".to_string()),
        };
        let encoded = serde_json::to_value(&request).unwrap();
        assert_eq!(encoded["kind"], "objectSource");
        assert_eq!(encoded["object_name"], "report_view");
        assert_eq!(encoded["relation_name"], "reports");
        assert_eq!(
            serde_json::from_value::<MetadataRequest>(encoded).unwrap(),
            request
        );
    }
}
