use super::super::*;
use super::support::*;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

#[test]
fn verified_dependency_cache_is_reused_and_pruned_conservatively() {
    let directory = tempfile::tempdir().unwrap();
    let payload = b"verified jdbc dependency";
    let dependency = signed_jdbc_dependency(payload);
    let cache_path = dependency_cache_path(directory.path(), &dependency).unwrap();
    ensure_dependency_cache_parent(&cache_path).unwrap();
    fs::write(&cache_path, payload).unwrap();

    let staged = directory.path().join("package/lib/vendor.jar");
    assert!(copy_cached_dependency(&cache_path, &staged, &dependency).unwrap());
    assert_eq!(fs::read(&staged).unwrap(), payload);

    fs::write(&cache_path, b"tampered").unwrap();
    let retry = directory.path().join("package/lib/retry.jar");
    assert!(!copy_cached_dependency(&cache_path, &retry, &dependency).unwrap());
    assert!(!cache_path.exists());

    let cache_root = directory.path().join(DRIVER_DEPENDENCY_CACHE_DIRECTORY);
    let complete = cache_root.join(format!("{}.jar", "a".repeat(64)));
    let partial = cache_root.join(format!(".{}.jar.partial", "b".repeat(64)));
    let unknown = cache_root.join("README.txt");
    let nested = cache_root.join("nested");
    fs::write(&complete, b"complete").unwrap();
    fs::write(&partial, b"partial").unwrap();
    fs::write(&unknown, b"keep").unwrap();
    fs::create_dir(&nested).unwrap();

    let result = prune_dependency_cache_files(&cache_root).unwrap();
    assert_eq!(result.files_removed, 2);
    assert_eq!(result.partial_files_removed, 1);
    assert_eq!(result.bytes_removed, 15);
    assert_eq!(result.skipped_entries, 2);
    assert!(!complete.exists());
    assert!(!partial.exists());
    assert!(unknown.exists());
    assert!(nested.exists());
}

#[tokio::test]
async fn bundled_dependency_digest_mismatch_fails_before_network_access() {
    let directory = tempfile::tempdir().unwrap();
    let dependency = signed_jdbc_dependency(b"expected");
    let entry = dependency_catalog_entry(dependency.clone());
    let package = directory.path().join("package");
    fs::create_dir_all(package.join("lib")).unwrap();
    fs::write(package.join(&dependency.path), b"tampered").unwrap();
    let client = reqwest::Client::builder().no_proxy().build().unwrap();

    let error = hydrate_catalog_dependencies(&client, directory.path(), &entry, &package)
        .await
        .unwrap_err();
    assert!(error.contains("does not match the signed catalog"));
    assert!(!directory
        .path()
        .join(DRIVER_DEPENDENCY_CACHE_DIRECTORY)
        .exists());
}

#[test]
fn dependency_content_range_must_match_offset_and_signed_total() {
    let valid = reqwest::header::HeaderValue::from_static("bytes 7-15/16");
    assert!(validate_dependency_content_range(Some(&valid), 7, 16).is_ok());
    assert!(validate_dependency_content_range(Some(&valid), 8, 16).is_err());
    assert!(validate_dependency_content_range(Some(&valid), 7, 17).is_err());
    assert!(validate_dependency_content_range(None, 7, 16).is_err());
}

#[tokio::test]
async fn dependency_download_resumes_into_digest_bound_cache() {
    let directory = tempfile::tempdir().unwrap();
    let payload = b"verified resumable jdbc dependency";
    let retained = 10usize;
    let mut dependency = signed_jdbc_dependency(payload);
    let cache_path = dependency_cache_path(directory.path(), &dependency).unwrap();
    ensure_dependency_cache_parent(&cache_path).unwrap();
    let partial_path = cache_path.with_file_name(format!(
        ".{}.jar.partial",
        dependency.sha256.to_ascii_lowercase()
    ));
    fs::write(&partial_path, &payload[..retained]).unwrap();

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    dependency.download_url = format!("http://{address}/vendor.jar");
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

    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    download_catalog_dependency(&client, &dependency, &cache_path)
        .await
        .unwrap();
    server.await.unwrap();
    assert_eq!(fs::read(&cache_path).unwrap(), payload);
    assert!(!partial_path.exists());
}
