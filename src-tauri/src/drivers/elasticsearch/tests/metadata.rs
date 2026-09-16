use super::super::*;
use crate::core::protocol::SearchIndexMetadataKind;
use reqwest::Method;
use serde_json::json;

#[test]
fn maps_cat_indices_to_collections() {
    let collections = elasticsearch_indices_to_collections(json!([
        {"index": "users", "docs.count": "42"},
        {"index": "orders", "docs.count": "7"}
    ]));

    assert_eq!(collections.len(), 2);
    assert_eq!(collections[0].name, "orders");
    assert_eq!(collections[0].collection_type.as_deref(), Some("index"));
    assert_eq!(collections[0].document_count, Some(7));
}

#[test]
fn maps_index_mapping_to_columns() {
    let columns = elasticsearch_mapping_to_columns(
        &json!({
            "users": {
                "mappings": {
                    "properties": {
                        "email": {"type": "keyword"},
                        "active": {"type": "boolean"},
                        "profile": {
                            "properties": {
                                "age": {"type": "integer"},
                                "bio": {"type": "text", "index": false}
                            }
                        }
                    }
                }
            }
        }),
        "users",
        8,
    );

    let id = columns.iter().find(|column| column.name == "_id").unwrap();
    assert_eq!(id.data_type, "keyword");
    assert!(id.is_primary_key);
    assert!(id.is_unique);

    let email = columns
        .iter()
        .find(|column| column.name == "email")
        .unwrap();
    assert_eq!(email.data_type, "keyword");
    assert!(email.is_indexed);

    let profile = columns
        .iter()
        .find(|column| column.name == "profile")
        .unwrap();
    assert_eq!(profile.data_type, "object");

    let bio = columns
        .iter()
        .find(|column| column.name == "profile.bio")
        .unwrap();
    assert_eq!(bio.data_type, "text");
    assert!(!bio.is_indexed);
}

#[test]
fn maps_elasticsearch_six_typed_mappings_to_columns() {
    let mapping = json!({
        "events": {
            "mappings": {
                "event": {
                    "properties": {
                        "kind": {"type": "keyword"},
                        "created_at": {"type": "date"}
                    }
                }
            }
        }
    });
    assert_eq!(
        elasticsearch_six_mapping_types(&mapping),
        vec!["event".to_string()]
    );
    let columns = elasticsearch_mapping_to_columns(&mapping, "events", 6);

    assert_eq!(
        columns
            .iter()
            .find(|column| column.name == "kind")
            .map(|column| column.data_type.as_str()),
        Some("keyword")
    );
    assert_eq!(
        columns
            .iter()
            .find(|column| column.name == "created_at")
            .map(|column| column.data_type.as_str()),
        Some("date")
    );
}

#[test]
fn validates_and_encodes_bounded_index_management_targets() {
    assert_eq!(
        validate_elasticsearch_index_target("logs-2026.*").unwrap(),
        "logs-2026.*"
    );
    assert_eq!(
        encode_elasticsearch_index_target("logs-????.08"),
        "logs-%3F%3F%3F%3F.08"
    );
    for target in ["", "*", "?", "_all", "logs,orders", "../logs", "Logs"] {
        assert!(
            validate_elasticsearch_index_target(target).is_err(),
            "unexpected valid target: {target}"
        );
    }
}

#[test]
fn builds_closed_metadata_and_clear_transport_contracts() {
    let settings = build_elasticsearch_index_metadata_request(
        "logs-????.08",
        SearchIndexMetadataKind::Settings,
    )
    .unwrap();
    assert_eq!(settings.method, Method::GET);
    assert_eq!(settings.path, "/logs-%3F%3F%3F%3F.08/_settings");
    assert!(settings.body.is_none());

    let clear = build_elasticsearch_index_clear_request("logs-*").unwrap();
    assert_eq!(clear.method, Method::POST);
    assert_eq!(
        clear.path,
        "/logs-*/_delete_by_query?conflicts=proceed&refresh=true"
    );
    assert_eq!(clear.body.as_deref(), Some(r#"{"query":{"match_all":{}}}"#));
}

#[test]
fn parses_delete_by_query_partial_outcome_and_bounds_failure_details() {
    let oversized = "x".repeat(2_100);
    let result = parse_elasticsearch_clear_result(&json!({
        "total": 10,
        "deleted": 8,
        "version_conflicts": 2,
        "timed_out": false,
        "failures": [{"reason": oversized}]
    }))
    .unwrap();

    assert_eq!(result.total, 10);
    assert_eq!(result.deleted, 8);
    assert_eq!(result.version_conflicts, 2);
    assert!(!result.timed_out);
    assert_eq!(result.failures.len(), 1);
    assert!(result.failures[0].chars().count() <= 2_001);
    assert!(parse_elasticsearch_clear_result(&json!({"deleted": 1})).is_err());
}
