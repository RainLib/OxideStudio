use super::super::*;
use super::support::*;
use crate::core::protocol::DEFAULT_QUERY_RESULT_ROW_LIMIT;
use reqwest::Method;
use serde_json::json;
use serde_json::Value;

#[test]
fn normalizes_search_hits_for_grid_display() {
    let value = json!({
        "hits": {
            "hits": [
                {"_index": "users", "_id": "1", "_score": 1.0, "_source": {"name": "Ada"}}
            ]
        }
    });

    assert_eq!(
        normalize_elasticsearch_response(value),
        json!([{
            "_index": "users",
            "_id": "1",
            "_score": 1.0,
            "name": "Ada"
        }])
    );
}

#[test]
fn normalizes_eql_events_and_flattens_nested_source_fields() {
    let value = json!({
        "hits": {
            "events": [{
                "_index": "events",
                "_id": "42",
                "_source": {
                    "event": {"category": "process"},
                    "tags": ["prod", "linux"]
                }
            }]
        }
    });

    assert_eq!(
        normalize_elasticsearch_response(value),
        json!([{
            "_index": "events",
            "_id": "42",
            "_score": null,
            "event.category": "process",
            "tags": ["prod", "linux"]
        }])
    );
}

#[test]
fn converts_search_hits_to_tabular_result() {
    let value = normalize_elasticsearch_response(json!({
        "hits": {
            "hits": [
                {"_index": "users", "_id": "1", "_score": 1.0, "_source": {"name": "Ada"}},
                {"_index": "users", "_id": "2", "_score": 0.8, "_source": {"name": "Grace"}}
            ]
        }
    }));
    let result = elasticsearch_table_result(&value).unwrap();

    assert_eq!(
        result
            .columns
            .iter()
            .map(|column| column.name.as_str())
            .collect::<Vec<_>>(),
        vec!["_index", "_id", "_score", "name"]
    );
    assert_eq!(result.rows.len(), 2);
    assert_eq!(result.rows[0][0], json!("users"));
    assert_eq!(result.rows[1][3], json!("Grace"));
    assert!(result.response_meta.is_none());
}

#[test]
fn preserves_size_zero_aggregations_and_converts_buckets_to_rows() {
    let response = json!({
        "hits": { "hits": [] },
        "aggregations": {
            "by_category": {
                "buckets": [
                    {
                        "key": "books",
                        "doc_count": 2,
                        "average_price": { "value": 12.5 }
                    },
                    {
                        "key": "music",
                        "doc_count": 1,
                        "average_price": { "value": null }
                    }
                ]
            }
        }
    });

    let normalized = normalize_elasticsearch_response(response.clone());
    assert_eq!(normalized, response);
    let result = elasticsearch_aggregation_table_result(&normalized).unwrap();

    assert_eq!(
        result
            .columns
            .iter()
            .map(|column| column.name.as_str())
            .collect::<Vec<_>>(),
        vec!["key", "doc_count", "average_price"]
    );
    assert_eq!(
        result.rows,
        vec![
            vec![json!("books"), json!(2), json!(12.5)],
            vec![json!("music"), json!(1), Value::Null],
        ]
    );
    assert!(!result.truncated);
}

#[tokio::test]
async fn executes_size_zero_aggregation_as_a_tabular_query_result() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let response = json!({
        "hits": { "hits": [] },
        "aggregations": {
            "by_status": {
                "buckets": [{ "key": "open", "doc_count": 4 }]
            }
        }
    });
    let server = serve_test_http_responses(listener, vec![(200, response.to_string())]);
    let driver = ElasticsearchDriver::new(&format!("http://{address}")).unwrap();
    *driver.connected.lock().await = true;

    let results = driver
        .execute_requests(
            vec![ElasticsearchRequest {
                method: Method::POST,
                path: "/tickets/_search".to_string(),
                body: Some(r#"{ "size": 0 }"#.to_string()),
            }],
            None,
        )
        .await
        .unwrap();

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].rows, vec![vec![json!("open"), json!(4)]]);
    assert_eq!(
        results[0]
            .response_meta
            .as_ref()
            .map(|meta| meta.raw_response.clone()),
        Some(response)
    );
    let requests = server.await.unwrap();
    assert_eq!(requests.len(), 1);
    assert!(requests[0].starts_with("POST /tickets/_search "));
}

#[test]
fn converts_scalar_and_keyed_aggregation_results_without_raw_json_fallback() {
    let scalar = elasticsearch_aggregation_table_result(&json!({
        "aggs": {
            "average_price": { "value": 18.25 },
            "max_price": { "value": 50 }
        }
    }))
    .unwrap();
    assert_eq!(
        scalar
            .columns
            .iter()
            .map(|column| column.name.as_str())
            .collect::<Vec<_>>(),
        vec!["average_price", "max_price"]
    );
    assert_eq!(scalar.rows, vec![vec![json!(18.25), json!(50)]]);

    let keyed = elasticsearch_aggregation_table_result(&json!({
        "aggregations": {
            "price_ranges": {
                "buckets": {
                    "cheap": { "doc_count": 3 },
                    "premium": { "doc_count": 1 }
                }
            }
        }
    }))
    .unwrap();
    assert_eq!(
        keyed.rows,
        vec![
            vec![json!("cheap"), json!(3)],
            vec![json!("premium"), json!(1)],
        ]
    );
}

#[test]
fn keeps_the_source_name_when_multiple_bucket_aggregations_share_columns() {
    let result = elasticsearch_aggregation_table_result(&json!({
        "aggregations": {
            "by_priority": { "buckets": [{ "key": "high", "doc_count": 2 }] },
            "by_status": { "buckets": [{ "key": "open", "doc_count": 4 }] }
        }
    }))
    .unwrap();

    assert_eq!(
        result
            .columns
            .iter()
            .map(|column| column.name.as_str())
            .collect::<Vec<_>>(),
        vec!["aggregation", "key", "doc_count"]
    );
    assert_eq!(
        result.rows,
        vec![
            vec![json!("by_priority"), json!("high"), json!(2)],
            vec![json!("by_status"), json!("open"), json!(4)],
        ]
    );
}

#[test]
fn bounds_large_aggregation_results_at_the_standard_query_limit() {
    let buckets = (0..=DEFAULT_QUERY_RESULT_ROW_LIMIT)
        .map(|index| json!({ "key": index, "doc_count": 1 }))
        .collect::<Vec<_>>();
    let result = elasticsearch_aggregation_table_result(&json!({
        "aggregations": { "by_key": { "buckets": buckets } }
    }))
    .unwrap();

    assert!(result.truncated);
    assert_eq!(result.row_limit, Some(DEFAULT_QUERY_RESULT_ROW_LIMIT));
    assert_eq!(result.rows.len(), DEFAULT_QUERY_RESULT_ROW_LIMIT);
}
