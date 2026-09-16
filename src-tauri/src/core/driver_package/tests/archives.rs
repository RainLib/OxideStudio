use super::super::*;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

#[test]
fn archive_paths_are_confined_to_the_package_root() {
    assert_eq!(
        safe_archive_relative_path(Path::new("sidecar/bin/driver"))
            .expect("normal relative path is accepted"),
        PathBuf::from("sidecar/bin/driver")
    );
    assert!(safe_archive_relative_path(Path::new("../manifest.json")).is_err());
    assert!(safe_archive_relative_path(Path::new("/manifest.json")).is_err());
    assert!(safe_archive_relative_path(Path::new(".")).is_err());
}

#[test]
fn verified_catalog_archives_are_reused_and_corrupt_entries_are_discarded() {
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("release.tar.gz");
    let payload = b"verified catalog archive";
    fs::write(&source, payload).unwrap();
    let digest = format!("{:x}", Sha256::digest(payload));
    let cache_path =
        catalog_cache_archive_path(directory.path(), "clickhouse", "1.2.3", &digest).unwrap();

    cache_driver_package_archive(&source, &cache_path, &digest).unwrap();
    assert!(cache_path.exists());

    let staged = directory.path().join("staged.tar.gz");
    assert!(copy_cached_driver_package_archive(&cache_path, &staged, &digest).unwrap());
    assert_eq!(fs::read(&staged).unwrap(), payload);

    fs::write(&cache_path, b"tampered").unwrap();
    let retry = directory.path().join("retry.tar.gz");
    assert!(!copy_cached_driver_package_archive(&cache_path, &retry, &digest).unwrap());
    assert!(!cache_path.exists());
}

#[test]
fn driver_archive_content_range_must_continue_the_exact_partial() {
    let valid = reqwest::header::HeaderValue::from_static("bytes 7-15/16");
    assert!(validate_content_range(Some(&valid), 7).is_ok());

    let wrong_start = reqwest::header::HeaderValue::from_static("bytes 8-15/16");
    assert!(validate_content_range(Some(&wrong_start), 7).is_err());
    let oversized = reqwest::header::HeaderValue::from_str(&format!(
        "bytes 7-15/{}",
        MAX_DRIVER_PACKAGE_ARCHIVE_BYTES + 1
    ))
    .unwrap();
    assert!(validate_content_range(Some(&oversized), 7).is_err());
    assert!(validate_content_range(None, 7).is_err());
}

#[tokio::test]
async fn driver_archive_download_resumes_into_digest_bound_cache() {
    let directory = tempfile::tempdir().unwrap();
    let payload = b"verified resumable driver archive";
    let retained = 9usize;
    let digest = format!("{:x}", Sha256::digest(payload));
    let cache_path =
        catalog_cache_archive_path(directory.path(), "duckdb", "1.2.3", &digest).unwrap();
    ensure_catalog_cache_parent(&cache_path).unwrap();
    let partial_path = catalog_cache_partial_path(&cache_path).unwrap();
    fs::write(&partial_path, &payload[..retained]).unwrap();

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let suffix = payload[retained..].to_vec();
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut request = Vec::new();
        let mut buffer = [0u8; 1024];
        while !request.windows(4).any(|window| window == b"\r\n\r\n") {
            let read = stream.read(&mut buffer).await.unwrap();
            assert!(read > 0);
            request.extend_from_slice(&buffer[..read]);
        }
        let request = String::from_utf8(request).unwrap().to_ascii_lowercase();
        assert!(request.contains(&format!("range: bytes={retained}-")));
        let end = retained + suffix.len() - 1;
        let response = format!(
                "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {retained}-{end}/{}\r\nConnection: close\r\n\r\n",
                suffix.len(),
                retained + suffix.len()
            );
        stream.write_all(response.as_bytes()).await.unwrap();
        stream.write_all(&suffix).await.unwrap();
        stream.shutdown().await.unwrap();
    });

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        // This fixture owns a loopback listener. Ambient HTTP_PROXY must
        // not route the request to an external proxy and turn an offline
        // unit test into a flaky network dependency.
        .no_proxy()
        .build()
        .unwrap();
    download_driver_package_archive(
        &client,
        &format!("http://{address}/driver.tar.gz"),
        &cache_path,
        &digest,
    )
    .await
    .unwrap();
    server.await.unwrap();

    assert_eq!(fs::read(&cache_path).unwrap(), payload);
    assert!(!partial_path.exists());
}

#[tokio::test]
async fn catalog_cache_cleanup_retains_activation_rollback_pins_and_live_versions() {
    let directory = tempfile::tempdir().unwrap();
    let registry =
        DatabaseDriverPackageRegistry::allow_unsigned_for_tests(directory.path().to_path_buf());
    let driver_root = directory.path().join("duckdb");
    fs::create_dir_all(&driver_root).unwrap();
    write_activation_state(
        &driver_root,
        &DriverActivationState {
            current: "2.0.0".to_string(),
            previous: Some("1.0.0".to_string()),
        },
    )
    .unwrap();

    let cache_root = directory.path().join(DRIVER_PACKAGE_CACHE_DIRECTORY);
    let digest = "a".repeat(64);
    let create_cache = |driver: &str, version: &str, name: &str, payload: &[u8]| {
        let path = cache_root.join(driver).join(version).join(name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, payload).unwrap();
        path
    };
    let active = create_cache("duckdb", "2.0.0", &format!("{digest}.tar.gz"), b"active");
    let rollback = create_cache("duckdb", "1.0.0", &format!("{digest}.tar.gz"), b"rollback");
    let pinned = create_cache(
        "clickhouse",
        "3.0.0",
        &format!("{digest}.tar.gz"),
        b"pinned",
    );
    let live = create_cache("oracle", "4.0.0", &format!("{digest}.tar.gz"), b"live");
    let removable = create_cache("warehouse", "5.0.0", &format!("{digest}.tar.gz"), b"remove");
    let partial = create_cache(
        "warehouse",
        "5.0.0",
        &format!(".{digest}.tar.gz.partial"),
        b"partial",
    );
    let unknown = create_cache("warehouse", "6.0.0", "notes.txt", b"keep unknown");
    let mut retained = BTreeSet::new();
    retained.insert(("clickhouse".to_string(), "3.0.0".to_string()));
    retained.insert(("oracle".to_string(), "4.0.0".to_string()));

    let result = registry.prune_catalog_cache(&retained).await.unwrap();

    assert_eq!(result.files_removed, 2);
    assert_eq!(result.partial_files_removed, 1);
    assert_eq!(result.versions_removed, 1);
    assert_eq!(result.retained_versions, 4);
    assert_eq!(result.skipped_entries, 1);
    assert!(active.exists());
    assert!(rollback.exists());
    assert!(pinned.exists());
    assert!(live.exists());
    assert!(!removable.exists());
    assert!(!partial.exists());
    assert!(unknown.exists());
}
