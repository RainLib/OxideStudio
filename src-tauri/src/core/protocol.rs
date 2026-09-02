use serde::{Deserialize, Serialize};

/// Query result sets are intentionally bounded at the driver boundary. This
/// keeps an accidental unfiltered SELECT from materializing an entire table in
/// the desktop process while still fetching one sentinel row to report that
/// the visible result is incomplete.
pub const DEFAULT_QUERY_RESULT_ROW_LIMIT: usize = 1_000;

/// A complete Nacos configuration value obtained through the driver's fixed
/// OpenAPI contract.  It is intentionally separate from `QueryResult`: a
/// migration must never use the 64 KiB explorer preview as its source.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NacosConfigSnapshot {
    pub data_id: String,
    pub group: String,
    pub tenant: String,
    pub content: String,
    /// Server supplied revision (`md5`) when the Nacos list endpoint exposes
    /// it. It is used as an optimistic-concurrency guard for overwrites.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision: Option<String>,
}

#[derive(Debug, Clone, Copy)]
pub struct NacosConfigPublishRequest<'a> {
    pub data_id: &'a str,
    pub group: &'a str,
    pub tenant: &'a str,
    pub content: &'a str,
    /// Revision reviewed during preview. `None` means the preview confirmed
    /// that the target did not exist.
    pub expected_revision: Option<&'a str>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NacosConfigPublishReceipt {
    pub data_id: String,
    pub group: String,
    pub tenant: String,
    pub overwritten: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct QueryResult {
    pub columns: Vec<ColumnDef>,
    pub rows: Vec<Vec<serde_json::Value>>,
    #[serde(default)]
    pub truncated: bool,
    #[serde(default, rename = "rowLimit", skip_serializing_if = "Option::is_none")]
    pub row_limit: Option<usize>,
    #[serde(
        default,
        rename = "rowsAffected",
        skip_serializing_if = "Option::is_none"
    )]
    pub rows_affected: Option<u64>,
    #[serde(
        default,
        rename = "statementType",
        skip_serializing_if = "Option::is_none"
    )]
    pub statement_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(
        default,
        rename = "responseMeta",
        skip_serializing_if = "Option::is_none"
    )]
    pub response_meta: Option<QueryResponseMeta>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct QueryResponseMeta {
    pub request_method: String,
    pub request_path: String,
    pub status: u16,
    pub duration_ms: u64,
    pub raw_response: serde_json::Value,
}

impl QueryResult {
    pub fn rows(columns: Vec<ColumnDef>, rows: Vec<Vec<serde_json::Value>>) -> Self {
        Self {
            columns,
            rows,
            truncated: false,
            row_limit: None,
            rows_affected: None,
            statement_type: None,
            message: None,
            response_meta: None,
        }
    }

    pub fn rows_limited(
        columns: Vec<ColumnDef>,
        mut rows: Vec<Vec<serde_json::Value>>,
        row_limit: usize,
    ) -> Self {
        let truncated = rows.len() > row_limit;
        if truncated {
            rows.truncate(row_limit);
        }

        Self {
            columns,
            rows,
            truncated,
            row_limit: truncated.then_some(row_limit),
            rows_affected: None,
            statement_type: None,
            message: None,
            response_meta: None,
        }
    }

    pub fn execution(statement_type: &str, rows_affected: u64) -> Self {
        let message = if rows_affected == 1 {
            format!("{statement_type} executed successfully. 1 row affected.")
        } else {
            format!("{statement_type} executed successfully. {rows_affected} rows affected.")
        };

        Self {
            columns: Vec::new(),
            rows: Vec::new(),
            truncated: false,
            row_limit: None,
            rows_affected: Some(rows_affected),
            statement_type: Some(statement_type.to_string()),
            message: Some(message),
            response_meta: None,
        }
    }
}

#[cfg(test)]
mod query_result_tests {
    use super::{ColumnDef, QueryResult};

    #[test]
    fn limited_rows_keep_a_complete_result_unmarked() {
        let result = QueryResult::rows_limited(Vec::<ColumnDef>::new(), vec![vec![]], 2);

        assert_eq!(result.rows.len(), 1);
        assert!(!result.truncated);
        assert_eq!(result.row_limit, None);
    }

    #[test]
    fn limited_rows_drop_the_sentinel_and_report_the_limit() {
        let result =
            QueryResult::rows_limited(Vec::<ColumnDef>::new(), vec![vec![], vec![], vec![]], 2);

        assert_eq!(result.rows.len(), 2);
        assert!(result.truncated);
        assert_eq!(result.row_limit, Some(2));
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExplainPlanMode {
    Estimate,
    Analyze,
}

#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExplainPlanFormat {
    Json,
    Text,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExplainPlanNode {
    pub id: String,
    pub node_type: String,
    pub relation: Option<String>,
    pub alias: Option<String>,
    pub access_type: Option<String>,
    pub join_type: Option<String>,
    pub index: Option<String>,
    pub condition: Option<String>,
    pub startup_cost: Option<f64>,
    pub total_cost: Option<f64>,
    pub estimated_rows: Option<f64>,
    pub actual_startup_time_ms: Option<f64>,
    pub actual_total_time_ms: Option<f64>,
    pub actual_rows: Option<f64>,
    pub loops: Option<f64>,
    #[serde(default)]
    pub children: Vec<ExplainPlanNode>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExplainPlan {
    pub id: String,
    pub driver: String,
    pub mode: ExplainPlanMode,
    pub format: ExplainPlanFormat,
    pub generated_in_ms: f64,
    pub planning_time_ms: Option<f64>,
    pub execution_time_ms: Option<f64>,
    pub total_cost: Option<f64>,
    pub estimated_rows: Option<f64>,
    pub root: ExplainPlanNode,
    pub raw_plan: serde_json::Value,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct ColumnDef {
    pub name: String,
    pub data_type: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct QueryParameter {
    pub value: serde_json::Value,
    pub data_type: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ParameterizedStatement {
    pub sql: String,
    pub params: Vec<QueryParameter>,
}

/// Semantic top-level namespace creation request. Native drivers may compile
/// this into their bounded dialect SQL; external drivers pass the intent to
/// their verified sidecar so the host never guesses vendor syntax.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseCreateRequest {
    pub name: String,
    pub charset: Option<String>,
    pub collation: Option<String>,
    pub owner: Option<String>,
    /// External sidecars use the signed capability label to decide whether
    /// this is a schema or database request; the Host never infers SQL.
    pub namespace_kind: Option<String>,
}

/// Read-only catalog metadata used by the connection-level database browser.
/// Drivers that cannot expose the optional fields still return the database
/// name so the browser degrades without product-specific SQL in the WebView.
#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseInfo {
    pub name: String,
    pub size_bytes: Option<i64>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub comment: Option<String>,
    pub default_charset: Option<String>,
    pub default_collation: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct TableInfo {
    pub name: String,
    pub schema: Option<String>,
    #[serde(default, rename = "type", skip_serializing_if = "Option::is_none")]
    pub table_type: Option<String>,
    pub comment: Option<String>,
}

/// A non-relation object visible in a schema tree. This deliberately carries
/// only descriptor metadata: callers must not infer that a sequence, trigger,
/// type, or extension has table/grid/DDL capabilities from its presence.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaObjectInfo {
    pub name: String,
    pub schema: Option<String>,
    pub object_type: String,
    pub parent_name: Option<String>,
    pub comment: Option<String>,
    /// Drivers opt into lazy member expansion explicitly. The host must never
    /// infer it merely from an object's `TYPE` label.
    #[serde(default)]
    pub members_expandable: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct CollectionInfo {
    pub name: String,
    pub namespace: Option<String>,
    #[serde(default, rename = "type", skip_serializing_if = "Option::is_none")]
    pub collection_type: Option<String>,
    #[serde(
        default,
        rename = "documentCount",
        skip_serializing_if = "Option::is_none"
    )]
    pub document_count: Option<u64>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CollectionPage {
    pub items: Vec<CollectionInfo>,
    pub next_cursor: Option<String>,
    pub total: Option<u64>,
}

/// One bounded page from a native document/search collection.
///
/// `next_cursor` is an opaque, driver-owned continuation. Consumers must pass
/// it back unchanged and must not derive an OFFSET from the visible page.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DocumentPage {
    pub result: QueryResult,
    pub next_cursor: Option<String>,
    pub total: Option<u64>,
}

/// One bounded page from a native SQL/result cursor. Unlike table OFFSET
/// paging, `next_cursor` is opaque and only valid for the originating live
/// connection. It lets external drivers retain vendor-native cursor semantics
/// without rewriting the submitted statement.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NativeQueryPage {
    pub result: QueryResult,
    pub next_cursor: Option<String>,
}

/// Driver-owned Elasticsearch-compatible metadata endpoints. Keeping the
/// endpoint as a closed enum prevents renderer input from becoming an
/// arbitrary transport path.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SearchIndexMetadataKind {
    Mapping,
    Settings,
    Stats,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchIndexClearResult {
    pub total: u64,
    pub deleted: u64,
    pub version_conflicts: u64,
    pub timed_out: bool,
    pub failures: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub is_primary_key: bool,
    pub is_unique: bool,
    pub is_indexed: bool,
    #[serde(default)]
    pub is_auto_increment: bool,
    /// Database-proven identity generation mode. Bundled PostgreSQL emits
    /// `always` or `byDefault`; `None` also covers sequence-backed serial and
    /// older external-driver payloads that do not expose identity semantics.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity_generation: Option<String>,
    /// Structured database-owned generation metadata. `None` means that the
    /// driver did not prove the classification and must not be treated as a
    /// writable `false` by INSERT-oriented consumers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_generated: Option<bool>,
    /// Structured hidden/invisible-column metadata. `None` is unknown rather
    /// than visible; old external driver packages remain wire-compatible.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_hidden: Option<bool>,
    pub default_value: Option<String>,
    pub comment: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct IndexInfo {
    pub name: String,
    pub columns: Vec<String>,
    pub is_unique: bool,
    pub is_primary: bool,
    /// Predicate of a partial/filtered index, without the leading `WHERE`.
    /// Older external driver packages omit this field, which means unknown
    /// rather than an empty predicate.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter: Option<String>,
    pub index_type: Option<String>,
    /// Non-key columns stored by an index (for example PostgreSQL `INCLUDE`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub included_columns: Option<Vec<String>>,
    pub definition: Option<String>,
    #[serde(default)]
    pub comment: Option<String>,
    /// Parallel to `columns`: true means the key contains catalog-provided raw
    /// semantics that cannot be recreated from the identifier alone (for
    /// example an expression, prefix length, or descending key). An empty
    /// vector means that the metadata provider did not prove key provenance.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub key_is_expression: Vec<bool>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct ConstraintInfo {
    pub name: String,
    pub constraint_type: String,
    pub columns: Vec<String>,
    pub referenced_schema: Option<String>,
    pub referenced_table: Option<String>,
    pub referenced_columns: Vec<String>,
    pub definition: Option<String>,
    /// Structured referential actions are required for MySQL-family metadata,
    /// where `CHECK_CLAUSE` does not contain the foreign-key definition.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_update: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_delete: Option<String>,
}

/// A foreign key whose owning table references another relation.
///
/// This includes the owning relation so reverse lookups can navigate from a
/// referenced row to all rows that point at it.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct ForeignKeyReferenceInfo {
    pub name: String,
    pub schema: String,
    pub table: String,
    pub columns: Vec<String>,
    pub referenced_schema: String,
    pub referenced_table: String,
    pub referenced_columns: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct FunctionParameterInfo {
    pub name: String,
    pub data_type: String,
    #[serde(default)]
    pub optional: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct FunctionInfo {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub routine_type: Option<String>,
    #[serde(default)]
    pub parameters: Vec<FunctionParameterInfo>,
    pub return_type: String,
    pub description: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "action", content = "payload")]
pub enum Request {
    Connect {
        driver: String,
        url: String,
        name: Option<String>,
    },
    Disconnect {
        connection_id: String,
    },
    Query {
        connection_id: String,
        sql: String,
    },
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Response<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<ErrorResponse>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ErrorResponse {
    pub code: String,
    pub message: String,
    #[serde(default)]
    pub retryable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<serde_json::Value>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CommandError {
    pub code: String,
    pub message: String,
    #[serde(default)]
    pub retryable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<serde_json::Value>,
}

impl CommandError {
    pub fn new(
        code: impl Into<String>,
        message: impl Into<String>,
        retryable: bool,
        context: Option<serde_json::Value>,
    ) -> Self {
        let code = code.into();
        Self {
            category: Some(error_category(&code).to_string()),
            code,
            message: message.into(),
            retryable,
            context,
        }
    }
}

impl std::fmt::Display for CommandError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

impl std::error::Error for CommandError {}

impl<T> Response<T> {
    pub fn ok(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn err(code: &str, message: &str) -> Self {
        Self::err_with_details(code, message, false, None)
    }

    pub fn err_with_details(
        code: &str,
        message: &str,
        retryable: bool,
        context: Option<serde_json::Value>,
    ) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(ErrorResponse {
                code: code.to_string(),
                message: message.to_string(),
                retryable,
                category: Some(error_category(code).to_string()),
                context,
            }),
        }
    }
}

fn error_category(code: &str) -> &'static str {
    if code.contains("PERMISSION_DENIED") {
        "permission"
    } else if code.contains("CONNECTION") || code == "DISCONNECT_ERROR" {
        "connection"
    } else if code.contains("QUERY") || code.contains("EXPLAIN") || code.contains("SQL_COMPLETION")
    {
        "query"
    } else if code.ends_with("_LIST_FAILED")
        || code == "COLLECTION_PAGE_FAILED"
        || code == "SET_CURRENT_SCHEMA_FAILED"
        || code.contains("SCHEMA_")
        || code.contains("METADATA")
    {
        "schema"
    } else if code.contains("TABLE") || code.contains("VIEW") || code.contains("CONSTRAINT") {
        "table"
    } else if code == "REVISION_CONFLICT"
        || code.contains("PROJECT")
        || code.contains("FILE")
        || code.contains("PATH")
    {
        "projectFile"
    } else if code.contains("UNSUPPORTED") {
        "capability"
    } else if code.contains("DATABASE_ADMIN") {
        "databaseAdmin"
    } else {
        "application"
    }
}

#[cfg(test)]
mod tests {
    use super::{ColumnInfo, CommandError, QueryResult, Response};

    #[test]
    fn column_info_keeps_old_packages_compatible_without_claiming_writability() {
        let legacy = serde_json::json!({
            "name": "computed_total",
            "data_type": "numeric",
            "is_nullable": true,
            "is_primary_key": false,
            "is_unique": false,
            "is_indexed": false,
            "default_value": null,
            "comment": null
        });
        let column: ColumnInfo = serde_json::from_value(legacy).unwrap();
        assert_eq!(column.is_generated, None);
        assert_eq!(column.is_hidden, None);

        let mut classified = column;
        classified.is_generated = Some(true);
        classified.is_hidden = Some(false);
        let encoded = serde_json::to_value(classified).unwrap();
        assert_eq!(encoded["is_generated"], true);
        assert_eq!(encoded["is_hidden"], false);
    }

    #[test]
    fn execution_result_carries_affected_rows() {
        let result = QueryResult::execution("UPDATE", 3);

        assert!(result.columns.is_empty());
        assert!(result.rows.is_empty());
        assert_eq!(result.rows_affected, Some(3));
        assert_eq!(result.statement_type.as_deref(), Some("UPDATE"));
        assert!(result.message.unwrap().contains("3 rows affected"));
    }

    #[test]
    fn response_errors_include_stable_operational_details() {
        let response = Response::<()>::err_with_details(
            "QUERY_EXECUTION_FAILED",
            "connection reset",
            true,
            Some(serde_json::json!({ "connectionId": "connection-1" })),
        );
        let error = response.error.expect("error response");

        assert_eq!(error.code, "QUERY_EXECUTION_FAILED");
        assert_eq!(error.category.as_deref(), Some("query"));
        assert!(error.retryable);
        assert_eq!(
            error.context,
            Some(serde_json::json!({ "connectionId": "connection-1" }))
        );
    }

    #[test]
    fn command_errors_classify_revision_conflicts_as_project_files() {
        let error = CommandError::new(
            "REVISION_CONFLICT",
            "file changed on disk",
            false,
            Some(serde_json::json!({ "relativePath": "query.sql" })),
        );

        assert_eq!(error.category.as_deref(), Some("projectFile"));
        assert!(!error.retryable);
    }

    #[test]
    fn metadata_list_errors_are_classified_as_schema_errors() {
        for code in [
            "DATABASE_LIST_FAILED",
            "TABLE_LIST_FAILED",
            "COLUMN_LIST_FAILED",
            "DATABASE_FUNCTION_LIST_FAILED",
        ] {
            let error = Response::<()>::err(code, "metadata lookup failed")
                .error
                .expect("error response");
            assert_eq!(error.category.as_deref(), Some("schema"), "{code}");
        }
    }
}
