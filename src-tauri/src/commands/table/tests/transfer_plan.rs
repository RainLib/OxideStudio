use super::*;

#[tokio::test]
async fn data_transfer_rejects_an_endpoint_driver_that_does_not_match_the_live_connection() {
    let manager = ConnectionManager::new();
    manager
        .replace_connection_with_tunnel_and_driver_id(
            "source".to_string(),
            Box::new(PreviewTargetDriver),
            None,
            Some("postgres".to_string()),
        )
        .await
        .unwrap();
    let endpoint = TableDataTransferEndpoint {
        connection_id: "source".to_string(),
        driver: "mysql".to_string(),
        schema: "public".to_string(),
        table: "events".to_string(),
        database: None,
    };

    let error = ensure_transfer_endpoint_driver_matches_connection(&manager, &endpoint)
        .await
        .unwrap_err();
    assert!(error.contains("does not match"));
}
