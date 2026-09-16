use super::super::*;
use crate::core::protocol::CollectionInfo;
use regex::Regex;
use serde_json::json;

#[test]
fn groups_rolling_index_collections_and_preserves_document_counts() {
    let pattern = Regex::new(r"[-_.@]\d{4}[-_.]?\d{2}[-_.]?\d{2}.*$").unwrap();
    let collections = elasticsearch_indices_to_collections(json!([
        { "index": ".security-7", "docs.count": "1" },
        { "index": "logs-2026.08.10", "docs.count": "7" },
        { "index": "logs-2026.08.11", "docs.count": "11" },
        { "index": "orders-2026.08.10", "docs.count": "3" }
    ]));

    let grouped = group_elasticsearch_collections(collections, Some(&pattern));
    assert_eq!(
        grouped
            .iter()
            .map(|collection| (collection.name.as_str(), collection.document_count))
            .collect::<Vec<_>>(),
        vec![("logs*", Some(18)), ("orders*", Some(3))]
    );
}

#[test]
fn resolves_visible_indices_and_data_streams_without_cluster_monitor() {
    let collections = elasticsearch_resolve_to_collections(&json!({
        "indices": [{ "name": "logs-2026.08.11" }, { "name": ".kibana" }],
        "data_streams": [{ "name": "metrics-prod" }]
    }));

    assert_eq!(
        collections
            .iter()
            .map(|collection| collection.name.as_str())
            .collect::<Vec<_>>(),
        vec!["logs-2026.08.11", "metrics-prod"]
    );
    assert_eq!(
        collections
            .iter()
            .map(|collection| collection.collection_type.as_deref())
            .collect::<Vec<_>>(),
        vec![Some("index"), Some("data_stream")]
    );

    let aliases = elasticsearch_alias_to_collections(&json!({
        ".security": {},
        "logs-2026.08.11": {},
        "orders": {}
    }));
    assert_eq!(
        aliases
            .iter()
            .map(|collection| collection.name.as_str())
            .collect::<Vec<_>>(),
        vec!["logs-2026.08.11", "orders"]
    );
    assert!(aliases
        .iter()
        .all(|collection| collection.collection_type.as_deref() == Some("alias")));
}

#[test]
fn merges_index_counts_with_typed_alias_and_data_stream_descriptors() {
    let merged = merge_elasticsearch_collections(
        elasticsearch_indices_to_collections(json!([
            { "index": "orders", "docs.count": "42" }
        ])),
        elasticsearch_resolve_to_collections(&json!({
            "indices": [{ "name": "orders" }],
            "aliases": [{ "name": "orders-read" }],
            "data_streams": [{ "name": "logs-prod" }]
        })),
    );
    assert_eq!(
        merged
            .iter()
            .map(|collection| (
                collection.name.as_str(),
                collection.collection_type.as_deref(),
                collection.document_count,
            ))
            .collect::<Vec<_>>(),
        vec![
            ("logs-prod", Some("data_stream"), None),
            ("orders", Some("index"), Some(42)),
            ("orders-read", Some("alias"), None),
        ]
    );
}

#[test]
fn grouping_patterns_do_not_rewrite_aliases_or_data_streams() {
    let pattern = Regex::new(r"-\d{4}\.\d{2}\.\d{2}$").unwrap();
    let grouped = group_elasticsearch_collections(
        vec![
            CollectionInfo {
                name: "logs-2026.08.11".to_string(),
                namespace: Some("default".to_string()),
                collection_type: Some("index".to_string()),
                document_count: Some(5),
            },
            CollectionInfo {
                name: "logs-read".to_string(),
                namespace: Some("default".to_string()),
                collection_type: Some("alias".to_string()),
                document_count: None,
            },
            CollectionInfo {
                name: "logs-stream".to_string(),
                namespace: Some("default".to_string()),
                collection_type: Some("data_stream".to_string()),
                document_count: None,
            },
        ],
        Some(&pattern),
    );
    assert_eq!(
        grouped
            .iter()
            .map(|collection| (
                collection.name.as_str(),
                collection.collection_type.as_deref()
            ))
            .collect::<Vec<_>>(),
        vec![
            ("logs*", Some("index")),
            ("logs-read", Some("alias")),
            ("logs-stream", Some("data_stream")),
        ]
    );
}

#[test]
fn reads_optional_index_grouping_pattern_from_connection_url() {
    let url = normalize_elasticsearch_base_url(
        "http://localhost:9200?indexGroupingPattern=%5B-_%5D%5Cd%2B&ssl=disable",
    )
    .unwrap();
    assert_eq!(
        elasticsearch_index_grouping_pattern(&url)
            .as_ref()
            .map(|pattern| pattern.as_str()),
        Some("[-_]\\d+")
    );
    assert!(elasticsearch_index_grouping_pattern(
        &normalize_elasticsearch_base_url("http://localhost:9200?indexGroupingPattern=off")
            .unwrap()
    )
    .is_none());
}
