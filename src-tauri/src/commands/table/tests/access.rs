use super::*;

#[tokio::test]
async fn preview_helpers_preserve_explicit_database_scope() {
    let manager = ConnectionManager::new();
    manager
        .add_connection("conn".to_string(), Box::new(PreviewTargetDriver))
        .await;

    let primary_columns = get_target_columns(&manager, "conn", None, "public", "events")
        .await
        .unwrap();
    let scoped_columns =
        get_target_columns(&manager, "conn", Some("analytics"), "public", "events")
            .await
            .unwrap();
    assert_eq!(primary_columns[0].name, "primary");
    assert_eq!(scoped_columns[0].name, "analytics");

    let primary_query = query_target(&manager, "conn", None, "SELECT 1")
        .await
        .unwrap();
    let scoped_query = query_target(&manager, "conn", Some("analytics"), "SELECT 1")
        .await
        .unwrap();
    assert_eq!(primary_query[0].statement_type.as_deref(), Some("primary"));
    assert_eq!(scoped_query[0].statement_type.as_deref(), Some("analytics"));

    let params = [QueryParameter {
        value: json!(1),
        data_type: Some("integer".to_string()),
    }];
    let primary_parameterized =
        query_target_parameterized(&manager, "conn", None, "SELECT $1", &params)
            .await
            .unwrap();
    let scoped_parameterized =
        query_target_parameterized(&manager, "conn", Some("analytics"), "SELECT $1", &params)
            .await
            .unwrap();
    assert_eq!(
        primary_parameterized[0].statement_type.as_deref(),
        Some("primary-parameterized")
    );
    assert_eq!(
        scoped_parameterized[0].statement_type.as_deref(),
        Some("analytics-parameterized")
    );

    let statements = [ParameterizedStatement {
        sql: "UPDATE events SET name = $1".to_string(),
        params: Vec::new(),
    }];
    assert_eq!(
        execute_target_parameterized_batch(&manager, "conn", None, &statements)
            .await
            .unwrap(),
        vec![1]
    );
    assert_eq!(
        execute_target_parameterized_batch(&manager, "conn", Some("analytics"), &statements)
            .await
            .unwrap(),
        vec![9]
    );
}

#[tokio::test]
async fn sqlite_target_plan_renames_self_references_and_explicit_indexes() {
    let manager = ConnectionManager::new();
    let mut source = SqliteDriver::new(":memory:");
    source.connect().await.unwrap();
    source
            .query(
                "CREATE TABLE nodes (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES nodes(id), label TEXT CHECK (length(label) > 0)); CREATE INDEX nodes_label_idx ON nodes (lower(label));",
            )
            .await
            .unwrap();
    let mut target = SqliteDriver::new(":memory:");
    target.connect().await.unwrap();
    manager
        .add_connection("sqlite-rename-source".to_string(), Box::new(source))
        .await;
    manager
        .add_connection("sqlite-rename-target".to_string(), Box::new(target))
        .await;

    let plan = resolve_table_data_transfer_target_plan(
        &manager,
        &TableDataTransferTargetPlanRequest {
            source: TableDataTransferEndpoint {
                connection_id: "sqlite-rename-source".to_string(),
                driver: "sqlite".to_string(),
                schema: "main".to_string(),
                table: "nodes".to_string(),
                database: None,
            },
            target: TableDataTransferEndpoint {
                connection_id: "sqlite-rename-target".to_string(),
                driver: "sqlite".to_string(),
                schema: "main".to_string(),
                table: "tree_nodes".to_string(),
                database: None,
            },
        },
    )
    .await
    .unwrap();

    assert!(plan.can_execute);
    assert_eq!(plan.statements.len(), 2);
    assert!(plan.statements[0].starts_with("CREATE TABLE \"main\".\"tree_nodes\""));
    assert!(plan.statements[0].contains("REFERENCES \"tree_nodes\"(id)"));
    assert!(plan.statements[0].contains("CHECK (length(label) > 0)"));
    assert!(plan.statements[1]
        .starts_with("CREATE INDEX \"main\".\"tree_nodes__nodes_label_idx\" ON \"tree_nodes\""));
    for statement in &plan.statements {
        query_target(&manager, "sqlite-rename-target", None, statement)
            .await
            .unwrap();
    }
    let catalog = query_target(
            &manager,
            "sqlite-rename-target",
            None,
            "SELECT type, name, tbl_name FROM main.sqlite_schema WHERE tbl_name = 'tree_nodes' ORDER BY type, name;",
        )
        .await
        .unwrap();
    let rows = catalog
        .iter()
        .flat_map(|result| result.rows.iter())
        .collect::<Vec<_>>();
    assert_eq!(rows.len(), 2);
    assert!(rows.iter().any(|row| {
        row.get(1).and_then(Value::as_str) == Some("tree_nodes__nodes_label_idx")
            && row.get(2).and_then(Value::as_str) == Some("tree_nodes")
    }));
}
