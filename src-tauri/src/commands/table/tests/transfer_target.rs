use super::*;

#[test]
fn transfer_target_confirmation_is_bound_to_the_generated_ddl() {
    let request = TableDataTransferTargetPlanRequest {
        source: TableDataTransferEndpoint {
            connection_id: "source".to_string(),
            driver: "postgres".to_string(),
            schema: "public".to_string(),
            table: "events".to_string(),
            database: None,
        },
        target: TableDataTransferEndpoint {
            connection_id: "target".to_string(),
            driver: "mysql".to_string(),
            schema: "app".to_string(),
            table: "events_copy".to_string(),
            database: None,
        },
    };
    let columns = vec![TableDataTransferTargetColumn {
        name: "id".to_string(),
        source_data_type: "uuid".to_string(),
        target_data_type: "VARCHAR".to_string(),
        target_length: Some("36".to_string()),
        is_primary_key: true,
        is_not_null: true,
        source_auto_increment: false,
        source_identity_generation: None,
        identity_retained: false,
        target_identity_generation: None,
        has_source_default: false,
        default_retained: false,
        compatibility: TableDataTransferCompatibility::Review,
        reason: "mapped".to_string(),
    }];
    let first = transfer_target_confirmation_token(
        &request,
        &columns,
        &["CREATE TABLE events_copy (id VARCHAR(36));".to_string()],
    )
    .unwrap();
    let changed = transfer_target_confirmation_token(
        &request,
        &columns,
        &["CREATE TABLE events_copy (id TEXT);".to_string()],
    )
    .unwrap();
    let mut identity_columns = columns.clone();
    identity_columns[0].source_auto_increment = true;
    identity_columns[0].identity_retained = true;
    let identity_changed = transfer_target_confirmation_token(
        &request,
        &identity_columns,
        &["CREATE TABLE events_copy (id VARCHAR(36));".to_string()],
    )
    .unwrap();
    assert!(first.starts_with("CREATE "));
    assert_ne!(first, changed);
    assert_ne!(first, identity_changed);
}

#[tokio::test]
async fn sqlite_target_plan_uses_catalog_table_and_index_definitions() {
    let manager = ConnectionManager::new();
    let mut source = SqliteDriver::new(":memory:");
    source.connect().await.unwrap();
    source
            .query(
                "CREATE TABLE events (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES events(id) ON DELETE CASCADE, label TEXT CHECK (length(label) > 0)) STRICT; CREATE INDEX events_label_idx ON events (lower(label)) WHERE label IS NOT NULL;",
            )
            .await
            .unwrap();
    let mut target = SqliteDriver::new(":memory:");
    target.connect().await.unwrap();
    manager
        .add_connection("sqlite-source".to_string(), Box::new(source))
        .await;
    manager
        .add_connection("sqlite-target".to_string(), Box::new(target))
        .await;

    let plan = resolve_table_data_transfer_target_plan(
        &manager,
        &TableDataTransferTargetPlanRequest {
            source: TableDataTransferEndpoint {
                connection_id: "sqlite-source".to_string(),
                driver: "sqlite".to_string(),
                schema: "main".to_string(),
                table: "events".to_string(),
                database: None,
            },
            target: TableDataTransferEndpoint {
                connection_id: "sqlite-target".to_string(),
                driver: "sqlite".to_string(),
                schema: "main".to_string(),
                table: "events".to_string(),
                database: None,
            },
        },
    )
    .await
    .unwrap();

    assert!(plan.can_execute);
    assert_eq!(plan.statements.len(), 2);
    assert!(plan.statements[0].contains("REFERENCES events(id) ON DELETE CASCADE"));
    assert!(plan.statements[0].contains("CHECK (length(label) > 0)"));
    assert!(plan.statements[0].ends_with(") STRICT;"));
    assert!(plan.statements[1].contains("(lower(label)) WHERE label IS NOT NULL"));
    assert!(plan
        .warnings
        .iter()
        .any(|warning| warning.contains("native SQLite catalog definition")));
}
