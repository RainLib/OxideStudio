use super::super::*;
use crate::core::driver::DatabaseDriver;
use regex::Regex;
use reqwest::{Method, StatusCode};
use std::collections::HashMap;

#[test]
fn parses_and_strips_elasticsearch_transport_options() {
    let mut url = normalize_elasticsearch_base_url(
            "http://localhost:5601/root?mode=kibana&kibanaBasePath=%2Fkibana%2Fs%2Fanalytics%2F&connectivityCheckPath=GET%20logs-%2A%2F_search&connectivityCheckDisabled=yes&indexGroupingPattern=%5B-_%5D%5Cd%2B",
        )
        .unwrap();
    let options = elasticsearch_connection_options(&url).unwrap();

    assert_eq!(
        options.transport_mode,
        ElasticsearchTransportMode::KibanaProxy
    );
    assert_eq!(options.kibana_base_path, "/kibana/s/analytics");
    assert_eq!(options.connectivity_check_path, "/logs-*/_search");
    assert!(options.connectivity_check_disabled);
    assert_eq!(
        options.index_grouping.as_ref().map(Regex::as_str),
        Some("[-_]\\d+")
    );

    strip_elasticsearch_internal_query_parameters(&mut url);
    assert!(url.query().is_none());
    append_elasticsearch_base_path(&mut url, &options.kibana_base_path).unwrap();
    assert_eq!(
        url.as_str(),
        "http://localhost:5601/root/kibana/s/analytics"
    );
}

#[test]
fn normalizes_connectivity_paths_and_rejects_remote_targets() {
    assert_eq!(
        normalize_elasticsearch_connectivity_check_path("GET my-index/_search\n{\"query\":{}}")
            .unwrap(),
        "/my-index/_search"
    );
    assert_eq!(
        normalize_elasticsearch_connectivity_check_path("").unwrap(),
        "/"
    );
    assert!(normalize_elasticsearch_connectivity_check_path("https://example.com/").is_err());
    assert!(normalize_kibana_base_path("/../admin").is_err());
}

#[test]
fn builds_kibana_console_proxy_target_and_uses_proxy_status() {
    let driver = ElasticsearchDriver::new(
        "http://localhost:5601?mode=kibana&kibanaBasePath=%2Fs%2Fanalytics",
    )
    .unwrap();
    let request = ElasticsearchRequest {
        method: Method::DELETE,
        path: "/logs-2026/_doc/1?refresh=true".to_string(),
        body: None,
    };
    let (method, url) = driver.request_target(&request).unwrap();

    assert_eq!(method, Method::POST);
    assert_eq!(url.path(), "/s/analytics/api/console/proxy");
    let query = url.query_pairs().collect::<HashMap<_, _>>();
    assert_eq!(
        query.get("path").map(|value| value.as_ref()),
        Some("/logs-2026/_doc/1?refresh=true")
    );
    assert_eq!(
        query.get("method").map(|value| value.as_ref()),
        Some("DELETE")
    );

    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(KIBANA_PROXY_STATUS_HEADER, "404".parse().unwrap());
    assert_eq!(
        elasticsearch_effective_response_status(
            ElasticsearchTransportMode::KibanaProxy,
            StatusCode::OK,
            &headers,
        ),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        elasticsearch_effective_response_status(
            ElasticsearchTransportMode::Direct,
            StatusCode::OK,
            &headers,
        ),
        StatusCode::OK
    );

    let transport_request = driver
        .build_transport_request(&ElasticsearchRequest {
            method: Method::POST,
            path: "/_bulk".to_string(),
            body: Some("{\"index\":{}}\n{\"message\":\"ok\"}".to_string()),
        })
        .unwrap();
    assert_eq!(transport_request.method(), Method::POST);
    assert_eq!(
        transport_request
            .headers()
            .get("kbn-xsrf")
            .and_then(|value| value.to_str().ok()),
        Some("true")
    );
    assert_eq!(
        transport_request
            .headers()
            .get("osd-xsrf")
            .and_then(|value| value.to_str().ok()),
        Some("true")
    );
    assert_eq!(
        transport_request
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok()),
        Some("application/x-ndjson")
    );
    assert!(transport_request
        .body()
        .and_then(reqwest::Body::as_bytes)
        .is_some_and(|body| body.ends_with(b"\n")));
}

#[tokio::test]
async fn disabled_connectivity_check_marks_driver_connected_without_version_probe() {
    let mut driver =
        ElasticsearchDriver::new("http://127.0.0.1:9?connectivityCheckDisabled=true").unwrap();

    driver.connect().await.unwrap();
    assert!(driver.server_version().await.is_none());
    driver.ping().await.unwrap();
}
