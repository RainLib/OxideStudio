use super::*;
use crate::core::driver::DatabaseDriver;
use mongodb::{
    bson::{doc, Bson},
    results::CollectionType,
};
use serde_json::Value;

#[test]
fn extracts_default_database_from_url() {
    assert_eq!(
        mongodb_default_database("mongodb://user:pw@localhost:27017/app?retryWrites=true"),
        "app"
    );
    assert_eq!(
        mongodb_default_database("mongodb://localhost:27017"),
        "admin"
    );
}

#[tokio::test]
async fn shell_use_database_updates_the_active_database_without_server_commands() {
    let driver = MongoDbDriver::new("mongodb://localhost/default_db");
    let commands = parse_mongodb_commands("use reporting").unwrap();
    let results = driver.execute_commands(commands).await.unwrap();

    assert_eq!(driver.active_database_name().await, "reporting");
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].columns[0].name, "database");
    assert_eq!(
        results[0].rows[0][0],
        Value::String("reporting".to_string())
    );
    assert_eq!(results[0].rows[0][1], Value::String("use".to_string()));
}

#[test]
fn detects_oidc_authentication_without_accepting_lookalike_parameters() {
    assert!(mongodb_url_uses_oidc(
        "mongodb://localhost/app?authSource=%24external&authMechanism=MONGODB-OIDC"
    ));
    assert!(mongodb_url_uses_oidc(
        "mongodb://localhost/app?AUTHMECHANISM=mongodb-oidc"
    ));
    assert!(!mongodb_url_uses_oidc(
        "mongodb://localhost/app?authMechanism=SCRAM-SHA-256"
    ));
    assert!(!mongodb_url_uses_oidc(
        "mongodb://localhost/app?notAuthMechanism=MONGODB-OIDC"
    ));
}

#[test]
fn extracts_server_version_from_build_info_response() {
    assert_eq!(
        mongodb_server_version(&doc! { "version": "5.3.2-enterprise" }),
        Some("5.3.2-enterprise".to_string())
    );
    assert_eq!(mongodb_server_version(&doc! { "version": "  " }), None);
    assert_eq!(mongodb_server_version(&doc! { "ok": 1 }), None);
}

#[test]
fn extended_json_round_trip_preserves_native_bson_types() {
    let source = serde_json::json!({
        "_id": { "$oid": "507f1f77bcf86cd799439011" },
        "createdAt": { "$date": { "$numberLong": "1786291200000" } },
        "counter": { "$numberLong": "9223372036854775807" },
        "amount": { "$numberDecimal": "1234567890.0123456789" },
        "payload": { "$binary": { "base64": "AQID", "subType": "00" } },
        "nested": [{ "$oid": "507f191e810c19729de860ea" }]
    });

    let document = json_to_document(&source, "document").unwrap();
    assert!(matches!(document.get("_id"), Some(Bson::ObjectId(_))));
    assert!(matches!(document.get("createdAt"), Some(Bson::DateTime(_))));
    assert!(matches!(
        document.get("counter"),
        Some(Bson::Int64(i64::MAX))
    ));
    assert!(matches!(document.get("amount"), Some(Bson::Decimal128(_))));
    assert!(matches!(document.get("payload"), Some(Bson::Binary(_))));
    assert!(matches!(
        document.get_array("nested").unwrap().first(),
        Some(Bson::ObjectId(_))
    ));

    let encoded = bson_to_json(Bson::Document(document.clone()));
    assert_eq!(
        json_to_document(&encoded, "round-trip document").unwrap(),
        document
    );
}

#[test]
fn extended_json_keeps_mongo_shell_like_strings_literal() {
    let source = serde_json::json!({
        "dateText": "ISODate(\"2026-08-10T00:00:00.000Z\")",
        "objectIdText": "ObjectId(\"507f1f77bcf86cd799439011\")",
        "actualDate": { "$date": "2026-08-10T00:00:00.000Z" }
    });

    let document = json_to_document(&source, "document").unwrap();
    assert!(matches!(
        document.get("dateText"),
        Some(Bson::String(value)) if value == "ISODate(\"2026-08-10T00:00:00.000Z\")"
    ));
    assert!(matches!(
        document.get("objectIdText"),
        Some(Bson::String(value)) if value == "ObjectId(\"507f1f77bcf86cd799439011\")"
    ));
    assert!(matches!(
        document.get("actualDate"),
        Some(Bson::DateTime(_))
    ));
}

#[test]
fn validates_mongodb_database_names() {
    assert_eq!(validate_mongodb_database_name(" app ").unwrap(), "app");
    assert!(validate_mongodb_database_name("").is_err());
    assert!(validate_mongodb_database_name("app.users").is_err());
    assert!(validate_mongodb_database_name("app/users").is_err());
    assert!(validate_mongodb_database_name("$admin").is_err());
}

#[test]
fn prepares_clone_without_replaying_source_identity() {
    let source = doc! {
        "_id": mongodb::bson::oid::ObjectId::parse_str("507f1f77bcf86cd799439011").unwrap(),
        "name": "Ada",
        "large": Bson::Int64(9_223_372_036_854_775_000),
        "createdAt": Bson::DateTime(
            mongodb::bson::DateTime::parse_rfc3339_str("2026-08-31T08:15:00Z").unwrap()
        ),
    };

    let prepared = prepare_mongodb_document_clone(&source, None).unwrap();

    assert!(prepared.source_document.get("_id").is_some());
    assert!(prepared.draft_document.get("_id").is_none());
    assert!(prepared.cloned_document.get("_id").is_none());
    assert!(prepared.edited_fields.is_empty());
    let cloned = json_to_document(&prepared.cloned_document, "clone").unwrap();
    assert!(matches!(
        cloned.get("large"),
        Some(Bson::Int64(9_223_372_036_854_775_000))
    ));
    assert!(matches!(cloned.get("createdAt"), Some(Bson::DateTime(_))));
}

#[test]
fn clone_plan_changes_only_the_edited_top_level_fields() {
    let source = doc! {
        "_id": 7,
        "name": "before",
        "profile": { "role": "admin" },
        "removed": true,
        "large": Bson::Int64(9_223_372_036_854_775_000),
    };
    let draft = serde_json::json!({
        "name": "after",
        "profile": { "role": "admin" },
        "large": { "$numberLong": "9223372036854775000" },
        "added": { "$numberDecimal": "19.95" }
    });

    let prepared = prepare_mongodb_document_clone(&source, Some(&draft)).unwrap();

    assert_eq!(prepared.edited_fields, ["added", "name", "removed"]);
    let cloned = json_to_document(&prepared.cloned_document, "clone").unwrap();
    assert_eq!(cloned.get_str("name").unwrap(), "after");
    assert!(cloned.get("removed").is_none());
    assert!(matches!(
        cloned.get("large"),
        Some(Bson::Int64(9_223_372_036_854_775_000))
    ));
    assert!(matches!(cloned.get("added"), Some(Bson::Decimal128(_))));
}

#[test]
fn clone_source_digest_and_collection_guard_bind_the_reviewed_source() {
    let first = prepare_mongodb_document_clone(&doc! { "_id": 1, "value": "first" }, None).unwrap();
    let second =
        prepare_mongodb_document_clone(&doc! { "_id": 1, "value": "second" }, None).unwrap();

    assert_ne!(first.source_digest, second.source_digest);
    assert_eq!(
        validate_mongodb_collection_name(" users ").unwrap(),
        "users"
    );
    assert!(validate_mongodb_collection_name("").is_err());
    assert!(validate_mongodb_collection_name("system.users").is_err());
}

#[test]
fn edit_plan_preserves_identity_and_untouched_bson_values() {
    let source = doc! {
        "_id": Bson::Int64(9_007_199_254_740_993),
        "name": "before",
        "large": Bson::Int64(9_223_372_036_854_775_000),
        "removed": true,
    };
    let draft = serde_json::json!({
        "name": "after",
        "large": { "$numberLong": "9223372036854775000" },
        "added": { "$numberDecimal": "10.50" }
    });

    let prepared = prepare_mongodb_document_edit(&source, Some(&draft)).unwrap();
    assert_eq!(prepared.edited_fields, ["added", "name", "removed"]);
    assert!(prepared.draft_document.get("_id").is_none());
    let updated = json_to_document(&prepared.updated_document, "updated").unwrap();
    assert_eq!(updated.get("_id"), source.get("_id"));
    assert!(matches!(
        updated.get("large"),
        Some(Bson::Int64(9_223_372_036_854_775_000))
    ));
    assert_eq!(updated.get_str("name").unwrap(), "after");
    assert!(updated.get("removed").is_none());
    assert!(matches!(updated.get("added"), Some(Bson::Decimal128(_))));
}

#[test]
fn edit_plan_rejects_identity_changes() {
    let source = doc! { "_id": 1, "value": "before" };
    let draft = serde_json::json!({ "_id": 2, "value": "after" });

    let error = prepare_mongodb_document_edit(&source, Some(&draft))
        .unwrap_err()
        .to_string();
    assert!(error.contains("_id is immutable"));
}

#[test]
fn edit_delete_fingerprint_and_atomic_filter_bind_the_entire_source() {
    let source = doc! { "_id": 1, "value": "first", "nested": { "active": true } };
    let changed = doc! { "_id": 1, "value": "second", "nested": { "active": true } };
    let edit = prepare_mongodb_document_edit(&source, None).unwrap();
    let delete = prepare_mongodb_document_delete(&source).unwrap();
    let changed_delete = prepare_mongodb_document_delete(&changed).unwrap();
    let filter = exact_source_filter(&source).unwrap();

    assert_eq!(edit.source_digest, delete.source_digest);
    assert_ne!(delete.source_digest, changed_delete.source_digest);
    assert_eq!(filter.get("_id"), source.get("_id"));
    assert!(filter.get_document("$expr").is_ok());
    let comparison = filter
        .get_document("$expr")
        .unwrap()
        .get_array("$eq")
        .unwrap();
    assert_eq!(
        comparison.first(),
        Some(&Bson::String("$$ROOT".to_string()))
    );
}

#[test]
fn database_initialization_collection_is_stable_and_non_system() {
    assert_eq!(MONGODB_DATABASE_INITIALIZATION_COLLECTION, "oxide_init");
    assert!(!MONGODB_DATABASE_INITIALIZATION_COLLECTION.starts_with("system."));
}

#[tokio::test]
async fn tracks_active_database_context() {
    let driver = MongoDbDriver::new("mongodb://localhost:27017/default_db");

    assert_eq!(driver.active_database_name().await, "default_db");
    driver.set_current_schema(" reporting ").await.unwrap();
    assert_eq!(driver.active_database_name().await, "reporting");
    assert_eq!(driver.database_name_for(None).await.unwrap(), "reporting");
    assert_eq!(
        driver.database_name_for(Some("explicit")).await.unwrap(),
        "explicit"
    );
}

#[test]
fn parses_single_find_command() {
    let commands = parse_mongodb_commands(
        r#"{"database":"app","collection":"users","find":{"active":true},"limit":10}"#,
    )
    .unwrap();

    assert_eq!(commands.len(), 1);
    assert_eq!(commands[0].database.as_deref(), Some("app"));
    assert_eq!(commands[0].collection.as_deref(), Some("users"));
    assert_eq!(commands[0].limit, Some(10));
}

#[test]
fn normalizes_native_find_command() {
    let command = parse_mongodb_commands(
        r#"{"database":"app","find":"file","filter":{"active":true},"limit":10}"#,
    )
    .unwrap()
    .remove(0);

    assert_eq!(command.database.as_deref(), Some("app"));
    assert_eq!(command.collection.as_deref(), Some("file"));
    assert_eq!(command.find, Some(serde_json::json!({"active": true})));
    assert_eq!(command.limit, Some(10));
}

#[test]
fn normalizes_native_aggregate_and_count_commands() {
    let commands = parse_mongodb_commands(
        r#"[
            {
                "aggregate":"file",
                "pipeline":[{"$match":{"active":true}}],
                "cursor":{}
            },
            {"count":"file","query":{"active":true}}
        ]"#,
    )
    .unwrap();

    assert_eq!(commands[0].collection.as_deref(), Some("file"));
    assert_eq!(
        commands[0].aggregate,
        Some(vec![serde_json::json!({"$match": {"active": true}})])
    );
    assert_eq!(commands[1].collection.as_deref(), Some("file"));
    assert_eq!(
        commands[1].count_documents,
        Some(serde_json::json!({"active": true}))
    );
}

#[test]
fn parses_multiple_json_commands() {
    let commands = parse_mongodb_commands(
        r#"[
            {"collection":"users","find":{}},
            {"collection":"users","countDocuments":{"active":true}}
        ]"#,
    )
    .unwrap();

    assert_eq!(commands.len(), 2);
    assert!(commands[0].find.is_some());
    assert!(commands[1].count_documents.is_some());
}

#[test]
fn parses_whitespace_separated_json_commands() {
    let commands = parse_mongodb_commands(
        r#"{"collection":"users","find":{}}

           {"collection":"users","countDocuments":{"active":true}}"#,
    )
    .unwrap();

    assert_eq!(commands.len(), 2);
    assert!(commands[0].find.is_some());
    assert!(commands[1].count_documents.is_some());
}

#[test]
fn parses_supported_read_only_shell_command_into_native_contract() {
    let command = parse_mongodb_commands(
        "db.getCollection('audit.logs').find({createdAt: {$gte: ISODate('2026-01-01T00:00:00Z')}}).sort({createdAt: -1}).limit(20)",
    )
    .unwrap()
    .remove(0);

    assert_eq!(command.collection.as_deref(), Some("audit.logs"));
    assert_eq!(
        command.find,
        Some(serde_json::json!({
            "createdAt": { "$gte": { "$date": "2026-01-01T00:00:00Z" } }
        }))
    );
    assert_eq!(command.sort, Some(serde_json::json!({"createdAt": -1})));
    assert_eq!(command.limit, Some(20));
    assert!(command.insert_one.is_none());
    assert!(command.update_many.is_none());

    let commands = parse_mongodb_commands(
        "db.users.find({note: 'a;b'}).limit(5); db.orders.count({active: true});",
    )
    .unwrap();
    assert_eq!(commands.len(), 2);
    assert_eq!(commands[1].collection.as_deref(), Some("orders"));
}

#[test]
fn parses_shell_mutations_and_read_options_into_native_contracts() {
    let commands = parse_mongodb_commands(
        "db.users.updateMany({active: false}, {$set: {active: true}}, {upsert: true}); db.events.insertMany([{kind: 'login'}], {ordered: false})",
    )
    .unwrap();
    assert_eq!(commands.len(), 2);
    let update = commands[0].update_many.as_ref().unwrap();
    assert_eq!(update.filter["active"], false);
    assert_eq!(update.update["$set"]["active"], true);
    assert_eq!(update.upsert, Some(true));
    assert_eq!(commands[1].command.as_ref().unwrap()["insert"], "events");
    assert_eq!(commands[1].command.as_ref().unwrap()["ordered"], false);

    let aggregate = parse_mongodb_commands(
        "db.events.aggregate([{$match: {kind: 'login'}}], {allowDiskUse: true, maxTimeMS: 500})",
    )
    .unwrap()
    .remove(0);
    assert_eq!(aggregate.collection.as_deref(), Some("events"));
    assert_eq!(aggregate.aggregate.as_ref().unwrap().len(), 1);
    assert_eq!(
        aggregate.aggregate_options.as_ref().unwrap()["allowDiskUse"],
        true
    );
}

#[test]
fn rejects_ambiguous_or_collectionless_commands() {
    assert!(parse_mongodb_commands(r#"{"find":{}}"#).is_err());
    assert!(parse_mongodb_commands(r#"{"collection":"users","find":{},"deleteMany":{}}"#).is_err());
    assert!(parse_mongodb_commands(r#"{"collection":"users","drop":true}"#).is_err());
    assert!(parse_mongodb_commands(
        r#"{"collection":"users","updateOne":{"filter":{},"update":{},"unknown":true}}"#
    )
    .is_err());
    assert!(parse_mongodb_commands(r#"{"find":"users","filter":[]}"#).is_err());
    assert!(
        parse_mongodb_commands(r#"{"collection":"admins","find":"users","filter":{}}"#).is_err()
    );
    assert!(parse_mongodb_commands(r#"{"aggregate":"users","pipeline":{},"cursor":{}}"#).is_err());
}

#[test]
fn builds_find_command_with_options() {
    let input = parse_mongodb_commands(
        r#"{
            "collection":"users",
            "find":{"active":true},
            "sort":{"createdAt":-1},
            "projection":{"email":1},
            "collation":{"locale":"en"},
            "findOptions":{"hint":{"active":1},"maxTimeMS":500},
            "skip":5,
            "limit":20
        }"#,
    )
    .unwrap()
    .remove(0);

    let command = build_find_command("users", &input).unwrap();
    assert_eq!(command.get_str("find").unwrap(), "users");
    assert_eq!(command.get_i64("limit").unwrap(), 20);
    assert_eq!(command.get_i64("skip").unwrap(), 5);
    assert!(command
        .get_document("filter")
        .unwrap()
        .contains_key("active"));
    assert!(command
        .get_document("sort")
        .unwrap()
        .contains_key("createdAt"));
    assert!(command
        .get_document("projection")
        .unwrap()
        .contains_key("email"));
    assert_eq!(
        command
            .get_document("collation")
            .unwrap()
            .get_str("locale")
            .unwrap(),
        "en"
    );
    assert!(command.get_document("hint").unwrap().contains_key("active"));
    assert_eq!(command.get_i32("maxTimeMS").unwrap(), 500);

    let aggregate = build_aggregate_command(
        "users",
        &[serde_json::json!({"$match": {"active": true}})],
        Some(&serde_json::json!({"allowDiskUse": true, "maxTimeMS": 750})),
    )
    .unwrap();
    assert!(aggregate.get_bool("allowDiskUse").unwrap());
    assert_eq!(aggregate.get_i32("maxTimeMS").unwrap(), 750);
}

#[test]
fn converts_documents_to_tabular_result() {
    let result = documents_result(vec![
        doc! {"name": "Ada", "_id": 1, "active": true},
        doc! {"_id": 2, "name": "Grace"},
    ]);

    assert_eq!(result.columns[0].name, "_id");
    assert_eq!(result.columns[1].name, "name");
    assert_eq!(result.columns[2].name, "active");
    assert_eq!(result.rows.len(), 2);
    assert_eq!(result.rows[1][2], Value::Null);
}

#[test]
fn document_result_keeps_unsafe_integer_identity_exact_for_clone_selection() {
    let result = documents_result(vec![doc! {
        "_id": Bson::Int64(9_223_372_036_854_775_000),
        "name": "Ada",
    }]);

    assert_eq!(
        result.rows[0][0],
        serde_json::json!({ "$numberLong": "9223372036854775000" })
    );
    assert_eq!(
        bson_identity_to_json(Bson::Document(doc! {
            "tenant": "a",
            "sequence": Bson::Int64(9_223_372_036_854_775_000),
        })),
        serde_json::json!({
            "tenant": "a",
            "sequence": { "$numberLong": "9223372036854775000" },
        })
    );
}

#[test]
fn infers_columns_from_sampled_documents() {
    let columns = infer_mongodb_columns(&[
        doc! {"name": "Ada", "_id": 1, "active": true, "profile": {"role": "admin"}},
        doc! {"_id": 2, "name": "Grace", "active": "yes", "tags": ["db"]},
    ]);

    assert_eq!(columns[0].name, "_id");
    assert_eq!(columns[0].data_type, "int");
    assert!(columns[0].is_primary_key);
    assert!(columns[0].is_indexed);

    let active = columns
        .iter()
        .find(|column| column.name == "active")
        .unwrap();
    assert_eq!(active.data_type, "mixed");
    assert!(!active.is_nullable);

    let profile = columns
        .iter()
        .find(|column| column.name == "profile")
        .unwrap();
    assert_eq!(profile.data_type, "object");
    assert!(profile.is_nullable);

    let profile_role = columns
        .iter()
        .find(|column| column.name == "profile.role")
        .unwrap();
    assert_eq!(profile_role.data_type, "string");
    assert!(profile_role.is_nullable);

    let tags = columns.iter().find(|column| column.name == "tags").unwrap();
    assert_eq!(tags.data_type, "array");
    assert!(tags.is_nullable);
}

#[test]
fn maps_mongodb_indexes_to_index_info() {
    let indexes = mongodb_indexes_to_info(vec![
        doc! {"name": "_id_", "key": {"_id": 1}},
        doc! {"name": "email_1", "key": {"email": 1}, "unique": true},
        doc! {"name": "profile_text", "key": {"profile.bio": "text"}},
    ]);

    let id = indexes.iter().find(|index| index.name == "_id_").unwrap();
    assert_eq!(id.columns, ["_id"]);
    assert!(id.is_primary);
    assert!(id.is_unique);
    assert_eq!(id.index_type.as_deref(), Some("btree"));

    let email = indexes
        .iter()
        .find(|index| index.name == "email_1")
        .unwrap();
    assert_eq!(email.columns, ["email"]);
    assert!(email.is_unique);
    assert!(!email.is_primary);

    let text = indexes
        .iter()
        .find(|index| index.name == "profile_text")
        .unwrap();
    assert_eq!(text.columns, ["profile.bio"]);
    assert_eq!(text.index_type.as_deref(), Some("text"));
    assert!(text.definition.as_deref().unwrap().contains("profile.bio"));
}

#[test]
fn builds_collection_info_with_estimated_count() {
    let collection = mongodb_collection_info(
        "app",
        "users".to_string(),
        "collection".to_string(),
        Some(42),
    );

    assert_eq!(collection.name, "users");
    assert_eq!(collection.namespace.as_deref(), Some("app"));
    assert_eq!(collection.collection_type.as_deref(), Some("collection"));
    assert_eq!(collection.document_count, Some(42));
}

#[test]
fn mongodb_view_metadata_does_not_request_an_estimated_count() {
    assert_eq!(
        mongodb_collection_type_label(&CollectionType::Collection),
        "collection"
    );
    assert_eq!(
        mongodb_collection_type_label(&CollectionType::Timeseries),
        "timeseries"
    );
    assert_eq!(mongodb_collection_type_label(&CollectionType::View), "view");
    assert!(mongodb_collection_supports_estimated_count("collection"));
    assert!(mongodb_collection_supports_estimated_count("timeseries"));
    assert!(!mongodb_collection_supports_estimated_count("view"));
    assert!(!mongodb_collection_supports_estimated_count(" VIEW "));

    let view = mongodb_collection_info("app", "active_users".to_string(), "view".to_string(), None);
    assert_eq!(view.collection_type.as_deref(), Some("view"));
    assert_eq!(view.document_count, None);
}

#[tokio::test]
async fn disconnect_clears_client_and_resets_active_database() {
    let driver = MongoDbDriver::new("mongodb://localhost:27017/app");
    *driver.active_database.lock().await = "analytics".to_string();
    *driver.server_version.lock().await = Some("7.0.8".to_string());

    driver.disconnect().await.unwrap();

    assert!(driver.client.lock().await.is_none());
    assert_eq!(driver.active_database.lock().await.as_str(), "app");
    assert_eq!(driver.server_version().await, None);
    assert!(driver.ping().await.is_err());
}
