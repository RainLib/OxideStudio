use super::super::*;
use crate::core::driver::DatabaseDriver;
use reqwest::{Method, Url};
use serde_json::json;
use serde_json::Value;

#[test]
fn parses_json_body_as_default_search() {
    let requests = parse_elasticsearch_requests(r#"{"query":{"match_all":{}}}"#).unwrap();

    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].method, Method::POST);
    assert_eq!(requests[0].path, "/_search");
    assert!(requests[0].body.as_deref().unwrap().contains("match_all"));
}

#[test]
fn scopes_default_search_to_active_index() {
    let request = parse_elasticsearch_requests(r#"{"query":{"match_all":{}}}"#)
        .unwrap()
        .remove(0);
    let scoped = scope_search_request_to_index(request, Some("user events"));

    assert_eq!(scoped.path, "/user%20events/_search");

    let eql = ElasticsearchRequest {
        method: Method::POST,
        path: "/_eql/search".to_string(),
        body: Some(r#"{"query":"process where true"}"#.to_string()),
    };
    let eql = scope_search_request_to_index(eql, Some("events"));
    assert_eq!(eql.path, "/events/_eql/search");

    let explicit = parse_elasticsearch_requests(
        r#"
            GET /users/_search
            {"query":{"match_all":{}}}
            "#,
    )
    .unwrap()
    .remove(0);
    let explicit = scope_search_request_to_index(explicit, Some("orders"));

    assert_eq!(explicit.path, "/users/_search");
}

#[test]
fn rewrites_typeless_document_paths_for_elasticsearch_six() {
    assert_eq!(
        rewrite_elasticsearch_six_document_path("/events/_doc/42", "event"),
        "/events/event/42"
    );
    assert_eq!(
        rewrite_elasticsearch_six_document_path("/events/_update/42?refresh=wait_for", "event",),
        "/events/event/42/_update?refresh=wait_for"
    );
    assert_eq!(
        rewrite_elasticsearch_six_document_path("/events/_doc", "event log"),
        "/events/event%20log"
    );
}

#[tokio::test]
async fn prepares_document_paths_for_elasticsearch_six_seven_and_eight() {
    for (version, major, expected_path) in [
        ("6.8.23", 6, "/events/event/42"),
        ("7.17.29", 7, "/events/_doc/42"),
        ("8.19.4", 8, "/events/_doc/42"),
    ] {
        let driver = ElasticsearchDriver::new("http://localhost:9200").unwrap();
        *driver.server_info.lock().await = Some(ElasticsearchServerInfo {
            version: version.to_string(),
            major,
        });
        driver
            .mapping_types
            .lock()
            .await
            .insert("events".to_string(), "event".to_string());

        let prepared = driver
            .prepare_request_for_server(ElasticsearchRequest {
                method: Method::GET,
                path: "/events/_doc/42".to_string(),
                body: None,
            })
            .await
            .unwrap();
        assert_eq!(prepared.path, expected_path, "Elasticsearch {version}");
    }
}

#[test]
fn validates_index_context_without_treating_default_as_index() {
    assert_eq!(validate_elasticsearch_index_context("").unwrap(), None);
    assert_eq!(
        validate_elasticsearch_index_context(" default ").unwrap(),
        None
    );
    assert_eq!(
        validate_elasticsearch_index_context("logs-2026").unwrap(),
        Some("logs-2026".to_string())
    );
    assert!(validate_elasticsearch_index_context("logs/2026").is_err());
}

#[tokio::test]
async fn tracks_active_index_context() {
    let driver = ElasticsearchDriver::new("http://localhost:9200").unwrap();

    assert_eq!(driver.active_index_name().await, None);
    *driver.connected.lock().await = true;
    driver.set_current_schema("logs-2026").await.unwrap();
    assert_eq!(
        driver.active_index_name().await,
        Some("logs-2026".to_string())
    );
    driver.set_current_schema("default").await.unwrap();
    assert_eq!(driver.active_index_name().await, None);
}

#[tokio::test]
async fn disconnect_marks_driver_unavailable_and_clears_active_index() {
    let driver = ElasticsearchDriver::new("http://localhost:9200").unwrap();
    *driver.connected.lock().await = true;
    *driver.active_index.lock().await = Some("logs-2026".to_string());

    driver.disconnect().await.unwrap();

    assert!(!*driver.connected.lock().await);
    assert_eq!(driver.active_index_name().await, None);
    assert!(driver.ping().await.is_err());
    assert!(driver.get_schemas().await.is_err());
}

#[test]
fn parses_http_style_elasticsearch_requests() {
    let requests = parse_elasticsearch_requests(
        r#"
            GET /_cluster/health
            POST users/_search
            {"query":{"term":{"active":true}}}
            "#,
    )
    .unwrap();

    assert_eq!(requests.len(), 2);
    assert_eq!(requests[0].method, Method::GET);
    assert_eq!(requests[0].path, "/_cluster/health");
    assert_eq!(requests[0].body, None);
    assert_eq!(requests[1].method, Method::POST);
    assert_eq!(requests[1].path, "/users/_search");
    assert!(requests[1].body.as_deref().unwrap().contains("active"));
}

#[test]
fn strips_console_comments_without_changing_json_strings() {
    let requests = parse_elasticsearch_requests(
        r#"
            # GET /ignored
            /*
            POST /also-ignored/_search
            {}
            */
            POST /users/_search
            {
              // Search only the API URL stored in the document.
              "url": "https://example.test/path#fragment",
              "query": {"match_all": {}}
            }
            "#,
    )
    .unwrap();

    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].path, "/users/_search");
    let body = requests[0].body.as_deref().unwrap();
    assert!(!body.contains("Search only"));
    assert!(body.contains("https://example.test/path#fragment"));
    assert!(serde_json::from_str::<Value>(body).is_ok());
}

#[test]
fn rejects_invalid_request_lines() {
    assert!(parse_elasticsearch_requests("GET").is_err());
    assert!(parse_elasticsearch_requests("GET https://other.test/_search").is_err());
    assert!(parse_elasticsearch_requests("not-json").is_err());
}

#[test]
fn validates_and_terminates_ndjson_request_bodies() {
    assert!(is_elasticsearch_ndjson_path("/logs/_bulk?refresh=true"));
    assert!(is_elasticsearch_ndjson_path("/_msearch/template"));
    assert!(!is_elasticsearch_ndjson_path("/logs/_search"));

    let normalized = normalize_elasticsearch_ndjson_body(
        "{\"index\":{\"_index\":\"logs\"}}\n{\"message\":\"ok\"}",
    )
    .unwrap();
    assert!(normalized.ends_with('\n'));
    assert_eq!(normalized.lines().count(), 2);
    assert!(normalize_elasticsearch_ndjson_body("{invalid}").is_err());
    assert!(normalize_elasticsearch_ndjson_body("\n\n").is_err());
}

#[test]
fn extracts_basic_auth_from_url() {
    let mut url = Url::parse("http://service%24account:p%40ss%3Aword@localhost:9200").unwrap();
    assert_eq!(
        extract_basic_auth(&mut url).unwrap(),
        Some(("service$account".to_string(), "p@ss:word".to_string()))
    );
    assert_eq!(url.as_str(), "http://localhost:9200/");
}

#[test]
fn normalizes_https_alias_and_removes_internal_ssl_parameter() {
    let url = normalize_elasticsearch_base_url(
        "elasticsearch://reader:encoded@search.example.test:9200?ssl=require&request_cache=true",
    )
    .unwrap();

    assert_eq!(url.scheme(), "https");
    assert_eq!(url.query(), Some("request_cache=true"));
}

#[test]
fn detects_supported_server_versions() {
    for (version, major) in [("6.8.23", 6), ("7.17.29", 7), ("8.19.4", 8)] {
        let info = parse_elasticsearch_server_info(&json!({
            "version": { "number": version }
        }))
        .unwrap();
        assert_eq!(info.version, version);
        assert_eq!(info.major, major);
    }

    assert!(parse_elasticsearch_server_info(&json!({
        "version": { "number": "5.6.16" }
    }))
    .unwrap_err()
    .to_string()
    .contains("supported major versions are 6, 7, and 8"));
}
