use super::super::*;
use super::support::*;
use reqwest::StatusCode;
use serde_json::json;
use std::sync::atomic::Ordering;

#[test]
fn classifies_only_explicit_pit_shard_doc_compatibility_failures() {
    assert!(elasticsearch_response_lacks_pit_shard_doc(
        StatusCode::BAD_REQUEST,
        &missing_pit_shard_doc_response()
    ));
    assert!(!elasticsearch_response_lacks_pit_shard_doc(
        StatusCode::UNAUTHORIZED,
        &missing_pit_shard_doc_response()
    ));
    assert!(!elasticsearch_response_lacks_pit_shard_doc(
        StatusCode::BAD_REQUEST,
        &json!({
            "error": {
                "type": "query_shard_exception",
                "reason": "No mapping found for [customer_id] in order to sort on"
            }
        })
    ));
    assert!(!elasticsearch_response_lacks_pit_shard_doc(
        StatusCode::SERVICE_UNAVAILABLE,
        &json!({
            "error": {
                "type": "search_phase_execution_exception",
                "reason": "_shard_doc temporarily unavailable"
            }
        })
    ));
}

#[tokio::test]
async fn missing_pit_shard_doc_falls_back_and_is_remembered_for_connection() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = serve_test_http_responses(
        listener,
        vec![
            (200, json!({ "id": "pit-1" }).to_string()),
            (400, missing_pit_shard_doc_response().to_string()),
            (200, json!({ "succeeded": true }).to_string()),
            (200, test_document_page_response(2)),
            (200, test_document_page_response(1)),
        ],
    );
    let driver = ElasticsearchDriver::new(&format!("http://{address}")).unwrap();
    *driver.connected.lock().await = true;

    let first = driver
        .first_document_page("products", 1, None, None)
        .await
        .unwrap();
    let cursor =
        decode_elasticsearch_document_cursor(first.next_cursor.as_deref().unwrap()).unwrap();
    assert!(matches!(
        cursor,
        ElasticsearchDocumentCursor::Offset { offset: 1, .. }
    ));
    assert!(!driver.pit_shard_doc_supported.load(Ordering::Relaxed));

    driver
        .first_document_page("products", 1, None, None)
        .await
        .unwrap();
    let requests = server.await.unwrap();
    assert_eq!(requests.len(), 5);
    assert!(requests[0].starts_with("POST /products/_pit?keep_alive=1m "));
    assert!(requests[1].starts_with("POST /_search "));
    assert!(requests[1].contains("_shard_doc"));
    assert!(requests[2].starts_with("DELETE /_pit "));
    assert!(requests[3].starts_with("POST /products/_search "));
    assert!(!requests[3].contains("_shard_doc"));
    assert!(requests[3].contains(r#""from":0"#));
    assert!(requests[4].starts_with("POST /products/_search "));
    assert!(!requests[4].contains("_shard_doc"));
}

#[tokio::test]
async fn unrelated_pit_search_failure_is_not_retried_or_remembered() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = serve_test_http_responses(
        listener,
        vec![
            (200, json!({ "id": "pit-1" }).to_string()),
            (
                400,
                json!({
                    "error": {
                        "type": "query_shard_exception",
                        "reason": "No mapping found for [customer_id] in order to sort on"
                    },
                    "status": 400
                })
                .to_string(),
            ),
            (200, json!({ "succeeded": true }).to_string()),
        ],
    );
    let driver = ElasticsearchDriver::new(&format!("http://{address}")).unwrap();
    *driver.connected.lock().await = true;

    let error = driver
        .first_document_page("products", 1, None, None)
        .await
        .unwrap_err();
    let requests = server.await.unwrap();
    assert!(error.to_string().contains("customer_id"));
    assert_eq!(requests.len(), 3);
    assert!(driver.pit_shard_doc_supported.load(Ordering::Relaxed));
}

#[test]
fn document_cursor_round_trips_without_exposing_raw_pit_json() {
    let cursor = ElasticsearchDocumentCursor::Pit {
        pit_id: "pit/opaque+value".to_string(),
        index: "orders".to_string(),
        search_after: vec![json!(42), json!("shard")],
        sort: vec![
            json!({ "created_at": "desc" }),
            json!({ "_shard_doc": "asc" }),
        ],
        limit: 250,
        filter: Some(json!({ "term": { "tenant": "acme" } })),
    };

    let encoded = encode_elasticsearch_document_cursor(&cursor).unwrap();
    assert!(!encoded.contains("pit/opaque"));
    assert_eq!(
        decode_elasticsearch_document_cursor(&encoded).unwrap(),
        cursor
    );
}

#[test]
fn pit_search_body_uses_stable_tiebreaker_and_continuation() {
    let sort = parse_elasticsearch_document_sort(Some(r#"[{"created_at":"desc"}]"#), true).unwrap();
    assert_eq!(sort.last(), Some(&json!({ "_shard_doc": "asc" })));

    let body = build_elasticsearch_document_search_body(
        100,
        Some(&json!({ "match_all": {} })),
        &sort,
        Some("pit-1"),
        Some(&[json!("2026-08-30"), json!(7)]),
        None,
    );
    assert_eq!(body["size"], 100);
    assert_eq!(body["pit"]["id"], "pit-1");
    assert_eq!(body["search_after"], json!(["2026-08-30", 7]));
    assert!(body.get("from").is_none());
}

#[test]
fn document_total_accepts_legacy_and_object_shapes() {
    assert_eq!(
        elasticsearch_document_total(&json!({ "hits": { "total": 12, "hits": [] } })),
        Some(12)
    );
    assert_eq!(
        elasticsearch_document_total(
            &json!({ "hits": { "total": { "value": 34, "relation": "eq" }, "hits": [] } })
        ),
        Some(34)
    );
}
