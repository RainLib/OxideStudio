use super::*;

#[test]
fn influxdb3_quick_open_has_a_bounded_time_window() {
    assert_eq!(
        default_time_series_preview_filter("influxdb3"),
        Some("time > now() - INTERVAL '5 minutes'")
    );
    assert_eq!(
        default_time_series_preview_filter(" InFlUxDb-3 "),
        Some("time > now() - INTERVAL '5 minutes'")
    );
    assert_eq!(default_time_series_preview_filter("postgres"), None);
    assert_eq!(default_time_series_preview_filter("influxdb"), None);
}

#[tokio::test]
async fn data_transfer_does_not_widen_an_external_postgres_package_capability() {
    let manager = ConnectionManager::new();
    manager
        .add_connection(
            "external-postgres".to_string(),
            Box::new(RestrictedExternalPostgresDriver),
        )
        .await;
    let endpoint = TableDataTransferEndpoint {
        connection_id: "external-postgres".to_string(),
        driver: "postgres".to_string(),
        schema: "public".to_string(),
        table: "events".to_string(),
        database: None,
    };

    let error = table_data_transfer_dialect(&manager, &endpoint)
        .await
        .unwrap_err();
    assert!(error.contains("reviewed bounded table-data transfer path"));
}

#[tokio::test]
async fn unquoted_transfer_columns_require_an_identified_reviewed_gauss_package() {
    let manager = ConnectionManager::new();
    manager
        .replace_connection_with_tunnel_and_driver_id(
            "gauss".to_string(),
            Box::new(ReviewedGaussTransferDriver),
            None,
            Some("gaussdb".to_string()),
        )
        .await
        .unwrap();
    let endpoint = TableDataTransferEndpoint {
        connection_id: "gauss".to_string(),
        driver: "gaussdb".to_string(),
        schema: "public".to_string(),
        table: "events".to_string(),
        database: None,
    };

    assert!(
        resolve_transfer_target_column_quoting(&manager, &endpoint, true)
            .await
            .unwrap()
    );
    assert!(
        !resolve_transfer_target_column_quoting(&manager, &endpoint, false)
            .await
            .unwrap()
    );

    let mut postgres = endpoint.clone();
    postgres.driver = "postgres".to_string();
    let error = resolve_transfer_target_column_quoting(&manager, &postgres, false)
        .await
        .unwrap_err();
    assert!(error.contains("only for GaussDB/openGauss"));
}

#[test]
fn validates_raw_table_filters_before_query_composition() {
    assert_eq!(
        validated_raw_filter_sql(
            DatabaseKind::Postgres,
            Some("WHERE status = 'active;pending'")
        )
        .unwrap()
        .as_deref(),
        Some("WHERE status = 'active;pending'")
    );
    assert!(
        validated_raw_filter_sql(DatabaseKind::Postgres, Some("id = 1; DELETE FROM users"))
            .is_err()
    );
    assert!(validated_raw_filter_sql(
        DatabaseKind::Mysql,
        Some("id = 1 UNION SELECT password FROM users")
    )
    .is_err());
    assert!(validated_raw_filter_sql(
        DatabaseKind::Postgres,
        Some("id IN (SELECT id FROM admins)")
    )
    .is_err());
}

#[test]
fn relation_operation_matrix_matches_object_type() {
    assert!(relation_operation_allowed(
        RelationOperation::DataMutation,
        Some("BASE TABLE")
    ));
    assert!(relation_operation_allowed(
        RelationOperation::ColumnChange,
        Some("BASE TABLE")
    ));
    assert!(relation_operation_allowed(
        RelationOperation::ConstraintChange,
        Some("BASE TABLE")
    ));
    assert!(relation_operation_allowed(
        RelationOperation::IndexChange,
        Some("BASE TABLE")
    ));

    assert!(!relation_operation_allowed(
        RelationOperation::DataMutation,
        Some("VIEW")
    ));
    assert!(!relation_operation_allowed(
        RelationOperation::ColumnChange,
        Some("VIEW")
    ));
    assert!(!relation_operation_allowed(
        RelationOperation::IndexChange,
        Some("VIEW")
    ));

    assert!(!relation_operation_allowed(
        RelationOperation::DataMutation,
        Some("MATERIALIZED VIEW")
    ));
    assert!(!relation_operation_allowed(
        RelationOperation::ConstraintChange,
        Some("MATERIALIZED VIEW")
    ));
    assert!(relation_operation_allowed(
        RelationOperation::IndexChange,
        Some("MATERIALIZED VIEW")
    ));

    assert!(!relation_operation_allowed(
        RelationOperation::DataMutation,
        Some("FOREIGN TABLE")
    ));
    assert!(!relation_operation_allowed(
        RelationOperation::IndexChange,
        Some("FOREIGN TABLE")
    ));
}

#[test]
fn sqlite_uses_the_bounded_ansi_data_grid_path() {
    assert_eq!(
        table_data_dialect("sqlite").unwrap(),
        DatabaseKind::Postgres
    );
    assert_eq!(
        table_data_dialect("sqlite3").unwrap(),
        DatabaseKind::Postgres
    );
    assert_eq!(
        table_data_dialect("duckdb").unwrap(),
        DatabaseKind::Postgres
    );
    assert_eq!(
        table_data_dialect("influxdb3").unwrap(),
        DatabaseKind::Postgres
    );
    assert_eq!(
        table_data_dialect("influxdb-3").unwrap(),
        DatabaseKind::Postgres
    );
    assert!(table_data_dialect("influxdb").is_err());
    assert!(table_data_dialect("unsupported").is_err());
}

#[test]
fn external_driver_aliases_cannot_receive_host_generated_table_ddl() {
    let capabilities = crate::core::dialect::DatabaseKind::Postgres.capabilities();
    assert!(ensure_host_table_ddl_capability(None, "creation").is_ok());
    assert_eq!(
        ensure_host_table_ddl_capability(Some(&capabilities), "column alteration").unwrap_err(),
        "PostgreSQL does not provide a verified semantic table column alteration operation"
    );
}

#[test]
fn external_table_data_capabilities_do_not_widen_a_driver_alias() {
    let mut capabilities = DatabaseKind::Postgres.capabilities();
    capabilities.display_name = "Restricted PostgreSQL package".to_string();
    capabilities.supports_table_row_mutation = false;

    assert_eq!(
        reviewed_table_data_dialect(&capabilities, false).unwrap(),
        DatabaseKind::Postgres
    );
    assert!(reviewed_table_data_dialect(&capabilities, true)
        .unwrap_err()
        .contains("row-mutation"));
    capabilities.lsp_language_id = "sql".to_string();
    assert!(reviewed_table_data_dialect(&capabilities, false)
        .unwrap_err()
        .contains("reviewed table SQL dialect"));
}

#[test]
fn table_export_format_requires_an_explicit_driver_capability() {
    let mut capabilities = DatabaseKind::Postgres.capabilities();
    assert!(ensure_table_export_format(&capabilities, TableExportFormat::Xlsx).is_ok());
    capabilities.table_export_formats = vec!["csv".to_string()];
    assert!(ensure_table_export_format(&capabilities, TableExportFormat::Csv).is_ok());
    assert!(
        ensure_table_export_format(&capabilities, TableExportFormat::Xlsx)
            .unwrap_err()
            .contains("does not declare XLSX")
    );
}
