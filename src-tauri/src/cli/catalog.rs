use serde::Serialize;
use serde_json::{json, Value};

pub const CONNECTION_SUMMARIES: &str = "connection.listSummaries";
pub const METADATA_LIST: &str = "metadata.listObjects";
pub const METADATA_LIVE: &str = "metadata.inspectLive";
pub const QUERY_READ_ONLY: &str = "query.runReadOnly";
pub const DOCUMENT_FIND: &str = "document.findReadOnly";
pub const QUERY_EXPLAIN_ESTIMATE: &str = "query.explainEstimate";
pub const LSP_SQL_CONTEXT: &str = "lsp.sqlContext";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolSpec {
    pub name: &'static str,
    pub title: &'static str,
    pub description: &'static str,
    pub input_schema: Value,
    pub read_only: bool,
    pub destructive: bool,
    pub idempotent: bool,
    pub open_world: bool,
}

pub fn all() -> Vec<ToolSpec> {
    vec![
        ToolSpec {
            name: CONNECTION_SUMMARIES,
            title: "List connection summaries",
            description: "List sanitized saved-connection summaries inside the granted OxideStudio project. Credentials and connection URLs are never returned.",
            input_schema: object_schema(json!({})),
            read_only: true,
            destructive: false,
            idempotent: true,
            open_world: false,
        },
        ToolSpec {
            name: METADATA_LIST,
            title: "List cached database objects",
            description: "Search bounded metadata already cached by OxideStudio. Connection and database grants apply. With a database allowlist, records lacking database provenance are excluded; use metadata.inspectLive to inspect the current catalog.",
            input_schema: object_schema(json!({
                "connectionId": { "type": "string", "minLength": 1, "maxLength": 128 },
                "parentId": { "type": "string", "minLength": 1, "maxLength": 512 },
                "kind": { "type": "string", "minLength": 1, "maxLength": 64 },
                "prefix": { "type": "string", "maxLength": 256 },
                "limit": { "type": "integer", "minimum": 1, "maximum": 200 }
            })),
            read_only: true,
            destructive: false,
            idempotent: true,
            open_world: false,
        },
        ToolSpec {
            name: METADATA_LIVE,
            title: "Inspect live database metadata",
            description: "Read current databases, schemas, relations, collections, columns, indexes, or constraints from a saved connection without opening Desktop. Database and connection grants, deadline, page size, and response-size limits apply. No SQL or row values are accepted.",
            input_schema: required_object_schema(json!({
                "connectionId": { "type": "string", "minLength": 1, "maxLength": 128 },
                "kind": { "type": "string", "enum": ["databases", "schemas", "relations", "collections", "columns", "indexes", "constraints"] },
                "database": { "type": "string", "minLength": 1, "maxLength": 256 },
                "schema": { "type": "string", "minLength": 1, "maxLength": 256 },
                "relation": { "type": "string", "minLength": 1, "maxLength": 512 },
                "prefix": { "type": "string", "maxLength": 256 },
                "offset": { "type": "integer", "minimum": 0, "maximum": 1000000 },
                "limit": { "type": "integer", "minimum": 1, "maximum": 200 }
            }), ["kind"]),
            read_only: true,
            destructive: false,
            idempotent: true,
            open_world: false,
        },
        ToolSpec {
            name: QUERY_READ_ONLY,
            title: "Run a read-only SQL query",
            description: "Run one backend-validated SELECT, TABLE, VALUES, or read-only CTE through the selected driver's read-only execution path. OxideStudio enforces the project/connection/database grant, timeout, row cap, and response-size cap.",
            input_schema: required_object_schema(
                json!({
                    "connectionId": { "type": "string", "minLength": 1, "maxLength": 128 },
                    "sql": { "type": "string", "minLength": 1, "maxLength": 200000 },
                    "database": { "type": "string", "minLength": 1, "maxLength": 256 },
                    "schema": { "type": "string", "minLength": 1, "maxLength": 256 },
                    "maxRows": { "type": "integer", "minimum": 1, "maximum": 1000 }
                }),
                ["sql"],
            ),
            read_only: true,
            destructive: false,
            idempotent: true,
            open_world: false,
        },
        ToolSpec {
            name: QUERY_EXPLAIN_ESTIMATE,
            title: "Estimate a SQL execution plan",
            description: "Build and execute only an estimated EXPLAIN for one backend-validated read-only SQL query. EXPLAIN ANALYZE is intentionally unavailable.",
            input_schema: required_object_schema(
                json!({
                    "connectionId": { "type": "string", "minLength": 1, "maxLength": 128 },
                    "sql": { "type": "string", "minLength": 1, "maxLength": 200000 },
                    "database": { "type": "string", "minLength": 1, "maxLength": 256 },
                    "schema": { "type": "string", "minLength": 1, "maxLength": 256 }
                }),
                ["sql"],
            ),
            read_only: true,
            destructive: false,
            idempotent: true,
            open_world: false,
        },
        ToolSpec {
            name: DOCUMENT_FIND,
            title: "Find documents read-only",
            description: "Read a bounded MongoDB document page using an explicit database and collection, reviewed find predicates, ordered field sorts and inclusion/exclusion projection. Returns canonical Extended JSON. Commands, aggregation pipelines and server-side scripts are unavailable. Offset pages are live reads and do not provide a snapshot across calls. Project, connection, database, tool, row, byte and timeout grants apply.",
            input_schema: required_object_schema(json!({
                "connectionId": {"type":"string", "minLength":1, "maxLength":128},
                "database": {"type":"string", "minLength":1, "maxLength":64},
                "collection": {"type":"string", "minLength":1, "maxLength":256},
                "filter": {"type":"object", "description":"A find predicate, up to 32 KiB total query input. Scripts and expression operators are rejected."},
                "sort": {"type":"array", "maxItems":8, "items": {"type":"object", "properties":{
                    "field":{"type":"string", "minLength":1, "maxLength":256},
                    "direction":{"type":"integer", "enum":[1,-1]}
                }, "required":["field","direction"], "additionalProperties":false}},
                "projection": {"type":"object", "maxProperties":64, "additionalProperties":{"oneOf":[{"type":"boolean"},{"type":"integer","enum":[0,1]}]}},
                "offset": {"type":"integer", "minimum":0, "maximum":1000000},
                "limit": {"type":"integer", "minimum":1, "maximum":1000, "default":50}
            }), ["collection"]),
            read_only: true,
            destructive: false,
            idempotent: true,
            open_world: false,
        },
        ToolSpec {
            name: LSP_SQL_CONTEXT,
            title: "Inspect headless SQL completion context",
            description: "Parse SQL without opening an editor and return the completion context at a byte cursor. Optional cached object candidates stay inside the granted project and connection.",
            input_schema: required_object_schema(
                json!({
                    "connectionId": { "type": "string", "minLength": 1, "maxLength": 128 },
                    "sql": { "type": "string", "maxLength": 200000 },
                    "cursorByte": { "type": "integer", "minimum": 0, "maximum": 200000 },
                    "candidateLimit": { "type": "integer", "minimum": 1, "maximum": 100 }
                }),
                ["sql", "cursorByte"],
            ),
            read_only: true,
            destructive: false,
            idempotent: true,
            open_world: false,
        },
    ]
}

pub fn find(name: &str) -> Option<ToolSpec> {
    all().into_iter().find(|tool| tool.name == name)
}

fn object_schema(properties: Value) -> Value {
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": properties,
        "additionalProperties": false
    })
}

fn required_object_schema<const N: usize>(properties: Value, required: [&str; N]) -> Value {
    let required = required.to_vec();
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": false
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_catalog_is_read_only_and_has_closed_schemas() {
        let tools = all();
        assert_eq!(tools.len(), 7);
        assert!(tools.iter().all(|tool| tool.read_only && !tool.destructive));
        assert!(tools.iter().all(|tool| {
            tool.input_schema.get("additionalProperties") == Some(&Value::Bool(false))
        }));
    }
}
