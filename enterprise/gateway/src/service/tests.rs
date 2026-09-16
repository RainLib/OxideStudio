#[cfg(test)]
mod tests {

    use super::super::{
        authorization::{
            authorize_native_resource, authorize_sql_relations, metadata_parent_path_for_source,
        },
        policy::{
            require_ticket_driver, require_ticket_target_binding,
            validate_elasticsearch_native_read_only, validate_mongodb_native_read_only,
            validate_redis_native_read_only,
        },
    };
    use crate::{config::DataSourceConfig, proto::ResourceRequest};
    use oxide_enterprise_contracts::ENTERPRISE_CONTRACT_VERSION;
    use oxide_studio_lib::core::statement::StatementScanDialect;
    use uuid::Uuid;

    #[test]
    fn sql_authorization_checks_every_joined_relation() {
        let sql = "SELECT o.id FROM orders o JOIN customers c ON c.id = o.customer_id";
        assert!(authorize_sql_relations(
            sql,
            StatementScanDialect::Postgres,
            Some("app"),
            Some("public"),
            &[vec!["app".into(), "public".into()]],
            &[],
        )
        .is_ok());
        assert!(authorize_sql_relations(
            sql,
            StatementScanDialect::Postgres,
            Some("app"),
            Some("public"),
            &[vec!["app".into(), "public".into(), "orders".into()]],
            &[],
        )
        .is_err());
    }

    #[test]
    fn unparsable_and_relation_free_sql_fails_closed() {
        assert!(authorize_sql_relations(
            "SELECT FROM",
            StatementScanDialect::Postgres,
            Some("app"),
            Some("public"),
            &[vec![]],
            &[],
        )
        .is_err());
        assert!(authorize_sql_relations(
            "SELECT 1",
            StatementScanDialect::Postgres,
            Some("app"),
            Some("public"),
            &[vec![]],
            &[],
        )
        .is_err());
    }

    #[test]
    fn sql_authorization_applies_explicit_exclusions() {
        assert!(authorize_sql_relations(
            "SELECT * FROM private_orders",
            StatementScanDialect::Postgres,
            Some("app"),
            Some("public"),
            &[vec!["app".into(), "public".into()]],
            &[vec!["app".into(), "public".into(), "private_orders".into(),]],
        )
        .is_err());
    }

    #[test]
    fn native_mongodb_read_only_targets_one_collection_and_rejects_writes() {
        let target = validate_mongodb_native_read_only(
            r#"{"database":"app","find":"orders","filter":{"state":"open"},"limit":25}"#,
            Some("app"),
        )
        .unwrap();
        assert_eq!(target.context, "app");
        assert_eq!(target.resource_path, ["app", "orders"]);
        assert!(validate_mongodb_native_read_only(
            r#"{"database":"app","collection":"orders","deleteMany":{}}"#,
            Some("app"),
        )
        .is_err());
        assert!(validate_mongodb_native_read_only(
            r#"{"database":"app","aggregate":"orders","pipeline":[{"$lookup":{"from":"users"}}]}"#,
            Some("app"),
        )
        .is_err());
    }

    #[test]
    fn native_elasticsearch_requires_one_concrete_index_search() {
        let target = validate_elasticsearch_native_read_only(
            "POST /logs-2026/_search\n{\"query\":{\"match_all\":{}}}",
            Some("logs-2026"),
        )
        .unwrap();
        assert_eq!(target.resource_path, ["logs-2026"]);
        assert!(
            validate_elasticsearch_native_read_only("POST /logs-*/_search\n{}", None,).is_err()
        );
        assert!(validate_elasticsearch_native_read_only(
            "POST /logs-2026/_delete_by_query\n{}",
            None,
        )
        .is_err());
        assert!(validate_elasticsearch_native_read_only(
            r#"{"script":{"source":"return true"}}"#,
            Some("logs-2026"),
        )
        .is_err());
    }

    #[test]
    fn native_redis_allows_only_one_scoped_read_command() {
        let target = validate_redis_native_read_only(r#"HGET "user:42" name"#, Some("2")).unwrap();
        assert_eq!(target.resource_path, ["2", "user:42"]);
        assert!(validate_redis_native_read_only("SET user:42 Ada", Some("2")).is_err());
        assert!(validate_redis_native_read_only("GET user:42; DEL user:42", Some("2")).is_err());
        assert!(validate_redis_native_read_only("GET user:42", None).is_err());
    }

    #[test]
    fn native_scope_must_bind_exact_target_and_honor_exclusions() {
        let actual = vec!["app".to_string(), "orders".to_string()];
        assert!(authorize_native_resource(
            &["app".into(), "orders".into()],
            &actual,
            &[vec!["app".into()]],
            &[],
        )
        .is_ok());
        assert!(
            authorize_native_resource(&["app".into()], &actual, &[vec!["app".into()]], &[],)
                .is_err()
        );
        assert!(authorize_native_resource(
            &["app".into(), "orders".into()],
            &actual,
            &[vec!["app".into()]],
            &[vec!["app".into(), "orders".into()]],
        )
        .is_err());
    }

    #[test]
    fn native_metadata_scope_preserves_collection_and_index_boundaries() {
        let mongo = ResourceRequest {
            access_ticket: String::new(),
            scope: None,
            kind: "collection".into(),
            database: Some("app".into()),
            schema: None,
            object_name: None,
        };
        assert_eq!(
            metadata_parent_path_for_source(&mongo, "mongodb").unwrap(),
            ["app"]
        );
        let elastic = ResourceRequest {
            access_ticket: String::new(),
            scope: None,
            kind: "column".into(),
            database: None,
            schema: None,
            object_name: Some("logs-2026".into()),
        };
        assert_eq!(
            metadata_parent_path_for_source(&elastic, "elasticsearch").unwrap(),
            ["logs-2026"]
        );
    }

    #[test]
    fn signed_ticket_driver_must_match_the_gateway_source_driver() {
        let mut claims = oxide_enterprise_contracts::AccessSessionClaims {
            version: ENTERPRISE_CONTRACT_VERSION,
            issuer: "test".into(),
            audience: Uuid::new_v4(),
            principal_id: Uuid::new_v4(),
            device_id: Uuid::new_v4(),
            device_certificate_fingerprint: "f".into(),
            organization_id: Uuid::new_v4(),
            project_id: Uuid::new_v4(),
            data_source_id: Uuid::new_v4(),
            driver: "postgres".into(),
            target_binding: "a".repeat(64),
            actions: Default::default(),
            resource_path: vec![],
            allowed_resource_paths: vec![],
            forbidden_resource_paths: vec![],
            policy_revision: "p".into(),
            nonce: Uuid::new_v4(),
            issued_at: 0,
            expires_at: 1,
            max_rows: 1,
            max_result_bytes: 4096,
        };
        let source = DataSourceConfig {
            id: claims.data_source_id,
            driver: "mysql".into(),
            target_binding: "b".repeat(64),
            secret_ref: "vault:test".into(),
            connection_template: None,
            allow_insecure_transport: false,
            capabilities: vec!["query.read".into()],
        };
        assert!(require_ticket_driver(&claims, &source).is_err());
        assert!(require_ticket_target_binding(&claims, &source).is_err());
        claims.driver = "postgresql".into();
        let postgres = DataSourceConfig {
            driver: "postgres".into(),
            ..source
        };
        assert!(require_ticket_driver(&claims, &postgres).is_ok());
        claims.target_binding = postgres.target_binding.clone();
        assert!(require_ticket_target_binding(&claims, &postgres).is_ok());
    }
}
