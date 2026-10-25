use super::*;
use crate::core::dialect::{database_capabilities_for_driver, DatabaseConnectionMode};
use oxide_driver_protocol::{
    DriverQueryContext, DriverRequest, DriverRuntimeCapabilities, SecretConnectionConfig,
};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{fs, time::Instant};

fn owner() -> FileQueryOwner {
    FileQueryOwner {
        project_id: "project-a".into(),
        window: "main".into(),
    }
}

#[test]
fn file_query_source_requires_scope_format_and_size() {
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    let csv = outside.path().join("items.csv");
    fs::write(&csv, "id\n1\n").unwrap();
    assert!(AuthorizedFile::for_project(&csv, root.path()).is_err());
    let inside = root.path().join("items.CSV");
    fs::write(&inside, "id\n1\n").unwrap();
    assert_eq!(
        AuthorizedFile::for_project(&inside, root.path())
            .unwrap()
            .format,
        "csv"
    );
    assert!(AuthorizedFile::new(root.path()).is_err());
    let unsupported = root.path().join("secret.txt");
    fs::write(&unsupported, "id\n1\n").unwrap();
    assert!(AuthorizedFile::new(&unsupported).is_err());
}

#[test]
fn file_query_runtime_requires_all_execution_and_ownership_flags() {
    let caps = DriverRuntimeCapabilities {
        query: true,
        file_queries: true,
        host_managed_file_queries: true,
        read_only_enforcement: true,
        read_only_connections: true,
        ..Default::default()
    };
    runtime::validate_runtime(&caps).unwrap();
    for key in [
        "query",
        "fileQueries",
        "hostManagedFileQueries",
        "readOnlyEnforcement",
        "readOnlyConnections",
    ] {
        let mut encoded = serde_json::to_value(&caps).unwrap();
        encoded[key] = json!(false);
        assert!(
            runtime::validate_runtime(&serde_json::from_value(encoded).unwrap()).is_err(),
            "accepted missing {key}"
        );
    }
}

fn native_registry(root: &Path) -> DatabaseDriverPackageRegistry {
    if let Some(signed) = std::env::var_os("OXIDE_FILE_QUERY_TEST_SIGNED_REGISTRY") {
        let signed = PathBuf::from(signed);
        let name = if cfg!(windows) {
            "oxide-driver-duckdb.exe"
        } else {
            "oxide-driver-duckdb"
        };
        for version in ["0.1.0", "0.1.1"] {
            let destination = root.join("duckdb").join(version);
            fs::create_dir_all(&destination).unwrap();
            for file in [name, "manifest.json", "manifest.json.minisig"] {
                fs::copy(
                    signed.join("duckdb").join(version).join(file),
                    destination.join(file),
                )
                .unwrap();
            }
        }
        let registry = DatabaseDriverPackageRegistry::new(root.to_path_buf());
        registry
            .resolve_version("duckdb", "0.1.0")
            .expect("production signature/digest resolution must pass");
        return registry;
    }
    let binary = PathBuf::from(
        std::env::var_os("OXIDE_FILE_QUERY_TEST_BINARY")
            .expect("set the actual compiled DuckDB driver binary"),
    );
    let package = root.join("duckdb/0.1.0");
    fs::create_dir_all(&package).unwrap();
    let name = if cfg!(windows) {
        "oxide-driver-duckdb.exe"
    } else {
        "oxide-driver-duckdb"
    };
    fs::copy(&binary, package.join(name)).unwrap();
    let mut caps = database_capabilities_for_driver("sqlite").unwrap();
    caps.driver = "duckdb".into();
    caps.display_name = "DuckDB".into();
    caps.lsp_language_id = "duckdb".into();
    caps.connection_mode = DatabaseConnectionMode::File;
    caps.file_query_formats = vec![
        "csv".into(),
        "json".into(),
        "jsonl".into(),
        "parquet".into(),
    ];
    fs::write(package.join("manifest.json"), serde_json::to_vec(&json!({
        "schemaVersion": 1, "packageId": "oxide.duckdb", "packageVersion": "0.1.0", "protocolVersion": "1.0", "driverId": "duckdb",
        "displayName": "DuckDB", "clientLibrary": "duckdb-rs", "clientVersion": "1.10505.0", "entrypoint": name,
        "sha256": format!("{:x}", Sha256::digest(fs::read(&binary).unwrap())), "capabilities": caps,
    })).unwrap()).unwrap();
    let no_grant = root.join("duckdb/0.1.1");
    fs::create_dir_all(&no_grant).unwrap();
    fs::copy(package.join(name), no_grant.join(name)).unwrap();
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(package.join("manifest.json")).unwrap()).unwrap();
    manifest["packageVersion"] = json!("0.1.1");
    manifest["capabilities"]["fileQueryFormats"] = json!([]);
    fs::write(
        no_grant.join("manifest.json"),
        serde_json::to_vec(&manifest).unwrap(),
    )
    .unwrap();
    // Manual local runs may use cfg(test)-only trust. The acceptance runner
    // supplies signed packages and takes the production branch above.
    DatabaseDriverPackageRegistry::allow_unsigned_for_tests(root.to_path_buf())
}

const LONG_QUERY: &str = "SELECT sum(sin(a.range * 0.1 + b.range)) FROM range(1000000000) a CROSS JOIN range(1000000000) b";

#[tokio::test]
#[ignore = "requires OXIDE_FILE_QUERY_TEST_BINARY pointing to the compiled native DuckDB sidecar"]
async fn file_query_live_host_scopes_budget_cancellation_and_timeout_cleanup() {
    let root = tempfile::tempdir().unwrap();
    let registry = native_registry(&root.path().join("drivers"));
    let source = root.path().join("items.csv");
    fs::write(&source, "id,name\n1,alpha\n2,beta\n").unwrap();
    let before = fs::read(&source).unwrap();
    let manifest_path = registry.root().join("duckdb/0.1.0/manifest.json");
    let manifest_bytes = fs::read(&manifest_path).unwrap();
    let service = FileQuerySessions::new(&root.path().join("sessions"), registry).unwrap();
    let owner = owner();
    let open = || service.begin_open(owner.clone()).unwrap();
    let file = || AuthorizedFile::for_project(&source, root.path()).unwrap();
    assert!(service
        .open(open(), file(), "duckdb", Some("0.1.1"))
        .await
        .unwrap_err()
        .to_string()
        .contains("does not authorize"));
    assert!(service.0.entries.lock().unwrap().is_empty());
    if std::env::var_os("OXIDE_FILE_QUERY_TEST_SIGNED_REGISTRY").is_some() {
        let mut tampered: serde_json::Value = serde_json::from_slice(&manifest_bytes).unwrap();
        tampered["capabilities"]["fileQueryFormats"] = json!(["csv"]);
        fs::write(&manifest_path, serde_json::to_vec(&tampered).unwrap()).unwrap();
        assert!(service
            .open(open(), file(), "duckdb", Some("0.1.0"))
            .await
            .unwrap_err()
            .to_string()
            .to_ascii_lowercase()
            .contains("signature"));
        assert!(service.0.entries.lock().unwrap().is_empty());
        fs::write(&manifest_path, &manifest_bytes).unwrap();
    }
    let json_path = root.path().join("items.json");
    let jsonl_path = root.path().join("items.jsonl");
    let parquet_path = root.path().join("items.parquet");
    fs::write(
        &json_path,
        r#"[{"id":1,"label":"雪"},{"id":2,"label":null}]"#,
    )
    .unwrap();
    fs::write(
        &jsonl_path,
        "{\"id\":1,\"label\":\"雪\"}\n{\"id\":2,\"label\":null}\n",
    )
    .unwrap();
    // Produce a real Parquet file through the ordinary writable driver, then
    // close it before entering the independent read-only file-session mode.
    let package = service
        .0
        .registry
        .resolve_version("duckdb", "0.1.0")
        .unwrap();
    let writer =
        DatabaseDriverSidecar::spawn(&package, &service.0.registry, env!("CARGO_PKG_VERSION"))
            .await
            .unwrap();
    writer
        .request(
            DriverRequest::Connect {
                connection_id: "seed".into(),
                config: SecretConnectionConfig {
                    url: ":memory:".into(),
                    options: Default::default(),
                },
            },
            Duration::from_secs(10),
        )
        .await
        .unwrap();
    writer.request(DriverRequest::Query { connection_id: "seed".into(), statement: format!("COPY (SELECT 1 AS id, '雪' AS label UNION ALL SELECT 2, NULL) TO '{}' (FORMAT PARQUET)", parquet_path.to_str().unwrap().replace('\'', "''")), parameters: vec![], context: Default::default(), query_id: None }, Duration::from_secs(10)).await.unwrap();
    writer.terminate().await;
    for path in [&json_path, &jsonl_path, &parquet_path] {
        let bytes = fs::read(path).unwrap();
        let session = service
            .open(
                open(),
                AuthorizedFile::for_project(path, root.path()).unwrap(),
                "duckdb",
                Some("0.1.0"),
            )
            .await
            .unwrap();
        assert_eq!(
            service
                .query(&owner, &session.id, "SELECT id,label FROM data ORDER BY id")
                .await
                .unwrap()[0]
                .rows,
            vec![
                vec![json!(1), json!("雪")],
                vec![json!(2), serde_json::Value::Null]
            ]
        );
        service.close(&owner, &session.id).await.unwrap();
        assert_eq!(fs::read(path).unwrap(), bytes);
    }
    let session = service
        .open(open(), file(), "duckdb", Some("0.1.0"))
        .await
        .unwrap();
    assert!(!session.language_id.is_empty());
    assert_eq!(session.capabilities.lsp_language_id, session.language_id);
    let metadata = service
        .query(&owner, &session.id, "SELECT * FROM data LIMIT 0")
        .await
        .unwrap();
    assert!(metadata[0].rows.is_empty());
    assert_eq!(
        metadata[0]
            .columns
            .iter()
            .map(|column| column.name.as_str())
            .collect::<Vec<_>>(),
        vec!["id", "name"]
    );
    assert!(metadata[0]
        .columns
        .iter()
        .all(|column| column.data_type != "UNKNOWN"));
    assert_eq!(session.csv_header, CsvHeader::Auto);
    let cancelled_id = Uuid::new_v4().to_string();
    service.cancel_open(&owner, &cancelled_id).await.unwrap();
    assert!(service
        .begin_open_request(owner.clone(), &cancelled_id)
        .is_err());
    let ticket = open();
    service.cancel_open(&owner, &ticket.id).await.unwrap();
    assert!(service
        .open(ticket, file(), "duckdb", Some("0.1.0"))
        .await
        .is_err());
    let headerless = root.path().join("headerless.csv");
    fs::write(&headerless, "1,alpha\n2,beta\n").unwrap();
    let second = service
        .open(
            open(),
            AuthorizedFile::for_project(&headerless, root.path())
                .unwrap()
                .with_csv_header(CsvHeader::Absent),
            "duckdb",
            Some("0.1.0"),
        )
        .await
        .unwrap();
    assert_eq!(
        service
            .query(&owner, &second.id, "SELECT count(*) FROM data")
            .await
            .unwrap()[0]
            .rows,
        vec![vec![json!(2)]]
    );
    service.cancel_open(&owner, &second.id).await.unwrap();
    assert_eq!(service.list(&owner).unwrap().len(), 1);
    assert!(service
        .query(&owner, &session.id, "SELECT does_not_exist FROM data")
        .await
        .is_err());
    assert!(service
        .query(&owner, &session.id, "CREATE TABLE forbidden(id INT)")
        .await
        .is_err());
    assert_eq!(
        service
            .query(&owner, &session.id, "SELECT count(*) FROM data")
            .await
            .unwrap()[0]
            .rows,
        vec![vec![json!(2)]]
    );
    assert_eq!(
        service.project_root(&owner, &session.id).unwrap(),
        Some(root.path().canonicalize().unwrap())
    );
    for wrong in [
        FileQueryOwner {
            project_id: "other".into(),
            ..owner.clone()
        },
        FileQueryOwner {
            window: "other".into(),
            ..owner.clone()
        },
    ] {
        assert!(service
            .query(&wrong, &session.id, "SELECT 1")
            .await
            .is_err());
        assert!(service.close(&wrong, &session.id).await.is_err());
    }
    for _ in 1..MAX_SESSIONS {
        service
            .open(open(), file(), "duckdb", Some("0.1.0"))
            .await
            .unwrap();
    }
    assert!(service
        .open(open(), file(), "duckdb", Some("0.1.0"))
        .await
        .unwrap_err()
        .to_string()
        .contains("4-session"));
    let cancelled = open();
    service.close_owner(&owner).await.unwrap();
    assert!(service
        .open(cancelled, file(), "duckdb", Some("0.1.0"))
        .await
        .unwrap_err()
        .to_string()
        .contains("cancelled"));
    assert!(service.list(&owner).unwrap().is_empty());
    let session = service
        .open(open(), file(), "duckdb", Some("0.1.0"))
        .await
        .unwrap();
    let entry = service.find(&owner, &session.id).unwrap().unwrap();
    let workspace = entry.workspace.clone();
    let process = entry.process.lock().unwrap().clone().unwrap();
    let start = Instant::now();
    assert!(service
        .query_with_deadline(&owner, &session.id, LONG_QUERY, Duration::from_millis(150))
        .await
        .unwrap_err()
        .to_string()
        .contains("timed out"));
    assert!(start.elapsed() < Duration::from_secs(5));
    assert!(!process.is_running().await);
    assert!(!workspace.exists());
    assert!(service.find(&owner, &session.id).unwrap().is_none());
    let session = service
        .open(open(), file(), "duckdb", Some("0.1.0"))
        .await
        .unwrap();
    let entry = service.find(&owner, &session.id).unwrap().unwrap();
    let workspace = entry.workspace.clone();
    let (request_service, request_owner, id) = (service.clone(), owner.clone(), session.id.clone());
    let pending =
        tokio::spawn(async move { request_service.query(&request_owner, &id, LONG_QUERY).await });
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert!(
        !pending.is_finished(),
        "query must still be executing before cancellation"
    );
    pending.abort();
    let _ = pending.await;
    tokio::time::timeout(Duration::from_secs(5), async {
        while workspace.exists() {
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .unwrap();
    let session = service
        .open(open(), file(), "duckdb", Some("0.1.0"))
        .await
        .unwrap();
    let (query_service, query_owner, id) = (service.clone(), owner.clone(), session.id.clone());
    let pending =
        tokio::spawn(async move { query_service.query(&query_owner, &id, LONG_QUERY).await });
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert!(
        !pending.is_finished(),
        "query must still be executing before window close"
    );
    service.close_window("main").await.unwrap();
    assert!(pending.await.unwrap().is_err());
    let (opening_service, ticket, opening_file) = (service.clone(), open(), file());
    let pending_open = tokio::spawn(async move {
        opening_service
            .open(ticket, opening_file, "duckdb", Some("0.1.0"))
            .await
    });
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if !service.0.entries.lock().unwrap().is_empty() {
                break;
            }
            assert!(
                !pending_open.is_finished(),
                "native open finished before cancellation could be exercised"
            );
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
    })
    .await
    .unwrap();
    assert!(!pending_open.is_finished());
    pending_open.abort();
    let _ = pending_open.await;
    tokio::time::timeout(Duration::from_secs(5), async {
        while !service.0.entries.lock().unwrap().is_empty() {
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .unwrap();
    assert!(service.list(&owner).unwrap().is_empty());
    assert_eq!(fs::read(source).unwrap(), before);
}

#[tokio::test]
#[ignore = "requires OXIDE_FILE_QUERY_TEST_BINARY pointing to the compiled native DuckDB sidecar"]
async fn file_query_live_host_eof_stops_running_sql_and_restart_reclaims_snapshot() {
    let root = tempfile::tempdir().unwrap();
    let registry = native_registry(&root.path().join("drivers"));
    let storage_root = root.path().join("sessions");
    let storage = storage::Storage::open(&storage_root).unwrap();
    let workspace = storage.reserve(&Uuid::new_v4().to_string()).unwrap();
    let source = root.path().join("items.csv");
    fs::write(&source, "id\n1\n").unwrap();
    let package = registry.resolve_version("duckdb", "0.1.0").unwrap();
    let process = Arc::new(
        DatabaseDriverSidecar::spawn_file_query(
            &package,
            &registry,
            env!("CARGO_PKG_VERSION"),
            &workspace,
        )
        .await
        .unwrap(),
    );
    process
        .request(
            DriverRequest::Connect {
                connection_id: "file".into(),
                config: SecretConnectionConfig {
                    url: source.to_str().unwrap().into(),
                    options: [
                        ("readOnly".into(), "true".into()),
                        ("fileQueryFormat".into(), "csv".into()),
                    ]
                    .into_iter()
                    .collect(),
                },
            },
            Duration::from_secs(10),
        )
        .await
        .unwrap();
    let worker = process.clone();
    let pending = tokio::spawn(async move {
        worker
            .request(
                DriverRequest::Query {
                    connection_id: "file".into(),
                    statement: LONG_QUERY.into(),
                    parameters: vec![],
                    context: DriverQueryContext {
                        read_only: true,
                        ..Default::default()
                    },
                    query_id: None,
                },
                Duration::from_secs(20),
            )
            .await
    });
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert!(process.is_running().await);
    assert!(
        !pending.is_finished(),
        "query must still be executing before Host EOF"
    );
    drop(storage); // A live driver lease prevents deletion after Host exit.
    assert!(workspace.exists());
    process.close_input_for_file_query_test().await;
    tokio::time::timeout(Duration::from_secs(5), async {
        while process.is_running().await {
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .unwrap();
    assert!(pending.await.unwrap().is_err());
    assert!(workspace.exists(), "abrupt exit leaves cleanup to its Host");
    let recovered = storage::Storage::open(&storage_root).unwrap();
    assert!(!workspace.exists());
    drop(recovered);
    assert_eq!(fs::read(source).unwrap(), b"id\n1\n");
}
