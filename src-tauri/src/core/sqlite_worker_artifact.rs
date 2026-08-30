use flate2::read::GzDecoder;
use futures::StreamExt;
use minisign_verify::{PublicKey, Signature};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Cursor, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use tar::Archive;
use url::Url;

const WORKER_MANIFEST_NAME: &str = "manifest.json";
const WORKER_SIGNATURE_NAME: &str = "manifest.json.minisig";
const WORKER_ENTRYPOINT: &str = "oxide-sqlite-worker";
const MAX_WORKER_BYTES: u64 = 64 * 1024 * 1024;
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_SIGNATURE_BYTES: u64 = 64 * 1024;
const MAX_WORKER_ARCHIVE_BYTES: usize = 70 * 1024 * 1024;
const MAX_WORKER_ARCHIVE_FILES: usize = 8;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SqliteWorkerManifest {
    pub schema_version: u32,
    pub artifact_kind: String,
    pub package_id: String,
    pub package_version: String,
    pub protocol_version: u16,
    pub entrypoint: String,
    pub sha256: String,
    pub platform: String,
    pub rust_target: String,
    pub supported_remote_os: Vec<String>,
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ResolvedSqliteWorker {
    pub bytes: Vec<u8>,
    pub digest: String,
    pub version: String,
    pub platform: String,
}

#[derive(Debug, Clone)]
enum WorkerTrust {
    PublicKey(PublicKey),
    Unavailable,
    Invalid(String),
    #[cfg(test)]
    AllowUnsigned,
}

#[derive(Debug, Clone)]
pub struct SqliteWorkerArtifactRegistry {
    root: PathBuf,
    trust: WorkerTrust,
    default_download_base_url: Option<String>,
    mutation_lock: Arc<Mutex<()>>,
}

impl SqliteWorkerArtifactRegistry {
    pub fn new(root: PathBuf) -> Self {
        let trust = match option_env!("OXIDE_DRIVER_SIGNING_PUBLIC_KEY")
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            Some(value) => PublicKey::decode(value)
                .or_else(|_| PublicKey::from_base64(value))
                .map(WorkerTrust::PublicKey)
                .unwrap_or_else(|error| WorkerTrust::Invalid(error.to_string())),
            None => WorkerTrust::Unavailable,
        };
        Self {
            root,
            trust,
            default_download_base_url: compiled_worker_download_base_url(),
            mutation_lock: Arc::new(Mutex::new(())),
        }
    }

    #[cfg(test)]
    pub(crate) fn allow_unsigned_for_tests(root: PathBuf) -> Self {
        Self {
            root,
            trust: WorkerTrust::AllowUnsigned,
            default_download_base_url: None,
            mutation_lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn resolve(&self, platform: &str) -> Result<ResolvedSqliteWorker, String> {
        validate_platform(platform)?;
        #[cfg(debug_assertions)]
        if let Some(path) = std::env::var_os("OXIDE_SQLITE_WORKER_PATH") {
            let path = PathBuf::from(path);
            let bytes = read_regular_bounded_file(&path, MAX_WORKER_BYTES, "SQLite worker")?;
            return Ok(ResolvedSqliteWorker {
                digest: sha256_hex(&bytes),
                bytes,
                version: "development".to_string(),
                platform: platform.to_string(),
            });
        }

        let platform_root = self.root.join(platform);
        let version = fs::read_to_string(platform_root.join("current"))
            .map_err(|_| format!("No active SQLite SSH worker is installed for {platform}"))?;
        let version = version.trim();
        validate_token(version, "SQLite worker version")?;
        if version != oxide_sqlite_worker::SQLITE_WORKER_PACKAGE_VERSION {
            return Err(format!(
                "OxideStudio requires SQLite worker {}",
                oxide_sqlite_worker::SQLITE_WORKER_PACKAGE_VERSION
            ));
        }
        self.resolve_version(platform, version)
    }

    pub fn resolve_version(
        &self,
        platform: &str,
        version: &str,
    ) -> Result<ResolvedSqliteWorker, String> {
        validate_platform(platform)?;
        validate_token(version, "SQLite worker version")?;
        let package_root = self.root.join(platform).join(version);
        validate_package_boundary(&self.root, &package_root)?;
        let manifest_path = package_root.join(WORKER_MANIFEST_NAME);
        let manifest_bytes = read_regular_bounded_file(
            &manifest_path,
            MAX_MANIFEST_BYTES,
            "SQLite worker manifest",
        )?;
        let manifest: SqliteWorkerManifest = serde_json::from_slice(&manifest_bytes)
            .map_err(|error| format!("SQLite worker manifest is invalid JSON: {error}"))?;
        validate_manifest(&manifest, platform, version)?;
        verify_signature(
            &manifest_bytes,
            &package_root.join(WORKER_SIGNATURE_NAME),
            &self.trust,
        )?;
        let entrypoint = package_root.join(&manifest.entrypoint);
        let bytes = read_regular_bounded_file(&entrypoint, MAX_WORKER_BYTES, "SQLite worker")?;
        let digest = sha256_hex(&bytes);
        if !digest.eq_ignore_ascii_case(&manifest.sha256) {
            return Err(
                "SQLite worker binary digest does not match its signed manifest".to_string(),
            );
        }
        Ok(ResolvedSqliteWorker {
            bytes,
            digest,
            version: manifest.package_version,
            platform: manifest.platform,
        })
    }

    pub fn install_from_directory(
        &self,
        source: &Path,
        activate: bool,
    ) -> Result<SqliteWorkerManifest, String> {
        let _guard = self
            .mutation_lock
            .lock()
            .map_err(|_| "SQLite worker store is unavailable".to_string())?;
        self.install_from_directory_unlocked(source, activate)
    }

    fn install_from_directory_unlocked(
        &self,
        source: &Path,
        activate: bool,
    ) -> Result<SqliteWorkerManifest, String> {
        let source = fs::canonicalize(source)
            .map_err(|error| format!("Cannot resolve SQLite worker package: {error}"))?;
        let manifest_bytes = read_regular_bounded_file(
            &source.join(WORKER_MANIFEST_NAME),
            MAX_MANIFEST_BYTES,
            "SQLite worker manifest",
        )?;
        let manifest: SqliteWorkerManifest = serde_json::from_slice(&manifest_bytes)
            .map_err(|error| format!("SQLite worker manifest is invalid JSON: {error}"))?;
        validate_manifest(&manifest, &manifest.platform, &manifest.package_version)?;
        verify_signature(
            &manifest_bytes,
            &source.join(WORKER_SIGNATURE_NAME),
            &self.trust,
        )?;
        let worker = read_regular_bounded_file(
            &source.join(&manifest.entrypoint),
            MAX_WORKER_BYTES,
            "SQLite worker",
        )?;
        if sha256_hex(&worker) != manifest.sha256.to_ascii_lowercase() {
            return Err(
                "SQLite worker binary digest does not match its signed manifest".to_string(),
            );
        }

        let platform_root = self.root.join(&manifest.platform);
        fs::create_dir_all(&platform_root)
            .map_err(|error| format!("Cannot create SQLite worker store: {error}"))?;
        let destination = platform_root.join(&manifest.package_version);
        if destination.exists() {
            let existing = self.resolve_version(&manifest.platform, &manifest.package_version)?;
            if existing.digest != manifest.sha256 {
                return Err(
                    "Installed SQLite worker version has a different immutable digest".to_string(),
                );
            }
            if activate {
                activate_version(&platform_root, &manifest.package_version)?;
            }
            return Ok(manifest);
        }
        let staging = tempfile::Builder::new()
            .prefix("oxide-sqlite-worker-")
            .tempdir_in(&platform_root)
            .map_err(|error| format!("Cannot stage SQLite worker: {error}"))?;
        fs::write(staging.path().join(WORKER_MANIFEST_NAME), &manifest_bytes)
            .map_err(|error| format!("Cannot stage SQLite worker manifest: {error}"))?;
        fs::copy(
            source.join(WORKER_SIGNATURE_NAME),
            staging.path().join(WORKER_SIGNATURE_NAME),
        )
        .map_err(|error| format!("Cannot stage SQLite worker signature: {error}"))?;
        fs::write(staging.path().join(WORKER_ENTRYPOINT), &worker)
            .map_err(|error| format!("Cannot stage SQLite worker binary: {error}"))?;
        fs::rename(staging.keep(), &destination)
            .map_err(|error| format!("Cannot publish SQLite worker installation: {error}"))?;
        if activate {
            activate_version(&platform_root, &manifest.package_version)?;
        }
        Ok(manifest)
    }

    pub async fn install_release(
        &self,
        base_url: &str,
        platform: &str,
        version: &str,
    ) -> Result<SqliteWorkerManifest, String> {
        validate_platform(platform)?;
        validate_token(version, "SQLite worker version")?;
        if version != oxide_sqlite_worker::SQLITE_WORKER_PACKAGE_VERSION {
            return Err(format!(
                "OxideStudio requires SQLite worker {}",
                oxide_sqlite_worker::SQLITE_WORKER_PACKAGE_VERSION
            ));
        }
        let base_url = if base_url.trim().is_empty() {
            self.default_download_base_url.as_deref().ok_or_else(|| {
                "Configure a signed HTTPS SQLite worker source before connecting".to_string()
            })?
        } else {
            base_url.trim()
        };
        let archive_url = worker_archive_url(base_url, version, platform)?;
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(120))
            .user_agent("OxideStudio SQLite worker installer")
            .build()
            .map_err(|error| format!("Cannot initialize SQLite worker installer: {error}"))?;
        let response = client
            .get(archive_url)
            .send()
            .await
            .map_err(|error| format!("Cannot download SQLite worker: {error}"))?;
        if !response.status().is_success() {
            return Err(format!(
                "Cannot download SQLite worker: server returned {}",
                response.status()
            ));
        }
        if response
            .content_length()
            .is_some_and(|length| length == 0 || length > MAX_WORKER_ARCHIVE_BYTES as u64)
        {
            return Err("SQLite worker archive is empty or exceeds 70 MiB".to_string());
        }
        let mut archive = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk =
                chunk.map_err(|error| format!("Cannot read SQLite worker archive: {error}"))?;
            if archive.len().saturating_add(chunk.len()) > MAX_WORKER_ARCHIVE_BYTES {
                return Err("SQLite worker archive exceeds 70 MiB".to_string());
            }
            archive.extend_from_slice(&chunk);
        }
        if archive.is_empty() {
            return Err("SQLite worker archive is empty".to_string());
        }
        let root = self.root.clone();
        let registry = self.clone();
        let platform = platform.to_string();
        let version = version.to_string();
        tokio::task::spawn_blocking(move || {
            let parent = root.parent().unwrap_or_else(|| Path::new("."));
            fs::create_dir_all(parent)
                .map_err(|error| format!("Cannot create SQLite worker store parent: {error}"))?;
            let unpacked = tempfile::Builder::new()
                .prefix("oxide-sqlite-worker-download-")
                .tempdir_in(parent)
                .map_err(|error| format!("Cannot stage SQLite worker download: {error}"))?;
            extract_worker_archive(&archive, unpacked.path())?;
            let manifest = registry.install_from_directory(unpacked.path(), true)?;
            if manifest.platform != platform || manifest.package_version != version {
                return Err(
                    "Downloaded SQLite worker identity changed during installation".to_string(),
                );
            }
            Ok(manifest)
        })
        .await
        .map_err(|_| "SQLite worker installation was interrupted".to_string())?
    }
}

fn compiled_worker_download_base_url() -> Option<String> {
    let base_url = option_env!("OXIDE_RELEASE_BASE_URL")?.trim();
    let prefix = option_env!("ALIYUN_OSS_PREFIX").unwrap_or_default().trim();
    worker_download_base_url(base_url, prefix).ok()
}

fn worker_download_base_url(base_url: &str, object_prefix: &str) -> Result<String, String> {
    let mut base = Url::parse(base_url.trim())
        .map_err(|_| "Release download base URL is invalid".to_string())?;
    if base.scheme() != "https"
        || base.host_str().is_none()
        || !base.username().is_empty()
        || base.password().is_some()
        || base.query().is_some()
        || base.fragment().is_some()
    {
        return Err("Release download base URL must be credential-free HTTPS".to_string());
    }
    let prefix = object_prefix.trim().trim_matches('/');
    let prefix_segments = if prefix.is_empty() {
        Vec::new()
    } else {
        let segments = prefix.split('/').collect::<Vec<_>>();
        if segments.iter().any(|segment| {
            segment.is_empty()
                || matches!(*segment, "." | "..")
                || segment.contains(['\\', '\0', '\n', '\r'])
        }) {
            return Err("OSS object prefix is invalid".to_string());
        }
        segments
    };
    let mut encoded_prefix_url = Url::parse("https://prefix.invalid/").expect("static URL");
    if !prefix_segments.is_empty() {
        encoded_prefix_url
            .path_segments_mut()
            .map_err(|_| "OSS object prefix cannot be applied".to_string())?
            .extend(prefix_segments.iter().copied());
    }
    let encoded_prefix = encoded_prefix_url.path().trim_matches('/');
    let base_path = base.path().trim_matches('/');
    let already_prefixed = !encoded_prefix.is_empty()
        && (base_path == encoded_prefix
            || base_path
                .strip_suffix(encoded_prefix)
                .is_some_and(|head| head.ends_with('/')));
    {
        let mut path = base
            .path_segments_mut()
            .map_err(|_| "Release download base URL cannot contain path segments".to_string())?;
        path.pop_if_empty();
        if !already_prefixed {
            path.extend(prefix_segments.iter().copied());
        }
        path.extend(["workers", "sqlite"]);
    }
    Ok(base.as_str().trim_end_matches('/').to_string())
}

fn worker_archive_url(base_url: &str, version: &str, platform: &str) -> Result<Url, String> {
    validate_token(version, "SQLite worker version")?;
    validate_platform(platform)?;
    let mut base = Url::parse(base_url.trim())
        .map_err(|_| "SQLite worker download base URL is invalid".to_string())?;
    if base.scheme() != "https"
        || base.host_str().is_none()
        || !base.username().is_empty()
        || base.password().is_some()
        || base.query().is_some()
        || base.fragment().is_some()
    {
        return Err("SQLite worker download base URL must be credential-free HTTPS".to_string());
    }
    let mut path = base.path().trim_end_matches('/').to_string();
    path.push('/');
    path.push_str(version);
    path.push('/');
    path.push_str(platform);
    path.push_str("/package.tar.gz");
    base.set_path(&path);
    Ok(base)
}

fn extract_worker_archive(bytes: &[u8], destination: &Path) -> Result<(), String> {
    let decoder = GzDecoder::new(Cursor::new(bytes));
    let mut archive = Archive::new(decoder);
    let mut files = 0usize;
    let mut total = 0u64;
    for entry in archive
        .entries()
        .map_err(|error| format!("Cannot read SQLite worker archive: {error}"))?
    {
        let mut entry =
            entry.map_err(|error| format!("Cannot read SQLite worker archive entry: {error}"))?;
        if !entry.header().entry_type().is_file() {
            return Err("SQLite worker archive contains a non-regular file".to_string());
        }
        files = files.saturating_add(1);
        if files > MAX_WORKER_ARCHIVE_FILES {
            return Err("SQLite worker archive contains too many files".to_string());
        }
        let path = entry
            .path()
            .map_err(|error| format!("SQLite worker archive path is invalid: {error}"))?;
        if path.components().count() != 1
            || path
                .components()
                .any(|component| !matches!(component, Component::Normal(_)))
        {
            return Err("SQLite worker archive contains an unsafe path".to_string());
        }
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| "SQLite worker archive filename is invalid".to_string())?;
        if !matches!(
            name,
            WORKER_MANIFEST_NAME | WORKER_SIGNATURE_NAME | WORKER_ENTRYPOINT
        ) {
            return Err("SQLite worker archive contains an unknown file".to_string());
        }
        let declared = entry.size();
        total = total.saturating_add(declared);
        if total > MAX_WORKER_ARCHIVE_BYTES as u64 {
            return Err("SQLite worker archive expands beyond 70 MiB".to_string());
        }
        let destination = destination.join(name);
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)
            .map_err(|error| format!("Cannot create SQLite worker archive file: {error}"))?;
        let copied = std::io::copy(&mut entry, &mut output)
            .map_err(|error| format!("Cannot extract SQLite worker archive: {error}"))?;
        if copied != declared {
            return Err("SQLite worker archive entry size changed during extraction".to_string());
        }
        output
            .sync_all()
            .map_err(|error| format!("Cannot finalize SQLite worker archive file: {error}"))?;
    }
    for required in [
        WORKER_MANIFEST_NAME,
        WORKER_SIGNATURE_NAME,
        WORKER_ENTRYPOINT,
    ] {
        if !destination.join(required).is_file() {
            return Err(format!("SQLite worker archive is missing {required}"));
        }
    }
    Ok(())
}

fn validate_manifest(
    manifest: &SqliteWorkerManifest,
    platform: &str,
    version: &str,
) -> Result<(), String> {
    if manifest.schema_version != 1
        || manifest.artifact_kind != "sqlite-ssh-worker"
        || manifest.package_id != "oxide.sqlite-ssh-worker"
        || manifest.protocol_version != oxide_sqlite_worker::SQLITE_WORKER_PROTOCOL_VERSION
        || manifest.entrypoint != WORKER_ENTRYPOINT
        || manifest.platform != platform
        || manifest.package_version != version
        || manifest.supported_remote_os != ["linux"]
    {
        return Err("SQLite worker manifest identity is incompatible with this Host".to_string());
    }
    validate_token(&manifest.package_version, "SQLite worker version")?;
    validate_platform(&manifest.platform)?;
    if manifest.sha256.len() != 64
        || !manifest
            .sha256
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err("SQLite worker manifest contains an invalid SHA-256".to_string());
    }
    let expected_target = match platform {
        "linux-x64" => "x86_64-unknown-linux-musl",
        "linux-aarch64" => "aarch64-unknown-linux-musl",
        _ => return Err("Unsupported SQLite worker platform".to_string()),
    };
    if manifest.rust_target != expected_target {
        return Err("SQLite worker target does not match its platform".to_string());
    }
    let expected = [
        "interrupt",
        "metadata",
        "online-backup",
        "parameterized-execute",
        "parameterized-query",
        "restore",
    ];
    let mut actual = manifest
        .capabilities
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>();
    actual.sort_unstable();
    if actual != expected {
        return Err("SQLite worker capability contract is incomplete or unknown".to_string());
    }
    Ok(())
}

fn validate_platform(platform: &str) -> Result<(), String> {
    if matches!(platform, "linux-x64" | "linux-aarch64") {
        Ok(())
    } else {
        Err("Remote SQLite supports Linux amd64 and arm64 hosts only".to_string())
    }
}

fn validate_token(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 96
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
        })
    {
        Err(format!("{label} is invalid"))
    } else {
        Ok(())
    }
}

fn validate_package_boundary(root: &Path, package_root: &Path) -> Result<(), String> {
    if package_root.components().any(|component| {
        !matches!(
            component,
            Component::Prefix(_) | Component::RootDir | Component::Normal(_)
        )
    }) {
        return Err("SQLite worker package path is invalid".to_string());
    }
    let canonical_root = fs::canonicalize(root)
        .map_err(|error| format!("Cannot resolve SQLite worker store: {error}"))?;
    let canonical_package = fs::canonicalize(package_root)
        .map_err(|error| format!("Cannot resolve SQLite worker package: {error}"))?;
    if !canonical_package.starts_with(&canonical_root) {
        return Err("SQLite worker package escapes its configured store".to_string());
    }
    Ok(())
}

fn read_regular_bounded_file(path: &Path, max_bytes: u64, label: &str) -> Result<Vec<u8>, String> {
    let metadata =
        fs::symlink_metadata(path).map_err(|error| format!("Cannot inspect {label}: {error}"))?;
    if !metadata.file_type().is_file() || metadata.len() == 0 || metadata.len() > max_bytes {
        return Err(format!(
            "{label} is missing, empty, symbolic, or exceeds its size limit"
        ));
    }
    fs::read(path).map_err(|error| format!("Cannot read {label}: {error}"))
}

fn verify_signature(
    manifest: &[u8],
    signature_path: &Path,
    trust: &WorkerTrust,
) -> Result<(), String> {
    #[cfg(test)]
    if matches!(trust, WorkerTrust::AllowUnsigned) {
        return Ok(());
    }
    let signature = read_regular_bounded_file(
        signature_path,
        MAX_SIGNATURE_BYTES,
        "SQLite worker signature",
    )?;
    match trust {
        WorkerTrust::PublicKey(public_key) => {
            let signature = std::str::from_utf8(&signature)
                .map_err(|error| format!("SQLite worker signature is not UTF-8: {error}"))?;
            let signature = Signature::decode(signature)
                .map_err(|error| format!("SQLite worker signature is invalid: {error}"))?;
            public_key
                .verify(manifest, &signature, false)
                .map_err(|error| format!("SQLite worker signature is not trusted: {error}"))
        }
        WorkerTrust::Unavailable => {
            Err("No trusted SQLite worker signing key is configured in this build".to_string())
        }
        WorkerTrust::Invalid(error) => Err(format!(
            "The SQLite worker signing key configured for this build is invalid: {error}"
        )),
        #[cfg(test)]
        WorkerTrust::AllowUnsigned => Ok(()),
    }
}

fn activate_version(platform_root: &Path, version: &str) -> Result<(), String> {
    let mut temporary = tempfile::NamedTempFile::new_in(platform_root)
        .map_err(|error| format!("Cannot stage SQLite worker activation: {error}"))?;
    temporary
        .write_all(version.as_bytes())
        .map_err(|error| format!("Cannot write SQLite worker activation: {error}"))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| format!("Cannot sync SQLite worker activation: {error}"))?;
    temporary
        .persist(platform_root.join("current"))
        .map_err(|error| format!("Cannot activate SQLite worker: {}", error.error))?;
    Ok(())
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{write::GzEncoder, Compression};

    fn fixture_manifest(bytes: &[u8]) -> SqliteWorkerManifest {
        SqliteWorkerManifest {
            schema_version: 1,
            artifact_kind: "sqlite-ssh-worker".into(),
            package_id: "oxide.sqlite-ssh-worker".into(),
            package_version: oxide_sqlite_worker::SQLITE_WORKER_PACKAGE_VERSION.into(),
            protocol_version: oxide_sqlite_worker::SQLITE_WORKER_PROTOCOL_VERSION,
            entrypoint: WORKER_ENTRYPOINT.into(),
            sha256: sha256_hex(bytes),
            platform: "linux-x64".into(),
            rust_target: "x86_64-unknown-linux-musl".into(),
            supported_remote_os: vec!["linux".into()],
            capabilities: vec![
                "parameterized-query".into(),
                "parameterized-execute".into(),
                "metadata".into(),
                "online-backup".into(),
                "restore".into(),
                "interrupt".into(),
            ],
        }
    }

    #[test]
    fn installs_activates_and_revalidates_a_manifest_bound_worker() {
        let source = tempfile::tempdir().unwrap();
        let store = tempfile::tempdir().unwrap();
        let bytes = b"worker fixture";
        let manifest = fixture_manifest(bytes);
        fs::write(source.path().join(WORKER_ENTRYPOINT), bytes).unwrap();
        fs::write(
            source.path().join(WORKER_MANIFEST_NAME),
            serde_json::to_vec_pretty(&manifest).unwrap(),
        )
        .unwrap();
        fs::write(source.path().join(WORKER_SIGNATURE_NAME), b"test").unwrap();
        let registry = SqliteWorkerArtifactRegistry::allow_unsigned_for_tests(store.path().into());
        registry
            .install_from_directory(source.path(), true)
            .unwrap();
        let resolved = registry.resolve("linux-x64").unwrap();
        assert_eq!(resolved.bytes, bytes);
        assert_eq!(resolved.digest, manifest.sha256);
        assert_eq!(
            resolved.version,
            oxide_sqlite_worker::SQLITE_WORKER_PACKAGE_VERSION
        );
        registry
            .install_from_directory(source.path(), true)
            .expect("installing the exact immutable package is idempotent");
        fs::write(store.path().join("linux-x64").join("current"), "0.0.0").unwrap();
        assert!(registry.resolve("linux-x64").is_err());
    }

    #[test]
    fn rejects_platform_and_digest_substitution() {
        let source = tempfile::tempdir().unwrap();
        let store = tempfile::tempdir().unwrap();
        let bytes = b"worker fixture";
        let manifest = fixture_manifest(bytes);
        fs::write(source.path().join(WORKER_ENTRYPOINT), b"substituted").unwrap();
        fs::write(
            source.path().join(WORKER_MANIFEST_NAME),
            serde_json::to_vec_pretty(&manifest).unwrap(),
        )
        .unwrap();
        fs::write(source.path().join(WORKER_SIGNATURE_NAME), b"test").unwrap();
        let registry = SqliteWorkerArtifactRegistry::allow_unsigned_for_tests(store.path().into());
        assert!(registry
            .install_from_directory(source.path(), true)
            .is_err());
        assert!(registry.resolve("windows-x64").is_err());
    }

    #[test]
    fn release_urls_are_https_identity_bound_and_have_no_ambient_credentials() {
        assert_eq!(
            worker_archive_url(
                "https://downloads.example.com/sqlite-workers",
                "1.2.3",
                "linux-aarch64"
            )
            .unwrap()
            .as_str(),
            "https://downloads.example.com/sqlite-workers/1.2.3/linux-aarch64/package.tar.gz"
        );
        for invalid in [
            "http://downloads.example.com/workers",
            "https://user:secret@downloads.example.com/workers",
            "https://downloads.example.com/workers?channel=latest",
            "https://downloads.example.com/workers#latest",
        ] {
            assert!(worker_archive_url(invalid, "1.2.3", "linux-x64").is_err());
        }
        assert!(worker_archive_url(
            "https://downloads.example.com/workers",
            "../latest",
            "linux-x64"
        )
        .is_err());
    }

    #[test]
    fn official_worker_source_reuses_the_release_prefix_without_duplication() {
        assert_eq!(
            worker_download_base_url("https://downloads.example.com", "oxide-studio/releases")
                .unwrap(),
            "https://downloads.example.com/oxide-studio/releases/workers/sqlite"
        );
        assert_eq!(
            worker_download_base_url(
                "https://downloads.example.com/oxide-studio/releases/",
                "/oxide-studio/releases/"
            )
            .unwrap(),
            "https://downloads.example.com/oxide-studio/releases/workers/sqlite"
        );
        assert!(worker_download_base_url("http://downloads.example.com", "release").is_err());
        assert!(worker_download_base_url("https://downloads.example.com", "../release").is_err());
    }

    #[test]
    fn archive_extraction_rejects_unknown_and_duplicate_files() {
        fn archive(entries: &[(&str, &[u8])]) -> Vec<u8> {
            let encoder = GzEncoder::new(Vec::new(), Compression::default());
            let mut builder = tar::Builder::new(encoder);
            for (name, bytes) in entries {
                let mut header = tar::Header::new_gnu();
                header.set_size(bytes.len() as u64);
                header.set_mode(0o600);
                header.set_cksum();
                builder.append_data(&mut header, *name, *bytes).unwrap();
            }
            builder.into_inner().unwrap().finish().unwrap()
        }

        let destination = tempfile::tempdir().unwrap();
        let unknown = archive(&[("unexpected", b"payload")]);
        assert!(extract_worker_archive(&unknown, destination.path()).is_err());

        let destination = tempfile::tempdir().unwrap();
        let duplicate = archive(&[
            (WORKER_MANIFEST_NAME, b"first"),
            (WORKER_MANIFEST_NAME, b"second"),
            (WORKER_SIGNATURE_NAME, b"signature"),
            (WORKER_ENTRYPOINT, b"worker"),
        ]);
        assert!(extract_worker_archive(&duplicate, destination.path()).is_err());
    }
}
