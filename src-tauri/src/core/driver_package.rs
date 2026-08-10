use crate::core::dialect::{DatabaseCapabilities, DECLARED_TABLE_EXPORT_FORMATS};
use flate2::read::GzDecoder;
use futures::StreamExt;
use minisign_verify::{PublicKey, Signature};
pub use oxide_driver_protocol::DRIVER_PROTOCOL_VERSION;
use oxide_driver_protocol::{HandshakeResponse, SchemaMigrationMode};
use regex::Regex;
use reqwest::{
    header::{CONTENT_RANGE, RANGE},
    StatusCode,
};
use semver::{Version, VersionReq};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tar::Archive;
use tempfile::{NamedTempFile, TempDir};
use tokio::sync::Mutex as AsyncMutex;
use url::Url;
use uuid::Uuid;

pub const DRIVER_PACKAGE_SCHEMA_VERSION: u32 = 1;
pub const DRIVER_PACKAGE_CATALOG_SCHEMA_VERSION: u32 = 1;
const MAX_DRIVER_MANIFEST_BYTES: u64 = 256 * 1024;
const MAX_DRIVER_SIGNATURE_BYTES: u64 = 64 * 1024;
const MAX_DRIVER_PACKAGE_FILES: usize = 4_096;
const MAX_DRIVER_PACKAGE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_DRIVER_PACKAGE_DEPTH: usize = 32;
const MAX_DRIVER_PACKAGE_ARCHIVE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_DRIVER_CATALOG_BYTES: u64 = 512 * 1024;
const MAX_DRIVER_CATALOG_ENTRIES: usize = 256;
const MAX_DRIVER_CATALOG_FIELD_LENGTH: usize = 512;
const DRIVER_PACKAGE_CACHE_DIRECTORY: &str = "_catalog-cache";
const DRIVER_PACKAGE_CATALOG_RECEIPT: &str = ".oxide-catalog-receipt.json";
const MANAGED_JAVA_RUNTIME_MANIFEST: &str = "runtime.json";
const MANAGED_JAVA_RUNTIME_KIND: &str = "java";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DriverPackageManifest {
    pub schema_version: u32,
    pub package_id: String,
    pub package_version: String,
    pub protocol_version: String,
    pub driver_id: String,
    pub display_name: String,
    pub client_library: String,
    pub client_version: String,
    pub entrypoint: String,
    pub sha256: String,
    /// Native sidecars remain the default. Java is explicit because it needs a
    /// separately managed and verified runtime; we never fall back to a Java
    /// executable discovered from PATH.
    #[serde(default)]
    pub runtime: DriverPackageRuntime,
    #[serde(default)]
    pub supported_targets: Vec<String>,
    #[serde(default)]
    pub server_version_range: Option<String>,
    /// Optional signed template used solely to prefill the connection form for
    /// drivers whose URL grammar cannot be represented by `scheme://host/db`.
    /// It may contain only `{host}`, `{port}`, `{database}`, `{user}`, and
    /// `{password}` placeholders; the sidecar still receives the final URL as
    /// an opaque string and remains the execution authority.
    #[serde(default)]
    pub connection_url_template: Option<String>,
    /// Signed, user-facing feature contract for this driver. This prevents
    /// unknown packages from being rendered as generic relational SQL drivers.
    #[serde(default)]
    pub capabilities: Option<DatabaseCapabilities>,
    /// Signed semantic migration contract. The runtime handshake must also
    /// advertise `semanticSchemaMigration`; neither signal is sufficient by
    /// itself, and Host-generated SQL is never part of this protocol.
    #[serde(default)]
    pub schema_migration: Option<DriverPackageSchemaMigrationContract>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DriverPackageSchemaMigrationContract {
    pub snapshot_version: u32,
    pub mode: SchemaMigrationMode,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DriverPackageRuntime {
    #[default]
    Native,
    Java(DriverPackageJavaRuntime),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DriverPackageJavaRuntime {
    /// DBX's agents use Java 21. Keep this strict so package authors cannot
    /// silently opt into an arbitrary host JVM with different security fixes.
    pub java_major: u8,
    pub main_class: String,
    #[serde(default)]
    pub classpath: Vec<DriverPackageClasspathEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DriverPackageClasspathEntry {
    pub path: String,
    pub sha256: String,
}

/// A separately signed Java runtime installation. Keeping the runtime outside
/// every vendor package avoids repeated JRE payloads and allows it to receive
/// security updates on its own lifecycle.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManagedJavaRuntimeManifest {
    pub schema_version: u32,
    pub runtime_kind: String,
    pub java_major: u8,
    pub runtime_version: String,
    pub entrypoint: String,
    pub sha256: String,
    #[serde(default)]
    pub supported_targets: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ManagedJavaRuntimeInstallation {
    pub java_major: u8,
    pub runtime_version: String,
    pub target: String,
    pub active: bool,
    pub status: DriverPackageStatus,
    pub status_message: Option<String>,
}

/// A signed, discovery-only feed for independently distributed driver packages.
/// Catalog entries never grant installation authority: an imported package must
/// still pass the local manifest, signature, target, and entrypoint checks.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DriverPackageCatalog {
    pub schema_version: u32,
    #[serde(default)]
    pub generated_at: Option<String>,
    pub packages: Vec<DriverPackageCatalogEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DriverPackageCatalogEntry {
    pub driver_id: String,
    pub display_name: String,
    pub package_version: String,
    pub protocol_version: String,
    pub download_url: String,
    /// Required before a catalog entry can be installed directly. The catalog
    /// itself is signed, but binding the archive digest prevents a changed
    /// object at an otherwise valid HTTPS URL from entering extraction.
    #[serde(default)]
    pub archive_sha256: Option<String>,
    #[serde(default)]
    pub supported_targets: Vec<String>,
    #[serde(default)]
    pub server_version_range: Option<String>,
    #[serde(default)]
    pub release_notes_url: Option<String>,
    /// Discovery-only copy of the signed package connection template. It
    /// helps users recognize JDBC-style packages before installation, but the
    /// imported package manifest is revalidated independently.
    #[serde(default)]
    pub connection_url_template: Option<String>,
    /// Signed discovery metadata only. It lets the driver manager describe a
    /// package's intended data model and editor route before installation;
    /// execution still requires importing and validating that package's own
    /// manifest and sidecar handshake.
    #[serde(default)]
    pub capabilities: Option<DatabaseCapabilities>,
    /// Discovery copy of the package-owned semantic migration contract. The
    /// independently signed package manifest must match it exactly.
    #[serde(default)]
    pub schema_migration: Option<DriverPackageSchemaMigrationContract>,
    /// Signed release evidence displayed before installation. This is not a
    /// trust bypass: package installation and sidecar handshake remain the
    /// executable authority.
    #[serde(default)]
    pub conformance: Option<DriverPackageConformance>,
}

/// Server-version coverage advertised by a signed package release. Each list
/// records versions on which that specific operation was exercised; an empty
/// list means the package makes no public claim for that operation.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DriverPackageConformance {
    #[serde(default)]
    pub connect: Vec<String>,
    #[serde(default)]
    pub metadata: Vec<String>,
    #[serde(default)]
    pub query: Vec<String>,
    #[serde(default)]
    pub cancellation: Vec<String>,
    #[serde(default)]
    pub mutations: Vec<String>,
    #[serde(default)]
    pub migration: Vec<String>,
    /// Versions exercised with the reviewed table-to-table data transfer
    /// contract. This is deliberately distinct from generic row mutations:
    /// it proves source paging, type mapping and partial-commit reporting.
    #[serde(default)]
    pub data_transfer: Vec<String>,
    /// Hash-bound reports emitted by the official conformance runner. Version
    /// strings without a matching evidence reference are rejected from the
    /// signed catalog, so release coverage is always traceable.
    #[serde(default)]
    pub evidence: Vec<DriverPackageConformanceEvidence>,
}

/// Privacy-bounded pointer to one exact package/server conformance report.
/// The signed catalog binds report and fixture digests; reports must not carry
/// connection URLs, credentials, SQL text or result values.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DriverPackageConformanceEvidence {
    pub schema_version: u32,
    pub runner_version: String,
    pub driver_id: String,
    pub package_version: String,
    pub entrypoint_sha256: String,
    pub target: String,
    pub server_version: String,
    pub fixture_id: String,
    pub fixture_sha256: String,
    pub report_url: String,
    pub report_sha256: String,
    pub operations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InstalledDriverPackage {
    pub manifest: DriverPackageManifest,
    pub package_root: PathBuf,
    pub entrypoint: PathBuf,
    pub active: bool,
    pub status: DriverPackageStatus,
    pub status_message: Option<String>,
    /// Host-written receipt from the exact signed catalog entry used for this
    /// installation. It is intentionally excluded from renderer responses.
    #[serde(skip_serializing)]
    pub(crate) catalog_entry: Option<DriverPackageCatalogEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DriverPackageCatalogReceipt {
    schema_version: u32,
    entry: DriverPackageCatalogEntry,
}

impl InstalledDriverPackage {
    /// Exact migration evidence is narrower than general package compatibility:
    /// wildcard target records and version-family assumptions never authorize
    /// a live migration.
    pub fn has_exact_migration_evidence(&self, server_version: &str) -> bool {
        let Some(entry) = self.catalog_entry.as_ref() else {
            return false;
        };
        let Some(conformance) = entry.conformance.as_ref() else {
            return false;
        };
        if self.manifest.schema_migration.is_none()
            || !conformance
                .migration
                .iter()
                .any(|version| version.eq_ignore_ascii_case(server_version.trim()))
        {
            return false;
        }
        let targets = current_target_aliases();
        conformance.evidence.iter().any(|evidence| {
            evidence.driver_id == self.manifest.driver_id
                && evidence.package_version == self.manifest.package_version
                && evidence
                    .entrypoint_sha256
                    .eq_ignore_ascii_case(&self.manifest.sha256)
                && evidence
                    .server_version
                    .eq_ignore_ascii_case(server_version.trim())
                && evidence
                    .operations
                    .iter()
                    .any(|operation| operation == "migration")
                && targets
                    .iter()
                    .any(|target| evidence.target.eq_ignore_ascii_case(target))
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DriverActivationState {
    pub current: String,
    pub previous: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DriverPackageStatus {
    Ready,
    Incompatible,
    Untrusted,
    Invalid,
}

/// Summary of a bounded cleanup of downloaded catalog archives. Installed
/// packages are never part of this cache and are therefore never removed.
#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DriverPackageCachePruneResult {
    pub files_removed: u64,
    pub partial_files_removed: u64,
    pub bytes_removed: u64,
    pub versions_removed: u64,
    pub retained_versions: u64,
    pub skipped_entries: u64,
}

#[derive(Debug, Clone)]
pub struct DatabaseDriverPackageRegistry {
    root: PathBuf,
    trust: DriverPackageTrust,
    mutation_lock: Arc<Mutex<()>>,
    download_lock: Arc<AsyncMutex<()>>,
}

#[derive(Debug, Clone)]
enum DriverPackageTrust {
    PublicKey(PublicKey),
    Unavailable,
    InvalidKey(String),
    #[cfg(test)]
    AllowUnsigned,
}

impl DatabaseDriverPackageRegistry {
    pub fn new(root: PathBuf) -> Self {
        let trust = match option_env!("OXIDE_DRIVER_SIGNING_PUBLIC_KEY")
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            Some(value) => PublicKey::decode(value)
                .or_else(|_| PublicKey::from_base64(value))
                .map(DriverPackageTrust::PublicKey)
                .unwrap_or_else(|error| DriverPackageTrust::InvalidKey(error.to_string())),
            None => DriverPackageTrust::Unavailable,
        };
        Self {
            root,
            trust,
            mutation_lock: Arc::new(Mutex::new(())),
            download_lock: Arc::new(AsyncMutex::new(())),
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Remove disposable catalog archives while retaining every version that
    /// could still be needed by activation, rollback, a pinned connection, or
    /// a currently running sidecar. Cleanup is serialized with downloads and
    /// package mutations so a partial archive cannot disappear mid-write.
    pub async fn prune_catalog_cache(
        &self,
        additional_retained: &BTreeSet<(String, String)>,
    ) -> Result<DriverPackageCachePruneResult, String> {
        let _download_guard = self.download_lock.lock().await;
        let _mutation_guard = self
            .mutation_lock
            .lock()
            .map_err(|_| "Database driver package registry is unavailable".to_string())?;
        let mut retained = activation_retained_driver_packages(&self.root);
        retained.extend(
            additional_retained
                .iter()
                .filter(|(driver, version)| {
                    is_safe_token(driver.as_str()) && is_safe_token(version.as_str())
                })
                .cloned(),
        );
        prune_catalog_cache_files(&self.root.join(DRIVER_PACKAGE_CACHE_DIRECTORY), &retained)
    }

    /// Copy the complete driver store into a fresh sibling staging directory
    /// and atomically publish it at `target`. The running registry deliberately
    /// remains on its original root; callers persist the target as a
    /// restart-required setting only after this method succeeds.
    pub fn stage_store_migration(&self, target: &Path) -> Result<(), String> {
        if !target.is_absolute() {
            return Err("Driver store destination must be an absolute path".to_string());
        }
        if target.exists() {
            return Err("Driver store destination must not already exist".to_string());
        }
        let source = if self.root.exists() {
            fs::canonicalize(&self.root)
                .map_err(|error| format!("Cannot resolve current driver store: {error}"))?
        } else {
            self.root.clone()
        };
        if source == target {
            return Err("Driver store destination is already active".to_string());
        }
        let parent = target
            .parent()
            .ok_or_else(|| "Driver store destination must have a parent directory".to_string())?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("Cannot create driver store parent directory: {error}"))?;

        if !source.exists() {
            fs::create_dir(target)
                .map_err(|error| format!("Cannot create new driver store: {error}"))?;
            return Ok(());
        }

        let staging = tempfile::Builder::new()
            .prefix("oxide-driver-store-")
            .tempdir_in(parent)
            .map_err(|error| format!("Cannot create driver store staging directory: {error}"))?;
        let staged_store = staging.path().join("store");
        let mut budget = DriverStoreCopyBudget::default();
        copy_driver_store_tree(&source, &staged_store, 0, &mut budget)?;

        // Re-read all package manifests in the staged location before it is
        // published. This catches truncation and accidental layout changes;
        // signature status is intentionally preserved and will be rechecked at
        // package launch time as usual.
        let staged_registry = Self::new(staged_store.clone());
        let _ = staged_registry.list_installed();
        fs::rename(&staged_store, target)
            .map_err(|error| format!("Cannot publish migrated driver store: {error}"))?;
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn allow_unsigned_for_tests(root: PathBuf) -> Self {
        Self {
            root,
            trust: DriverPackageTrust::AllowUnsigned,
            mutation_lock: Arc::new(Mutex::new(())),
            download_lock: Arc::new(AsyncMutex::new(())),
        }
    }

    #[cfg(test)]
    fn require_signature_for_tests(root: PathBuf) -> Self {
        Self {
            root,
            trust: DriverPackageTrust::Unavailable,
            mutation_lock: Arc::new(Mutex::new(())),
            download_lock: Arc::new(AsyncMutex::new(())),
        }
    }

    pub fn activation_state(&self, driver_id: &str) -> Option<DriverActivationState> {
        if !is_safe_token(driver_id) {
            return None;
        }
        read_activation_state(&self.root.join(driver_id))
    }

    pub fn managed_java_runtime_installations(&self) -> Vec<ManagedJavaRuntimeInstallation> {
        let root = self.root.join("_runtimes");
        let Ok(majors) = fs::read_dir(&root) else {
            return Vec::new();
        };
        let target = current_target();
        let mut installations = Vec::new();
        for major_entry in majors.flatten() {
            let name = major_entry.file_name().to_string_lossy().to_string();
            let Some(java_major) = name
                .strip_prefix("java-")
                .and_then(|value| value.parse::<u8>().ok())
            else {
                continue;
            };
            let target_root = major_entry.path().join(&target);
            let active = read_activation_state(&target_root).map(|state| state.current);
            let Ok(versions) = fs::read_dir(&target_root) else {
                continue;
            };
            for version in versions.flatten() {
                let version_name = version.file_name().to_string_lossy().to_string();
                if !is_safe_token(&version_name) {
                    continue;
                }
                let manifest_path = version.path().join(MANAGED_JAVA_RUNTIME_MANIFEST);
                let Ok(manifest) = read_managed_java_runtime_manifest(&manifest_path) else {
                    continue;
                };
                let verification =
                    validate_managed_java_runtime_manifest(&manifest, &version.path())
                        .and_then(|_| {
                            verify_file_digest(
                                &version.path().join(&manifest.entrypoint),
                                &manifest.sha256,
                                "Managed Java runtime entrypoint",
                            )
                        })
                        .and_then(|_| verify_package_signature(&manifest_path, &self.trust));
                let (status, status_message) = match verification {
                    Ok(()) if supports_current_target_names(&manifest.supported_targets) => {
                        (DriverPackageStatus::Ready, None)
                    }
                    Ok(()) => (
                        DriverPackageStatus::Incompatible,
                        Some(format!("Runtime does not support {target}")),
                    ),
                    Err(error) => (DriverPackageStatus::Invalid, Some(error)),
                };
                installations.push(ManagedJavaRuntimeInstallation {
                    java_major,
                    runtime_version: manifest.runtime_version,
                    target: target.clone(),
                    active: active.as_deref() == Some(&version_name),
                    status,
                    status_message,
                });
            }
        }
        installations.sort_by(|left, right| {
            left.java_major
                .cmp(&right.java_major)
                .then(left.runtime_version.cmp(&right.runtime_version))
        });
        installations
    }

    /// Resolves the active Java runtime for a verified JDBC package. The
    /// runtime is checked again immediately before launch so neither a stale
    /// activation record nor a post-install binary replacement can become a
    /// process-execution path.
    pub fn resolve_managed_java_runtime_binary(
        &self,
        package: &InstalledDriverPackage,
        java_major: u8,
    ) -> Result<PathBuf, String> {
        if java_major != 21 {
            return Err("Only managed Java 21 runtimes are supported".to_string());
        }
        let package_root = fs::canonicalize(&package.package_root)
            .map_err(|error| format!("Cannot resolve driver package root: {error}"))?;
        let registry_root = fs::canonicalize(&self.root)
            .map_err(|error| format!("Cannot resolve driver package registry: {error}"))?;
        if !package_root.starts_with(&registry_root) {
            return Err("Driver package is outside the managed registry".to_string());
        }
        let target_root = registry_root
            .join("_runtimes")
            .join(format!("java-{java_major}"))
            .join(current_target());
        let active = read_activation_state(&target_root).ok_or_else(|| {
            format!(
                "No managed Java {java_major} runtime is active for {}",
                current_target()
            )
        })?;
        let runtime_root = target_root.join(&active.current);
        let manifest_path = runtime_root.join(MANAGED_JAVA_RUNTIME_MANIFEST);
        let manifest = read_managed_java_runtime_manifest(&manifest_path)?;
        if manifest.java_major != java_major || manifest.runtime_version != active.current {
            return Err("Managed Java runtime activation does not match its manifest".to_string());
        }
        validate_managed_java_runtime_manifest(&manifest, &runtime_root)?;
        if !supports_current_target_names(&manifest.supported_targets) {
            return Err(format!(
                "Managed Java runtime does not support {}",
                current_target()
            ));
        }
        verify_file_digest(
            &runtime_root.join(&manifest.entrypoint),
            &manifest.sha256,
            "Managed Java runtime entrypoint",
        )?;
        verify_package_signature(&manifest_path, &self.trust)?;
        let binary = fs::canonicalize(runtime_root.join(&manifest.entrypoint))
            .map_err(|error| format!("Cannot resolve managed Java runtime entrypoint: {error}"))?;
        let runtime_root = fs::canonicalize(&runtime_root)
            .map_err(|error| format!("Cannot resolve managed Java runtime directory: {error}"))?;
        if !binary.starts_with(&runtime_root) || !binary.is_file() {
            return Err("Managed Java runtime entrypoint is invalid".to_string());
        }
        Ok(binary)
    }

    pub fn install_managed_java_runtime_from_directory(
        &self,
        source: &Path,
        activate: bool,
    ) -> Result<ManagedJavaRuntimeInstallation, String> {
        let _guard = self
            .mutation_lock
            .lock()
            .map_err(|_| "Database driver package registry is unavailable".to_string())?;
        let source = fs::canonicalize(source)
            .map_err(|error| format!("Cannot resolve managed Java runtime directory: {error}"))?;
        if !source.is_dir() {
            return Err("The selected managed Java runtime must be a directory".to_string());
        }
        let manifest_path = source.join(MANAGED_JAVA_RUNTIME_MANIFEST);
        let manifest = read_managed_java_runtime_manifest(&manifest_path)?;
        validate_managed_java_runtime_manifest(&manifest, &source)?;
        if !supports_current_target_names(&manifest.supported_targets) {
            return Err(format!(
                "Managed Java runtime does not support {}",
                current_target()
            ));
        }
        fs::create_dir_all(&self.root)
            .map_err(|error| format!("Cannot create driver package registry: {error}"))?;
        let staging = self
            .root
            .join(format!(".runtime-install-{}", Uuid::new_v4()));
        let result = (|| {
            copy_package_tree(&source, &staging, 0, &mut PackageCopyBudget::default())?;
            let staged_manifest_path = staging.join(MANAGED_JAVA_RUNTIME_MANIFEST);
            let staged_manifest = read_managed_java_runtime_manifest(&staged_manifest_path)?;
            validate_managed_java_runtime_manifest(&staged_manifest, &staging)?;
            verify_file_digest(
                &staging.join(&staged_manifest.entrypoint),
                &staged_manifest.sha256,
                "Managed Java runtime entrypoint",
            )?;
            verify_package_signature(&staged_manifest_path, &self.trust)?;
            let target_root = self
                .root
                .join("_runtimes")
                .join(format!("java-{}", staged_manifest.java_major))
                .join(current_target());
            fs::create_dir_all(&target_root)
                .map_err(|error| format!("Cannot create managed Java runtime registry: {error}"))?;
            let destination = target_root.join(&staged_manifest.runtime_version);
            if destination.exists() {
                return Err(format!(
                    "Managed Java runtime {} is already installed",
                    staged_manifest.runtime_version
                ));
            }
            fs::rename(&staging, &destination).map_err(|error| {
                format!("Cannot commit managed Java runtime installation: {error}")
            })?;
            if activate {
                write_activation_state(
                    &target_root,
                    &DriverActivationState {
                        current: staged_manifest.runtime_version.clone(),
                        previous: read_activation_state(&target_root).map(|state| state.current),
                    },
                )?;
            }
            Ok(())
        })();
        if staging.exists() {
            let _ = fs::remove_dir_all(&staging);
        }
        result?;
        self.managed_java_runtime_installations()
            .into_iter()
            .find(|item| {
                item.java_major == manifest.java_major
                    && item.runtime_version == manifest.runtime_version
            })
            .ok_or_else(|| "Installed managed Java runtime cannot be resolved".to_string())
    }

    /// Fetch a small signed catalog without downloading or executing any
    /// package. The catalog's detached signature uses the same build-time
    /// Minisign trust root as each independently installed driver package.
    pub async fn fetch_signed_catalog(
        &self,
        catalog_url: &str,
    ) -> Result<DriverPackageCatalog, String> {
        let catalog_url = validated_catalog_url(catalog_url, "Driver catalog URL")?;
        let signature_url = catalog_signature_url(&catalog_url)?;
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(10))
            .user_agent("OxideStudio driver catalog")
            .build()
            .map_err(|error| format!("Cannot initialize driver catalog client: {error}"))?;
        let catalog =
            fetch_limited_bytes(&client, catalog_url.as_str(), MAX_DRIVER_CATALOG_BYTES).await?;
        let signature =
            fetch_limited_bytes(&client, signature_url.as_str(), MAX_DRIVER_SIGNATURE_BYTES)
                .await?;
        verify_detached_document(&catalog, &signature, &self.trust, "Driver catalog")?;
        let catalog: DriverPackageCatalog = serde_json::from_slice(&catalog)
            .map_err(|error| format!("Driver catalog is not valid JSON: {error}"))?;
        validate_driver_catalog(&catalog)?;
        Ok(catalog)
    }

    /// Download one explicitly selected catalog release into a temporary
    /// directory, verify its signed catalog digest, extract only regular files
    /// and directories, then run the normal local package installation path.
    /// Activation intentionally remains a separate command-layer decision so
    /// live connection ownership can still block a version switch.
    pub async fn install_from_signed_catalog(
        &self,
        catalog_url: &str,
        driver_id: &str,
        package_version: &str,
    ) -> Result<InstalledDriverPackage, String> {
        if !is_safe_token(driver_id) || !is_safe_token(package_version) {
            return Err("Invalid driver package identity".to_string());
        }
        let catalog = self.fetch_signed_catalog(catalog_url).await?;
        let entry = catalog
            .packages
            .iter()
            .find(|entry| entry.driver_id == driver_id && entry.package_version == package_version)
            .ok_or_else(|| {
                format!(
                    "Signed catalog does not contain driver package {driver_id} {package_version}"
                )
            })?;
        let archive_sha256 = entry.archive_sha256.as_deref().ok_or_else(|| {
            "This catalog entry does not publish an archive SHA-256; review and import it manually"
                .to_string()
        })?;
        validate_sha256(archive_sha256, "Driver package archive SHA-256")?;
        let download_url =
            validated_catalog_url(&entry.download_url, "Driver package download URL")?;

        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(90))
            .user_agent("OxideStudio driver package installer")
            .build()
            .map_err(|error| format!("Cannot initialize driver package client: {error}"))?;
        let temporary = TempDir::new()
            .map_err(|error| format!("Cannot create driver package staging directory: {error}"))?;
        let archive_path = temporary.path().join("package.tar.gz");
        let cache_path = catalog_cache_archive_path(
            &self.root,
            &entry.driver_id,
            &entry.package_version,
            archive_sha256,
        )?;
        let _download_guard = self.download_lock.lock().await;
        if !copy_cached_driver_package_archive(&cache_path, &archive_path, archive_sha256)? {
            download_driver_package_archive(
                &client,
                download_url.as_str(),
                &cache_path,
                archive_sha256,
            )
            .await?;
            if !copy_cached_driver_package_archive(&cache_path, &archive_path, archive_sha256)? {
                return Err(
                    "Downloaded driver package was not published to its verified cache".to_string(),
                );
            }
        }
        let unpacked = temporary.path().join("package");
        unpack_driver_package_archive(&archive_path, &unpacked)?;
        let downloaded_manifest = read_manifest(&unpacked.join("manifest.json"))?;
        validate_catalog_manifest_binding(entry, &downloaded_manifest)?;
        let installed =
            self.install_from_directory_with_catalog_entry(&unpacked, false, Some(entry))?;
        Ok(installed)
    }

    pub fn install_from_directory(
        &self,
        source: &Path,
        activate: bool,
    ) -> Result<InstalledDriverPackage, String> {
        self.install_from_directory_with_catalog_entry(source, activate, None)
    }

    fn install_from_directory_with_catalog_entry(
        &self,
        source: &Path,
        activate: bool,
        catalog_entry: Option<&DriverPackageCatalogEntry>,
    ) -> Result<InstalledDriverPackage, String> {
        let _guard = self
            .mutation_lock
            .lock()
            .map_err(|_| "Database driver package registry is unavailable".to_string())?;
        let source = fs::canonicalize(source)
            .map_err(|error| format!("Cannot resolve driver package directory: {error}"))?;
        if !source.is_dir() {
            return Err("The selected driver package must be a directory".to_string());
        }
        let source_manifest_path = source.join("manifest.json");
        let source_manifest = read_manifest(&source_manifest_path)?;
        validate_manifest(&source_manifest, &source)?;
        if let Some(entry) = catalog_entry {
            validate_catalog_receipt_entry(entry, &source_manifest)?;
        }

        fs::create_dir_all(&self.root)
            .map_err(|error| format!("Cannot create driver package registry: {error}"))?;
        let staging_root = self.root.join(format!(".install-{}", Uuid::new_v4()));
        let install_result = (|| {
            copy_package_tree(&source, &staging_root, 0, &mut PackageCopyBudget::default())?;
            let receipt_path = staging_root.join(DRIVER_PACKAGE_CATALOG_RECEIPT);
            if receipt_path.exists() {
                return Err(format!(
                    "Driver package contains reserved Host metadata: {DRIVER_PACKAGE_CATALOG_RECEIPT}"
                ));
            }
            let staged_manifest_path = staging_root.join("manifest.json");
            let package = inspect_package(
                &self.root,
                &staging_root,
                &staged_manifest_path,
                &source_manifest.driver_id,
                &source_manifest.package_version,
                None,
                &self.trust,
            )
            .ok_or_else(|| "Driver package manifest cannot be read after staging".to_string())?;
            if package.status != DriverPackageStatus::Ready {
                return Err(package
                    .status_message
                    .unwrap_or_else(|| "Driver package failed verification".to_string()));
            }

            if let Some(entry) = catalog_entry {
                let receipt = DriverPackageCatalogReceipt {
                    schema_version: DRIVER_PACKAGE_CATALOG_SCHEMA_VERSION,
                    entry: entry.clone(),
                };
                let encoded = serde_json::to_vec_pretty(&receipt)
                    .map_err(|error| format!("Cannot encode driver catalog receipt: {error}"))?;
                if encoded.len() as u64 > MAX_DRIVER_CATALOG_BYTES {
                    return Err("Driver catalog receipt exceeds the size limit".to_string());
                }
                fs::write(&receipt_path, encoded)
                    .map_err(|error| format!("Cannot write driver catalog receipt: {error}"))?;
            }

            let driver_root = self.root.join(&source_manifest.driver_id);
            fs::create_dir_all(&driver_root)
                .map_err(|error| format!("Cannot create driver package directory: {error}"))?;
            let destination = driver_root.join(&source_manifest.package_version);
            if destination.exists() {
                return Err(format!(
                    "Driver package {} {} is already installed",
                    source_manifest.driver_id, source_manifest.package_version
                ));
            }
            fs::rename(&staging_root, &destination)
                .map_err(|error| format!("Cannot commit driver package installation: {error}"))?;

            if activate {
                self.activate_package_locked(
                    &source_manifest.driver_id,
                    &source_manifest.package_version,
                )?;
            }
            self.list_installed()
                .into_iter()
                .find(|installed| {
                    installed.manifest.driver_id == source_manifest.driver_id
                        && installed.manifest.package_version == source_manifest.package_version
                })
                .ok_or_else(|| "Installed driver package cannot be resolved".to_string())
        })();

        if staging_root.exists() {
            let _ = fs::remove_dir_all(&staging_root);
        }
        install_result
    }

    pub fn activate_package(
        &self,
        driver_id: &str,
        package_version: &str,
    ) -> Result<DriverActivationState, String> {
        let _guard = self
            .mutation_lock
            .lock()
            .map_err(|_| "Database driver package registry is unavailable".to_string())?;
        self.activate_package_locked(driver_id, package_version)
    }

    pub fn rollback_package(&self, driver_id: &str) -> Result<DriverActivationState, String> {
        let _guard = self
            .mutation_lock
            .lock()
            .map_err(|_| "Database driver package registry is unavailable".to_string())?;
        if !is_safe_token(driver_id) {
            return Err("Invalid driver identifier".to_string());
        }
        let driver_root = self.root.join(driver_id);
        let state = read_activation_state(&driver_root)
            .ok_or_else(|| format!("No rollback state exists for {driver_id}"))?;
        let previous = state
            .previous
            .as_deref()
            .ok_or_else(|| format!("No previous package exists for {driver_id}"))?;
        let next = self.ensure_ready_package(driver_id, previous)?;
        let rolled_back = DriverActivationState {
            current: next.manifest.package_version,
            previous: Some(state.current),
        };
        write_activation_state(&driver_root, &rolled_back)?;
        Ok(rolled_back)
    }

    fn activate_package_locked(
        &self,
        driver_id: &str,
        package_version: &str,
    ) -> Result<DriverActivationState, String> {
        let package = self.ensure_ready_package(driver_id, package_version)?;
        let driver_root = self.root.join(driver_id);
        let old_current = read_active_version(&driver_root);
        let state = DriverActivationState {
            current: package.manifest.package_version,
            previous: old_current.filter(|version| version != package_version),
        };
        write_activation_state(&driver_root, &state)?;
        Ok(state)
    }

    fn ensure_ready_package(
        &self,
        driver_id: &str,
        package_version: &str,
    ) -> Result<InstalledDriverPackage, String> {
        if !is_safe_token(driver_id) || !is_safe_token(package_version) {
            return Err("Invalid driver package identity".to_string());
        }
        let package = self
            .list_installed()
            .into_iter()
            .find(|package| {
                package.manifest.driver_id == driver_id
                    && package.manifest.package_version == package_version
            })
            .ok_or_else(|| {
                format!("Driver package {driver_id} {package_version} is not installed")
            })?;
        if package.status != DriverPackageStatus::Ready {
            return Err(package.status_message.clone().unwrap_or_else(|| {
                format!("Driver package {driver_id} {package_version} is not ready")
            }));
        }
        Ok(package)
    }

    pub fn list_installed(&self) -> Vec<InstalledDriverPackage> {
        let Ok(driver_directories) = fs::read_dir(&self.root) else {
            return Vec::new();
        };
        let mut packages = Vec::new();

        for driver_directory in driver_directories.flatten() {
            let driver_root = driver_directory.path();
            if !driver_root.is_dir() {
                continue;
            }
            let Some(directory_driver_id) =
                driver_root.file_name().and_then(|value| value.to_str())
            else {
                continue;
            };
            let active_version = read_active_version(&driver_root);
            let Ok(version_directories) = fs::read_dir(&driver_root) else {
                continue;
            };

            for version_directory in version_directories.flatten() {
                let package_root = version_directory.path();
                if !package_root.is_dir() {
                    continue;
                }
                let Some(directory_version) =
                    package_root.file_name().and_then(|value| value.to_str())
                else {
                    continue;
                };
                let manifest_path = package_root.join("manifest.json");
                if !manifest_path.is_file() {
                    continue;
                }
                if let Some(package) = inspect_package(
                    &self.root,
                    &package_root,
                    &manifest_path,
                    directory_driver_id,
                    directory_version,
                    active_version.as_deref(),
                    &self.trust,
                ) {
                    packages.push(package);
                }
            }
        }

        packages.sort_by(|left, right| {
            left.manifest
                .display_name
                .cmp(&right.manifest.display_name)
                .then_with(|| right.active.cmp(&left.active))
                .then_with(|| {
                    right
                        .manifest
                        .package_version
                        .cmp(&left.manifest.package_version)
                })
        });
        packages
    }

    /// Resolve the only package that may be launched for a driver. Invalid,
    /// incompatible, inactive, or ambiguous installations never reach the
    /// process-spawn boundary.
    pub fn resolve_active(&self, driver_id: &str) -> Result<InstalledDriverPackage, String> {
        if !is_safe_token(driver_id) {
            return Err("Invalid driver identifier".to_string());
        }

        let mut candidates = self
            .list_installed()
            .into_iter()
            .filter(|package| package.manifest.driver_id == driver_id && package.active);
        let Some(package) = candidates.next() else {
            return Err(format!("No active external driver package for {driver_id}"));
        };
        if candidates.next().is_some() {
            return Err(format!(
                "Multiple active external driver packages were found for {driver_id}"
            ));
        }
        if package.status != DriverPackageStatus::Ready {
            return Err(package
                .status_message
                .clone()
                .unwrap_or_else(|| format!("External driver package {driver_id} is not ready")));
        }
        self.revalidate_launchable_package(package, driver_id)
    }

    /// Resolve a verified installed version for a connection pinned to a package.
    /// Pinned connections remain valid when another version becomes active, but
    /// still re-check every launch boundary before a process is spawned.
    pub fn resolve_version(
        &self,
        driver_id: &str,
        package_version: &str,
    ) -> Result<InstalledDriverPackage, String> {
        let package = self.ensure_ready_package(driver_id, package_version)?;
        self.revalidate_launchable_package(package, driver_id)
    }

    fn revalidate_launchable_package(
        &self,
        mut package: InstalledDriverPackage,
        driver_id: &str,
    ) -> Result<InstalledDriverPackage, String> {
        validate_package_boundary(&self.root, &package.package_root)?;
        validate_manifest(&package.manifest, &package.package_root)?;
        verify_entrypoint_digest(&package.entrypoint, &package.manifest.sha256)?;
        verify_runtime_dependencies(&package.package_root, &package.manifest.runtime)?;
        if !supports_current_target(&package.manifest)
            || !protocol_is_compatible(&package.manifest.protocol_version)
        {
            return Err(format!(
                "External driver package {driver_id} is no longer compatible"
            ));
        }
        verify_entrypoint_digest(&package.entrypoint, &package.manifest.sha256)?;
        verify_package_signature(&package.package_root.join("manifest.json"), &self.trust)?;
        package.catalog_entry = read_catalog_receipt(&package.package_root, &package.manifest).ok();
        package.entrypoint = fs::canonicalize(&package.entrypoint)
            .map_err(|error| format!("Cannot resolve driver entrypoint: {error}"))?;
        Ok(package)
    }
}

/// A catalog is both a release index and the UI's version/conformance source.
/// Bind its user-visible contract to the downloaded, independently signed
/// manifest before the archive enters the local store. Comparing only the
/// package id/version would allow a release to present a different protocol,
/// target, or capability surface from the one the user reviewed in Driver
/// Manager.
fn validate_catalog_manifest_binding(
    entry: &DriverPackageCatalogEntry,
    manifest: &DriverPackageManifest,
) -> Result<(), String> {
    if manifest.driver_id != entry.driver_id || manifest.package_version != entry.package_version {
        return Err(
            "Downloaded driver package identity does not match the signed catalog entry"
                .to_string(),
        );
    }
    if manifest.protocol_version != entry.protocol_version {
        return Err(
            "Downloaded driver package protocol does not match the signed catalog entry"
                .to_string(),
        );
    }
    if manifest.display_name != entry.display_name {
        return Err(
            "Downloaded driver package display name does not match the signed catalog entry"
                .to_string(),
        );
    }
    if manifest.server_version_range != entry.server_version_range {
        return Err(
            "Downloaded driver package server-version range does not match the signed catalog entry"
                .to_string(),
        );
    }
    if manifest.connection_url_template != entry.connection_url_template {
        return Err(
            "Downloaded driver package connection template does not match the signed catalog entry"
                .to_string(),
        );
    }
    if manifest.schema_migration != entry.schema_migration {
        return Err(
            "Downloaded driver package schema-migration contract does not match the signed catalog entry"
                .to_string(),
        );
    }

    let mut catalog_targets = entry.supported_targets.clone();
    let mut manifest_targets = manifest.supported_targets.clone();
    catalog_targets.sort_unstable();
    manifest_targets.sort_unstable();
    if catalog_targets != manifest_targets {
        return Err(
            "Downloaded driver package targets do not match the signed catalog entry".to_string(),
        );
    }

    if let Some(catalog_capabilities) = entry.capabilities.as_ref() {
        if manifest.capabilities.as_ref() != Some(catalog_capabilities) {
            return Err(
                "Downloaded driver package capabilities do not match the signed catalog entry"
                    .to_string(),
            );
        }
    }
    if let Some(conformance) = entry.conformance.as_ref() {
        if conformance.evidence.iter().any(|evidence| {
            !evidence
                .entrypoint_sha256
                .eq_ignore_ascii_case(&manifest.sha256)
        }) {
            return Err(
                "Downloaded driver package entrypoint digest does not match signed conformance evidence"
                    .to_string(),
            );
        }
    }
    Ok(())
}

fn validate_catalog_receipt_entry(
    entry: &DriverPackageCatalogEntry,
    manifest: &DriverPackageManifest,
) -> Result<(), String> {
    validate_driver_catalog(&DriverPackageCatalog {
        schema_version: DRIVER_PACKAGE_CATALOG_SCHEMA_VERSION,
        generated_at: None,
        packages: vec![entry.clone()],
    })?;
    validate_catalog_manifest_binding(entry, manifest)
}

fn read_catalog_receipt(
    package_root: &Path,
    manifest: &DriverPackageManifest,
) -> Result<DriverPackageCatalogEntry, String> {
    let path = package_root.join(DRIVER_PACKAGE_CATALOG_RECEIPT);
    let metadata = fs::symlink_metadata(&path)
        .map_err(|_| "Driver package has no signed-catalog receipt".to_string())?;
    if !metadata.file_type().is_file() || metadata.len() > MAX_DRIVER_CATALOG_BYTES {
        return Err("Driver catalog receipt is not a bounded regular file".to_string());
    }
    let encoded =
        fs::read(&path).map_err(|error| format!("Cannot read driver catalog receipt: {error}"))?;
    let receipt: DriverPackageCatalogReceipt = serde_json::from_slice(&encoded)
        .map_err(|error| format!("Driver catalog receipt is not valid JSON: {error}"))?;
    if receipt.schema_version != DRIVER_PACKAGE_CATALOG_SCHEMA_VERSION {
        return Err("Driver catalog receipt has an unsupported schema version".to_string());
    }
    validate_catalog_receipt_entry(&receipt.entry, manifest)?;
    Ok(receipt.entry)
}

#[derive(Default)]
struct PackageCopyBudget {
    files: usize,
    bytes: u64,
}

#[derive(Default)]
struct DriverStoreCopyBudget {
    files: usize,
    bytes: u64,
}

const MAX_DRIVER_STORE_FILES: usize = 65_536;
const MAX_DRIVER_STORE_BYTES: u64 = 4 * 1024 * 1024 * 1024;

fn copy_driver_store_tree(
    source: &Path,
    destination: &Path,
    depth: usize,
    budget: &mut DriverStoreCopyBudget,
) -> Result<(), String> {
    if depth > MAX_DRIVER_PACKAGE_DEPTH {
        return Err("Driver store directory nesting exceeds the limit".to_string());
    }
    fs::create_dir(destination)
        .map_err(|error| format!("Cannot create driver store staging directory: {error}"))?;
    let entries = fs::read_dir(source)
        .map_err(|error| format!("Cannot read current driver store: {error}"))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("Cannot inspect driver store entry: {error}"))?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let metadata = fs::symlink_metadata(&source_path)
            .map_err(|error| format!("Cannot inspect driver store entry: {error}"))?;
        let file_type = metadata.file_type();
        if file_type.is_symlink() {
            return Err(format!(
                "Driver store cannot contain symbolic links: {}",
                source_path.display()
            ));
        }
        if file_type.is_dir() {
            copy_driver_store_tree(&source_path, &destination_path, depth + 1, budget)?;
            continue;
        }
        if !file_type.is_file() {
            return Err(format!(
                "Driver store cannot contain special files: {}",
                source_path.display()
            ));
        }
        budget.files = budget
            .files
            .checked_add(1)
            .ok_or_else(|| "Driver store file count overflow".to_string())?;
        budget.bytes = budget
            .bytes
            .checked_add(metadata.len())
            .ok_or_else(|| "Driver store size overflow".to_string())?;
        if budget.files > MAX_DRIVER_STORE_FILES {
            return Err(format!(
                "Driver store contains more than {MAX_DRIVER_STORE_FILES} files"
            ));
        }
        if budget.bytes > MAX_DRIVER_STORE_BYTES {
            return Err("Driver store exceeds the 4 GiB migration limit".to_string());
        }
        fs::copy(&source_path, &destination_path)
            .map_err(|error| format!("Cannot stage driver store file: {error}"))?;
    }
    Ok(())
}

fn copy_package_tree(
    source: &Path,
    destination: &Path,
    depth: usize,
    budget: &mut PackageCopyBudget,
) -> Result<(), String> {
    if depth > MAX_DRIVER_PACKAGE_DEPTH {
        return Err("Driver package directory nesting exceeds the limit".to_string());
    }
    fs::create_dir(destination)
        .map_err(|error| format!("Cannot create driver package staging directory: {error}"))?;
    let entries = fs::read_dir(source)
        .map_err(|error| format!("Cannot read driver package directory: {error}"))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("Cannot inspect driver package: {error}"))?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let metadata = fs::symlink_metadata(&source_path)
            .map_err(|error| format!("Cannot inspect driver package entry: {error}"))?;
        let file_type = metadata.file_type();
        if file_type.is_symlink() {
            return Err(format!(
                "Driver packages cannot contain symbolic links: {}",
                source_path.display()
            ));
        }
        if file_type.is_dir() {
            copy_package_tree(&source_path, &destination_path, depth + 1, budget)?;
            continue;
        }
        if !file_type.is_file() {
            return Err(format!(
                "Driver packages cannot contain special files: {}",
                source_path.display()
            ));
        }
        budget.files = budget
            .files
            .checked_add(1)
            .ok_or_else(|| "Driver package file count overflow".to_string())?;
        budget.bytes = budget
            .bytes
            .checked_add(metadata.len())
            .ok_or_else(|| "Driver package size overflow".to_string())?;
        if budget.files > MAX_DRIVER_PACKAGE_FILES {
            return Err(format!(
                "Driver package contains more than {MAX_DRIVER_PACKAGE_FILES} files"
            ));
        }
        if budget.bytes > MAX_DRIVER_PACKAGE_BYTES {
            return Err("Driver package exceeds the 512 MiB size limit".to_string());
        }
        fs::copy(&source_path, &destination_path)
            .map_err(|error| format!("Cannot stage driver package file: {error}"))?;
    }
    Ok(())
}

fn read_manifest(path: &Path) -> Result<DriverPackageManifest, String> {
    let metadata =
        fs::metadata(path).map_err(|error| format!("Cannot inspect driver manifest: {error}"))?;
    if !metadata.is_file() || metadata.len() > MAX_DRIVER_MANIFEST_BYTES {
        return Err("Driver manifest is missing or exceeds 256 KiB".to_string());
    }
    let content =
        fs::read(path).map_err(|error| format!("Cannot read driver manifest: {error}"))?;
    serde_json::from_slice(&content)
        .map_err(|error| format!("Driver manifest is invalid JSON: {error}"))
}

fn read_managed_java_runtime_manifest(path: &Path) -> Result<ManagedJavaRuntimeManifest, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Cannot inspect managed Java runtime manifest: {error}"))?;
    if !metadata.is_file() || metadata.len() > MAX_DRIVER_MANIFEST_BYTES {
        return Err("Managed Java runtime manifest is missing or exceeds 256 KiB".to_string());
    }
    serde_json::from_slice(
        &fs::read(path)
            .map_err(|error| format!("Cannot read managed Java runtime manifest: {error}"))?,
    )
    .map_err(|error| format!("Managed Java runtime manifest is invalid JSON: {error}"))
}

fn validate_managed_java_runtime_manifest(
    manifest: &ManagedJavaRuntimeManifest,
    root: &Path,
) -> Result<(), String> {
    if manifest.schema_version != DRIVER_PACKAGE_SCHEMA_VERSION
        || manifest.runtime_kind != MANAGED_JAVA_RUNTIME_KIND
        || manifest.java_major != 21
        || !is_safe_token(&manifest.runtime_version)
    {
        return Err("Managed Java runtime manifest is invalid".to_string());
    }
    let entrypoint = package_relative_file(root, &manifest.entrypoint, "Managed Java runtime")?;
    if entrypoint
        .file_name()
        .and_then(|value| value.to_str())
        .is_none_or(|value| value.is_empty())
    {
        return Err("Managed Java runtime entrypoint is invalid".to_string());
    }
    validate_sha256(&manifest.sha256, "Managed Java runtime SHA-256")?;
    if manifest.supported_targets.len() > 16
        || manifest
            .supported_targets
            .iter()
            .any(|target| target.len() > 96 || target.trim().is_empty())
    {
        return Err("Managed Java runtime targets are invalid".to_string());
    }
    Ok(())
}

fn read_active_version(driver_root: &Path) -> Option<String> {
    read_activation_state(driver_root)
        .map(|state| state.current)
        .or_else(|| {
            fs::read_to_string(driver_root.join("current"))
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| is_safe_token(value))
        })
}

fn read_activation_state(driver_root: &Path) -> Option<DriverActivationState> {
    let path = driver_root.join("activation.json");
    let metadata = fs::metadata(&path).ok()?;
    if !metadata.is_file() || metadata.len() > 16 * 1024 {
        return None;
    }
    let state: DriverActivationState = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    if !is_safe_token(&state.current)
        || state
            .previous
            .as_deref()
            .is_some_and(|value| !is_safe_token(value))
    {
        return None;
    }
    Some(state)
}

fn write_activation_state(driver_root: &Path, state: &DriverActivationState) -> Result<(), String> {
    let payload = serde_json::to_vec_pretty(state)
        .map_err(|error| format!("Cannot encode driver activation state: {error}"))?;
    let destination = driver_root.join("activation.json");
    let mut temporary = NamedTempFile::new_in(driver_root)
        .map_err(|error| format!("Cannot stage driver activation state: {error}"))?;
    temporary
        .write_all(&payload)
        .map_err(|error| format!("Cannot write driver activation state: {error}"))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| format!("Cannot sync driver activation state: {error}"))?;
    temporary
        .persist(&destination)
        .map_err(|error| format!("Cannot activate driver package: {}", error.error))?;
    Ok(())
}

/// Validate the sidecar identity returned during startup before any connection
/// secrets or database requests are sent to that process.
pub fn validate_handshake(
    manifest: &DriverPackageManifest,
    response: &HandshakeResponse,
) -> Result<(), String> {
    if !protocol_is_compatible(&response.protocol_version) {
        return Err(format!(
            "Driver runtime protocol {} is incompatible with host protocol {}",
            response.protocol_version, DRIVER_PROTOCOL_VERSION
        ));
    }
    if response.protocol_version != manifest.protocol_version {
        return Err("Driver runtime protocol does not match its manifest".to_string());
    }
    if response.package_id != manifest.package_id
        || response.package_version != manifest.package_version
        || response.driver_id != manifest.driver_id
    {
        return Err("Driver runtime identity does not match its manifest".to_string());
    }
    if !response.capabilities.query {
        return Err("Driver runtime does not provide query capability".to_string());
    }
    if manifest.schema_migration.is_some() && !response.capabilities.semantic_schema_migration {
        return Err(
            "Driver manifest declares semantic schema migration that its runtime does not provide"
                .to_string(),
        );
    }
    if let Some(capabilities) = &manifest.capabilities {
        let declares_metadata = capabilities.supports_table_browsing
            || capabilities.supports_collection_browsing
            || capabilities.supports_key_value_browsing
            || capabilities.supports_schemas
            || capabilities.supports_table_indexes
            || capabilities.supports_table_constraints
            || capabilities.supports_functions;
        if declares_metadata && !response.capabilities.metadata {
            return Err(
                "Driver manifest declares Explorer metadata that its runtime does not provide"
                    .to_string(),
            );
        }
        // Data Editor mutations are executed as a single parameterized batch
        // inside a sidecar transaction. Do not let a signed manifest expose
        // editable rows when the running package cannot uphold that atomic
        // execution contract.
        if capabilities.supports_table_row_mutation && !response.capabilities.transactions {
            return Err(
                "Driver manifest declares table row mutation that its runtime does not provide transactions for"
                    .to_string(),
            );
        }
        if capabilities.supports_table_data_transfer && !response.capabilities.transactions {
            return Err(
                "Driver manifest declares table data transfer that its runtime does not provide transactions for"
                    .to_string(),
            );
        }
        if capabilities.supports_transactions && !response.capabilities.transactions {
            return Err(
                "Driver manifest declares transactions that its runtime does not provide"
                    .to_string(),
            );
        }
        if capabilities.supports_query_cancellation && !response.capabilities.cancellation {
            return Err(
                "Driver manifest declares query cancellation that its runtime does not provide"
                    .to_string(),
            );
        }
        if capabilities.supports_create_database && !response.capabilities.database_creation {
            return Err(
                "Driver manifest declares database creation that its runtime does not provide"
                    .to_string(),
            );
        }
        // Reverse navigation is a separate server-side query boundary. A
        // package must not advertise foreign-key navigation merely because it
        // can enumerate ordinary table metadata; old or partial sidecars
        // safely degrade this feature until they implement the bounded lookup.
        if capabilities.supports_foreign_keys && !response.capabilities.referencing_foreign_keys {
            return Err(
                "Driver manifest declares foreign-key navigation that its runtime does not provide"
                    .to_string(),
            );
        }
    }
    Ok(())
}

fn inspect_package(
    registry_root: &Path,
    package_root: &Path,
    manifest_path: &Path,
    directory_driver_id: &str,
    directory_version: &str,
    active_version: Option<&str>,
    trust: &DriverPackageTrust,
) -> Option<InstalledDriverPackage> {
    let manifest = read_manifest(manifest_path).ok()?;
    let catalog_entry = read_catalog_receipt(package_root, &manifest).ok();
    let entrypoint = package_root.join(&manifest.entrypoint);
    let active = active_version == Some(directory_version);
    let directory_identity_error = if manifest.driver_id != directory_driver_id {
        Some("Driver id does not match its installation directory".to_string())
    } else if manifest.package_version != directory_version {
        Some("Package version does not match its installation directory".to_string())
    } else {
        None
    };
    let (status, status_message) = match directory_identity_error
        .map_or_else(
            || validate_package_boundary(registry_root, package_root),
            Err,
        )
        .and_then(|_| validate_manifest(&manifest, package_root))
    {
        Err(error) => (DriverPackageStatus::Invalid, Some(error)),
        Ok(()) if !supports_current_target(&manifest) => (
            DriverPackageStatus::Incompatible,
            Some(format!("Package does not support {}", current_target())),
        ),
        Ok(()) if !protocol_is_compatible(&manifest.protocol_version) => (
            DriverPackageStatus::Incompatible,
            Some(format!(
                "Driver protocol {} is incompatible with host protocol {}",
                manifest.protocol_version, DRIVER_PROTOCOL_VERSION
            )),
        ),
        Ok(()) => match verify_entrypoint_digest(&entrypoint, &manifest.sha256)
            .and_then(|_| verify_runtime_dependencies(package_root, &manifest.runtime))
        {
            Ok(()) => match verify_package_signature(manifest_path, trust) {
                Ok(()) => (DriverPackageStatus::Ready, None),
                Err(error) => (DriverPackageStatus::Untrusted, Some(error)),
            },
            Err(error) => (DriverPackageStatus::Invalid, Some(error)),
        },
    };

    Some(InstalledDriverPackage {
        manifest,
        package_root: package_root.to_path_buf(),
        entrypoint,
        active,
        status,
        status_message,
        catalog_entry,
    })
}

fn validate_manifest(manifest: &DriverPackageManifest, package_root: &Path) -> Result<(), String> {
    if manifest.schema_version != DRIVER_PACKAGE_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported driver manifest schema version: {}",
            manifest.schema_version
        ));
    }
    for (field, value) in [
        ("packageId", manifest.package_id.as_str()),
        ("packageVersion", manifest.package_version.as_str()),
        ("driverId", manifest.driver_id.as_str()),
    ] {
        if !is_safe_token(value) {
            return Err(format!("Invalid {field}: {value}"));
        }
    }
    if let Some(capabilities) = &manifest.capabilities {
        validate_capability_contract(&manifest.driver_id, capabilities)?;
    }
    validate_schema_migration_contract(
        manifest.capabilities.as_ref(),
        manifest.schema_migration.as_ref(),
    )?;
    validate_connection_url_template(manifest.connection_url_template.as_deref())?;
    validate_server_version_range(manifest.server_version_range.as_deref())?;
    for (field, value) in [
        ("displayName", manifest.display_name.as_str()),
        ("clientLibrary", manifest.client_library.as_str()),
        ("clientVersion", manifest.client_version.as_str()),
        ("protocolVersion", manifest.protocol_version.as_str()),
    ] {
        if value.trim().is_empty() || value.len() > 160 {
            return Err(format!("Invalid {field}"));
        }
    }
    if manifest.sha256.len() != 64
        || !manifest
            .sha256
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err("Driver entrypoint SHA-256 must be a 64-character hex digest".to_string());
    }
    let relative_entrypoint = Path::new(&manifest.entrypoint);
    if relative_entrypoint.as_os_str().is_empty()
        || relative_entrypoint.is_absolute()
        || relative_entrypoint.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("Driver entrypoint must stay inside its package directory".to_string());
    }
    let entrypoint = package_root.join(relative_entrypoint);
    if !entrypoint.is_file() {
        return Err("Driver entrypoint does not exist".to_string());
    }
    let canonical_root = fs::canonicalize(package_root)
        .map_err(|error| format!("Cannot resolve driver package directory: {error}"))?;
    let canonical_entrypoint = fs::canonicalize(&entrypoint)
        .map_err(|error| format!("Cannot resolve driver entrypoint: {error}"))?;
    if !canonical_entrypoint.starts_with(&canonical_root) {
        return Err("Driver entrypoint resolves outside its package directory".to_string());
    }
    validate_runtime(&manifest.runtime, package_root)?;
    Ok(())
}

fn validate_connection_url_template(template: Option<&str>) -> Result<(), String> {
    let Some(template) = template else {
        return Ok(());
    };
    if template.is_empty()
        || template.len() > MAX_DRIVER_CATALOG_FIELD_LENGTH
        || template.chars().any(char::is_control)
        || !template
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphabetic)
    {
        return Err("Driver connection URL template is invalid".to_string());
    }

    let allowed = ["{host}", "{port}", "{database}", "{user}", "{password}"];
    let mut remaining = template;
    while let Some(open) = remaining.find('{') {
        let (prefix, suffix) = remaining.split_at(open);
        if prefix.contains('}') {
            return Err("Driver connection URL template has unmatched braces".to_string());
        }
        let Some(close) = suffix.find('}') else {
            return Err("Driver connection URL template has unmatched braces".to_string());
        };
        let placeholder = &suffix[..=close];
        if !allowed.contains(&placeholder) {
            return Err(
                "Driver connection URL template has an unsupported placeholder".to_string(),
            );
        }
        remaining = &suffix[close + 1..];
    }
    if remaining.contains('}') {
        return Err("Driver connection URL template has unmatched braces".to_string());
    }
    Ok(())
}

/// Package ranges use explicit, comma-or-space separated comparators such as
/// `>= 6 < 9`. Keeping the grammar deliberately narrow avoids treating a
/// product banner as executable policy while still covering the range syntax
/// published by the driver catalog.
fn normalized_server_version_range(range: &str) -> Result<String, String> {
    if range.trim().is_empty() || range.len() > MAX_DRIVER_CATALOG_FIELD_LENGTH {
        return Err("Driver server version range is invalid".to_string());
    }
    let pattern = Regex::new(r"(>=|<=|>|<|=)\s*(\d+(?:\.\d+){0,2})")
        .expect("server version range expression must compile");
    let mut at = 0;
    let mut comparators = Vec::new();
    for matched in pattern.captures_iter(range) {
        let whole = matched
            .get(0)
            .expect("range match must have a whole capture");
        if !range[at..whole.start()]
            .chars()
            .all(|character| character.is_ascii_whitespace() || character == ',')
        {
            return Err("Driver server version range uses unsupported syntax".to_string());
        }
        let version = matched
            .get(2)
            .expect("range match must have a version capture")
            .as_str();
        let mut parts = version.split('.');
        let major = parts.next().expect("version capture has a major");
        let minor = parts.next().unwrap_or("0");
        let patch = parts.next().unwrap_or("0");
        comparators.push(format!(
            "{}{}.{}.{}",
            matched
                .get(1)
                .expect("range match must have a comparator")
                .as_str(),
            major,
            minor,
            patch
        ));
        at = whole.end();
    }
    if comparators.is_empty()
        || !range[at..]
            .chars()
            .all(|character| character.is_ascii_whitespace() || character == ',')
    {
        return Err("Driver server version range uses unsupported syntax".to_string());
    }
    Ok(comparators.join(", "))
}

fn validate_server_version_range(range: Option<&str>) -> Result<(), String> {
    let Some(range) = range else {
        return Ok(());
    };
    let normalized = normalized_server_version_range(range)?;
    VersionReq::parse(&normalized)
        .map(|_| ())
        .map_err(|_| "Driver server version range is invalid".to_string())
}

/// Compare a product banner returned by a sidecar with its signed manifest.
/// We intentionally extract only the first numeric version sequence: JDBC and
/// native clients commonly return banners such as `PostgreSQL 16.3 (Ubuntu)`.
pub fn validate_server_version_compatibility(
    range: Option<&str>,
    detected_version: Option<&str>,
) -> Result<(), String> {
    let Some(range) = range else {
        return Ok(());
    };
    let normalized = normalized_server_version_range(range)?;
    let requirement = VersionReq::parse(&normalized)
        .map_err(|_| "Driver server version range is invalid".to_string())?;
    let detected = detected_version.unwrap_or_default();
    let version_pattern =
        Regex::new(r"\d+(?:\.\d+){0,2}").expect("server version expression must compile");
    let Some(version) = version_pattern.find(detected).map(|value| value.as_str()) else {
        return Err(
            "Driver could not determine a numeric server version required by its package"
                .to_string(),
        );
    };
    let mut parts = version.split('.');
    let normalized_version = format!(
        "{}.{}.{}",
        parts.next().expect("version capture has a major"),
        parts.next().unwrap_or("0"),
        parts.next().unwrap_or("0")
    );
    let parsed = Version::parse(&normalized_version)
        .map_err(|_| "Driver returned an invalid server version".to_string())?;
    if requirement.matches(&parsed) {
        Ok(())
    } else {
        Err(format!(
            "Server version {version} is outside this driver package's supported range {range}"
        ))
    }
}

fn validate_runtime(runtime: &DriverPackageRuntime, package_root: &Path) -> Result<(), String> {
    let DriverPackageRuntime::Java(java) = runtime else {
        return Ok(());
    };
    if java.java_major != 21 {
        return Err("Java driver packages require managed Java 21".to_string());
    }
    if java.main_class.is_empty()
        || java.main_class.len() > 240
        || !java.main_class.split('.').all(|segment| {
            !segment.is_empty()
                && segment.chars().all(|character| {
                    character.is_ascii_alphanumeric() || character == '_' || character == '$'
                })
        })
    {
        return Err("Java driver mainClass is invalid".to_string());
    }
    if java.classpath.len() > 128 {
        return Err("Java driver classpath contains too many entries".to_string());
    }
    for entry in &java.classpath {
        let _ = package_relative_file(package_root, &entry.path, "Java driver classpath")?;
        validate_sha256(&entry.sha256, "Java driver classpath SHA-256")?;
    }
    Ok(())
}

fn package_relative_file(package_root: &Path, value: &str, label: &str) -> Result<PathBuf, String> {
    if value.is_empty() || value.len() > 240 {
        return Err(format!("{label} path is invalid"));
    }
    let path = Path::new(value);
    if path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(format!(
            "{label} path must stay inside its package directory"
        ));
    }
    let candidate = package_root.join(path);
    if !candidate.is_file() {
        return Err(format!("{label} entry does not exist"));
    }
    let canonical_root = fs::canonicalize(package_root)
        .map_err(|error| format!("Cannot resolve driver package directory: {error}"))?;
    let canonical_candidate = fs::canonicalize(&candidate)
        .map_err(|error| format!("Cannot resolve {label} entry: {error}"))?;
    if !canonical_candidate.starts_with(&canonical_root) {
        return Err(format!(
            "{label} path resolves outside its package directory"
        ));
    }
    Ok(candidate)
}

fn validate_capability_contract(
    expected_driver_id: &str,
    capabilities: &DatabaseCapabilities,
) -> Result<(), String> {
    if !capabilities.driver.eq_ignore_ascii_case(expected_driver_id) {
        return Err("Driver capability contract must use the package driverId".to_string());
    }
    if capabilities.display_name.trim().is_empty()
        || capabilities.lsp_language_id.trim().is_empty()
        || capabilities.namespace_label.trim().is_empty()
        || capabilities.common_data_types.len() > 256
        || capabilities
            .common_data_types
            .iter()
            .any(|value| value.len() > 160)
    {
        return Err("Invalid driver capability contract".to_string());
    }
    // Identifier quoting is interpolated into generated completion and table
    // SQL. A signed package may select only the delimiter families supported
    // by the host; arbitrary text here must never become a code-generation
    // surface in the renderer.
    if !matches!(
        capabilities.identifier_quote.as_str(),
        "" | "\"" | "`" | "["
    ) {
        return Err("Driver identifier quote is not supported by this build".to_string());
    }
    let export_formats = capabilities
        .table_export_formats
        .iter()
        .map(String::as_str)
        .collect::<std::collections::HashSet<_>>();
    if capabilities.table_export_formats.len() > DECLARED_TABLE_EXPORT_FORMATS.len()
        || export_formats.len() != capabilities.table_export_formats.len()
        || capabilities.table_export_formats.iter().any(|format| {
            format.trim() != format || !DECLARED_TABLE_EXPORT_FORMATS.contains(&format.as_str())
        })
    {
        return Err(
            "Driver table export formats contain an unsupported or duplicate value".to_string(),
        );
    }
    if !capabilities.table_export_formats.is_empty()
        && (!capabilities.supports_table_browsing
            || !matches!(
                capabilities.data_model,
                crate::core::dialect::DatabaseDataModel::Relational
            )
            || !matches!(
                capabilities.lsp_language_id.trim(),
                "postgres" | "mysql" | "sqlite" | "duckdb"
            ))
    {
        return Err(
            "Table export formats require relational browsing and a reviewed postgres, mysql, sqlite, or duckdb paging dialect"
                .to_string(),
        );
    }
    if let Some(server_dialect) = capabilities.lsp_server_dialect.as_deref() {
        let server_dialect = server_dialect.trim();
        if server_dialect.is_empty() {
            return Err("Driver LSP server dialect must not be empty".to_string());
        }
        if !matches!(
            server_dialect,
            "postgres"
                | "mysql"
                | "sqlite"
                | "duckdb"
                | "hive"
                | "clickhouse"
                | "access"
                | "cockroachdb"
                | "dameng"
                | "databend"
                | "doris"
                | "exasol"
                | "firebird"
                | "gaussdb"
                | "gbase"
                | "goldendb"
                | "greenplum"
                | "h2"
                | "highgo"
                | "informix"
                | "iris"
                | "kingbase"
                | "kwdb"
                | "manticoresearch"
                | "oceanbase-oracle"
                | "opengauss"
                | "oracle"
                | "questdb"
                | "redshift"
                | "sqlserver"
                | "starrocks"
                | "sundb"
                | "tidb"
                | "timescaledb"
                | "turso"
                | "vastbase"
                | "vertica"
                | "cloudflare-d1"
                | "xugu"
                | "yashandb"
                | "yugabytedb"
        ) {
            return Err("Driver LSP server dialect is not supported by this build".to_string());
        }
        let document_language = capabilities.lsp_language_id.trim();
        if document_language != "sql" && document_language != server_dialect {
            return Err(
                "Driver LSP server dialect must match its document language or use generic sql"
                    .to_string(),
            );
        }
    }
    if capabilities.supports_table_row_mutation && !capabilities.supports_transactions {
        return Err(
            "Table row mutation requires the driver capability contract to declare transactions"
                .to_string(),
        );
    }
    if !matches!(
        capabilities.data_model,
        crate::core::dialect::DatabaseDataModel::Relational
    ) && (capabilities.supports_table_browsing
        || capabilities.supports_table_row_mutation
        || capabilities.supports_table_data_transfer
        || capabilities.supports_table_ddl
        || capabilities.supports_column_alteration
        || capabilities.supports_index_rename
        || capabilities.supports_constraint_alteration)
    {
        return Err(
            "Only relational driver packages may declare the relational Table Editor contract"
                .to_string(),
        );
    }
    if capabilities.supports_table_data_transfer
        && (!capabilities.supports_table_browsing || !capabilities.supports_transactions)
    {
        return Err("Table data transfer requires table browsing and transactions".to_string());
    }
    if capabilities.supports_table_data_transfer
        && !matches!(
            capabilities.lsp_language_id.trim(),
            "postgres" | "mysql" | "sqlite" | "duckdb"
        )
    {
        return Err(
            "Table data transfer requires a reviewed postgres, mysql, sqlite, or duckdb dialect profile"
                .to_string(),
        );
    }
    Ok(())
}

fn validate_schema_migration_contract(
    capabilities: Option<&DatabaseCapabilities>,
    contract: Option<&DriverPackageSchemaMigrationContract>,
) -> Result<(), String> {
    let Some(contract) = contract else {
        return Ok(());
    };
    if contract.snapshot_version != 1 {
        return Err("Semantic schema migration requires snapshotVersion 1".to_string());
    }
    let Some(capabilities) = capabilities else {
        return Err(
            "Semantic schema migration requires a signed database capability contract".to_string(),
        );
    };
    if !matches!(
        capabilities.data_model,
        crate::core::dialect::DatabaseDataModel::Relational
    ) || !capabilities.supports_table_browsing
        || !capabilities.supports_table_ddl
    {
        return Err(
            "Semantic schema migration requires relational metadata browsing and table DDL capabilities"
                .to_string(),
        );
    }
    if contract.mode == SchemaMigrationMode::Transactional && !capabilities.supports_transactions {
        return Err(
            "Transactional semantic schema migration requires transaction capability".to_string(),
        );
    }
    Ok(())
}

fn validate_package_boundary(registry_root: &Path, package_root: &Path) -> Result<(), String> {
    let canonical_registry = fs::canonicalize(registry_root)
        .map_err(|error| format!("Cannot resolve driver registry directory: {error}"))?;
    let canonical_package = fs::canonicalize(package_root)
        .map_err(|error| format!("Cannot resolve driver package directory: {error}"))?;
    if !canonical_package.starts_with(&canonical_registry) {
        return Err("Driver package resolves outside the driver registry".to_string());
    }
    Ok(())
}

pub fn is_safe_driver_package_token(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 96
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
        })
}

fn is_safe_token(value: &str) -> bool {
    is_safe_driver_package_token(value)
}

fn protocol_is_compatible(protocol_version: &str) -> bool {
    oxide_driver_protocol::protocol_is_compatible(protocol_version)
}

fn current_target() -> String {
    format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)
}

fn supports_current_target(manifest: &DriverPackageManifest) -> bool {
    supports_current_target_names(&manifest.supported_targets)
}

fn supports_current_target_names(targets: &[String]) -> bool {
    let aliases = current_target_aliases();
    targets.is_empty()
        || targets.iter().any(|target| {
            target == "*"
                || aliases
                    .iter()
                    .any(|alias| target.eq_ignore_ascii_case(alias))
        })
}

fn current_target_aliases() -> Vec<String> {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    let os_alias = match os {
        "macos" => "darwin",
        "windows" => "win32",
        value => value,
    };
    let arch_alias = match arch {
        "aarch64" => "arm64",
        "x86_64" => "x64",
        value => value,
    };
    let mut aliases = vec![format!("{os}-{arch}"), format!("{os_alias}-{arch_alias}")];
    aliases.sort();
    aliases.dedup();
    aliases
}

fn verify_entrypoint_digest(entrypoint: &Path, expected: &str) -> Result<(), String> {
    verify_file_digest(entrypoint, expected, "Driver entrypoint")
}

fn verify_runtime_dependencies(
    package_root: &Path,
    runtime: &DriverPackageRuntime,
) -> Result<(), String> {
    let DriverPackageRuntime::Java(java) = runtime else {
        return Ok(());
    };
    for entry in &java.classpath {
        let path = package_relative_file(package_root, &entry.path, "Java driver classpath")?;
        verify_file_digest(&path, &entry.sha256, "Java driver classpath")?;
    }
    Ok(())
}

fn validate_sha256(value: &str, label: &str) -> Result<(), String> {
    if value.len() != 64 || !value.chars().all(|character| character.is_ascii_hexdigit()) {
        return Err(format!("{label} must be a 64-character hex digest"));
    }
    Ok(())
}

fn verify_file_digest(path: &Path, expected: &str, label: &str) -> Result<(), String> {
    validate_sha256(expected, &format!("{label} SHA-256"))?;
    let mut file = fs::File::open(path).map_err(|error| format!("Cannot open {label}: {error}"))?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("Cannot read {label}: {error}"))?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    let actual = format!("{:x}", digest.finalize());
    if actual.eq_ignore_ascii_case(expected) {
        Ok(())
    } else {
        Err(format!("{label} digest does not match its manifest"))
    }
}

fn validated_catalog_url(value: &str, label: &str) -> Result<Url, String> {
    let url = Url::parse(value.trim()).map_err(|error| format!("{label} is invalid: {error}"))?;
    if url.scheme() != "https" {
        return Err(format!("{label} must use HTTPS"));
    }
    if url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() {
        return Err(format!(
            "{label} must include a host and cannot include credentials"
        ));
    }
    if url.fragment().is_some() || url.query().is_some() {
        return Err(format!("{label} cannot include a query or fragment"));
    }
    Ok(url)
}

fn catalog_signature_url(catalog_url: &Url) -> Result<Url, String> {
    let mut signature_url = catalog_url.clone();
    let path = signature_url.path();
    if path.is_empty() || path.ends_with('/') {
        return Err("Driver catalog URL must identify a catalog document".to_string());
    }
    signature_url.set_path(&format!("{path}.minisig"));
    Ok(signature_url)
}

async fn fetch_limited_bytes(
    client: &reqwest::Client,
    url: &str,
    limit: u64,
) -> Result<Vec<u8>, String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Cannot fetch signed driver catalog: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Cannot fetch signed driver catalog: server returned {}",
            response.status()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > limit)
    {
        return Err(format!(
            "Signed driver catalog exceeds {} KiB",
            limit / 1024
        ));
    }
    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("Cannot read signed driver catalog: {error}"))?;
        let next_len = bytes.len().saturating_add(chunk.len());
        if next_len > limit as usize {
            return Err(format!(
                "Signed driver catalog exceeds {} KiB",
                limit / 1024
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

async fn download_driver_package_archive(
    client: &reqwest::Client,
    url: &str,
    destination: &Path,
    expected_sha256: &str,
) -> Result<(), String> {
    validate_sha256(expected_sha256, "Driver package archive SHA-256")?;
    ensure_catalog_cache_parent(destination)?;
    let partial_path = catalog_cache_partial_path(destination)?;
    let mut retry_without_range = false;

    for attempt in 0..2 {
        if retry_without_range && partial_path.exists() {
            fs::remove_file(&partial_path).map_err(|error| {
                format!("Cannot reset incomplete driver package download: {error}")
            })?;
        }
        let existing = resumable_partial_length(&partial_path)?;
        let mut request = client.get(url);
        if existing > 0 {
            request = request.header(RANGE, format!("bytes={existing}-"));
        }
        let response = request
            .send()
            .await
            .map_err(|error| format!("Cannot download driver package: {error}"))?;

        if existing > 0 && response.status() == StatusCode::RANGE_NOT_SATISFIABLE {
            if archive_file_matches_digest(&partial_path, expected_sha256)? {
                publish_resumed_driver_archive(&partial_path, destination, expected_sha256)?;
                return Ok(());
            }
            retry_without_range = true;
            continue;
        }

        let append = if existing > 0 && response.status() == StatusCode::PARTIAL_CONTENT {
            if let Err(error) =
                validate_content_range(response.headers().get(CONTENT_RANGE), existing)
            {
                fs::remove_file(&partial_path).map_err(|remove_error| {
                    format!("Cannot reset unsafe driver package resume: {remove_error}")
                })?;
                if attempt == 0 {
                    retry_without_range = true;
                    continue;
                }
                return Err(error);
            }
            true
        } else if response.status() == StatusCode::OK {
            false
        } else {
            return Err(format!(
                "Cannot download driver package: server returned {}",
                response.status()
            ));
        };
        let retained = if append { existing } else { 0 };
        if response.content_length().is_some_and(|length| {
            retained
                .checked_add(length)
                .is_none_or(|total| total > MAX_DRIVER_PACKAGE_ARCHIVE_BYTES)
        }) {
            return Err("Driver package archive exceeds the 512 MiB limit".to_string());
        }

        let mut digest = Sha256::new();
        if append {
            update_digest_from_file(&partial_path, &mut digest)?;
        }
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .append(append)
            .truncate(!append)
            .open(&partial_path)
            .map_err(|error| format!("Cannot open incomplete driver package download: {error}"))?;
        let mut downloaded = retained;
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = match chunk {
                Ok(chunk) => chunk,
                Err(error) => {
                    let _ = output.sync_data();
                    return Err(format!("Cannot read driver package download: {error}"));
                }
            };
            downloaded = downloaded
                .checked_add(u64::try_from(chunk.len()).unwrap_or(u64::MAX))
                .ok_or_else(|| "Driver package archive size overflow".to_string())?;
            if downloaded > MAX_DRIVER_PACKAGE_ARCHIVE_BYTES {
                let _ = output.sync_data();
                return Err("Driver package archive exceeds the 512 MiB limit".to_string());
            }
            output
                .write_all(&chunk)
                .map_err(|error| format!("Cannot stage driver package archive: {error}"))?;
            digest.update(&chunk);
        }
        output
            .sync_all()
            .map_err(|error| format!("Cannot finalize driver package archive: {error}"))?;
        drop(output);
        let actual = format!("{:x}", digest.finalize());
        if !actual.eq_ignore_ascii_case(expected_sha256) {
            fs::remove_file(&partial_path).map_err(|error| {
                format!("Cannot remove invalid driver package download: {error}")
            })?;
            return Err(
                "Driver package archive digest does not match the signed catalog".to_string(),
            );
        }
        publish_resumed_driver_archive(&partial_path, destination, expected_sha256)?;
        return Ok(());
    }

    Err("Driver package server rejected the cached resume offset".to_string())
}

fn catalog_cache_partial_path(cache_path: &Path) -> Result<PathBuf, String> {
    let file_name = cache_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Driver package cache path has no valid file name".to_string())?;
    Ok(cache_path.with_file_name(format!(".{file_name}.partial")))
}

fn ensure_catalog_cache_parent(cache_path: &Path) -> Result<(), String> {
    let version_directory = cache_path
        .parent()
        .ok_or_else(|| "Driver package cache path has no parent directory".to_string())?;
    let driver_directory = version_directory
        .parent()
        .ok_or_else(|| "Driver package cache path has no driver directory".to_string())?;
    let cache_directory = driver_directory
        .parent()
        .ok_or_else(|| "Driver package cache path has no cache directory".to_string())?;

    fs::create_dir_all(cache_directory)
        .map_err(|error| format!("Cannot create driver package cache directory: {error}"))?;
    for directory in [cache_directory, driver_directory, version_directory] {
        if !directory.exists() {
            fs::create_dir(directory).map_err(|error| {
                format!("Cannot create driver package cache directory: {error}")
            })?;
        }
        let metadata = fs::symlink_metadata(directory)
            .map_err(|error| format!("Cannot inspect driver package cache directory: {error}"))?;
        if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
            return Err("Driver package cache directory is invalid".to_string());
        }
    }
    Ok(())
}

fn activation_retained_driver_packages(root: &Path) -> BTreeSet<(String, String)> {
    let mut retained = BTreeSet::new();
    let Ok(drivers) = fs::read_dir(root) else {
        return retained;
    };
    for driver in drivers.flatten() {
        let Ok(file_type) = driver.file_type() else {
            continue;
        };
        if !file_type.is_dir() || file_type.is_symlink() {
            continue;
        }
        let Some(driver_id) = driver.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if !is_safe_token(&driver_id) {
            continue;
        }
        let Some(state) = read_activation_state(&driver.path()) else {
            continue;
        };
        retained.insert((driver_id.clone(), state.current));
        if let Some(previous) = state.previous {
            retained.insert((driver_id, previous));
        }
    }
    retained
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CatalogCacheFileKind {
    Complete,
    Partial,
}

fn catalog_cache_file_kind(file_name: &str) -> Option<CatalogCacheFileKind> {
    let (digest, kind) = if let Some(digest) = file_name
        .strip_prefix('.')
        .and_then(|value| value.strip_suffix(".tar.gz.partial"))
    {
        (digest, CatalogCacheFileKind::Partial)
    } else if let Some(digest) = file_name.strip_suffix(".tar.gz") {
        (digest, CatalogCacheFileKind::Complete)
    } else {
        return None;
    };
    (digest.len() == 64 && digest.bytes().all(|value| value.is_ascii_hexdigit())).then_some(kind)
}

fn prune_catalog_cache_files(
    cache_root: &Path,
    retained: &BTreeSet<(String, String)>,
) -> Result<DriverPackageCachePruneResult, String> {
    let cache_metadata = match fs::symlink_metadata(cache_root) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(DriverPackageCachePruneResult::default())
        }
        Err(error) => return Err(format!("Cannot inspect driver package cache: {error}")),
    };
    if !cache_metadata.file_type().is_dir() || cache_metadata.file_type().is_symlink() {
        return Err("Driver package cache root is invalid".to_string());
    }

    let mut result = DriverPackageCachePruneResult::default();
    let drivers = fs::read_dir(cache_root)
        .map_err(|error| format!("Cannot read driver package cache: {error}"))?;
    for driver in drivers {
        let driver =
            driver.map_err(|error| format!("Cannot read driver package cache: {error}"))?;
        let file_type = driver
            .file_type()
            .map_err(|error| format!("Cannot inspect driver package cache entry: {error}"))?;
        let Some(driver_id) = driver.file_name().to_str().map(str::to_string) else {
            result.skipped_entries = result.skipped_entries.saturating_add(1);
            continue;
        };
        if !file_type.is_dir() || file_type.is_symlink() || !is_safe_token(&driver_id) {
            result.skipped_entries = result.skipped_entries.saturating_add(1);
            continue;
        }

        let versions = fs::read_dir(driver.path())
            .map_err(|error| format!("Cannot read driver package cache directory: {error}"))?;
        for version in versions {
            let version = version
                .map_err(|error| format!("Cannot read driver package cache directory: {error}"))?;
            let file_type = version.file_type().map_err(|error| {
                format!("Cannot inspect driver package cache directory: {error}")
            })?;
            let Some(package_version) = version.file_name().to_str().map(str::to_string) else {
                result.skipped_entries = result.skipped_entries.saturating_add(1);
                continue;
            };
            if !file_type.is_dir() || file_type.is_symlink() || !is_safe_token(&package_version) {
                result.skipped_entries = result.skipped_entries.saturating_add(1);
                continue;
            }
            if retained.contains(&(driver_id.clone(), package_version)) {
                result.retained_versions = result.retained_versions.saturating_add(1);
                continue;
            }

            let files = fs::read_dir(version.path()).map_err(|error| {
                format!("Cannot read driver package cache version directory: {error}")
            })?;
            for file in files {
                let file = file.map_err(|error| {
                    format!("Cannot read driver package cache version directory: {error}")
                })?;
                let file_type = file.file_type().map_err(|error| {
                    format!("Cannot inspect driver package cache file: {error}")
                })?;
                let Some(file_name) = file.file_name().to_str().map(str::to_string) else {
                    result.skipped_entries = result.skipped_entries.saturating_add(1);
                    continue;
                };
                let Some(kind) = catalog_cache_file_kind(&file_name) else {
                    result.skipped_entries = result.skipped_entries.saturating_add(1);
                    continue;
                };
                if !file_type.is_file() || file_type.is_symlink() {
                    result.skipped_entries = result.skipped_entries.saturating_add(1);
                    continue;
                }
                let bytes = file
                    .metadata()
                    .map_err(|error| format!("Cannot inspect driver package cache file: {error}"))?
                    .len();
                fs::remove_file(file.path())
                    .map_err(|error| format!("Cannot remove driver package cache file: {error}"))?;
                result.files_removed = result.files_removed.saturating_add(1);
                result.bytes_removed = result.bytes_removed.saturating_add(bytes);
                if kind == CatalogCacheFileKind::Partial {
                    result.partial_files_removed = result.partial_files_removed.saturating_add(1);
                }
            }

            if fs::read_dir(version.path())
                .map_err(|error| {
                    format!("Cannot inspect driver package cache version directory: {error}")
                })?
                .next()
                .is_none()
            {
                fs::remove_dir(version.path()).map_err(|error| {
                    format!("Cannot remove empty driver package cache directory: {error}")
                })?;
                result.versions_removed = result.versions_removed.saturating_add(1);
            }
        }

        if fs::read_dir(driver.path())
            .map_err(|error| format!("Cannot inspect driver package cache directory: {error}"))?
            .next()
            .is_none()
        {
            fs::remove_dir(driver.path()).map_err(|error| {
                format!("Cannot remove empty driver package cache directory: {error}")
            })?;
        }
    }
    Ok(result)
}

fn resumable_partial_length(path: &Path) -> Result<u64, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => {
            return Err(format!(
                "Cannot inspect incomplete driver package download: {error}"
            ))
        }
    };
    if !metadata.file_type().is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > MAX_DRIVER_PACKAGE_ARCHIVE_BYTES
    {
        fs::remove_file(path).map_err(|error| {
            format!("Cannot remove invalid incomplete driver package download: {error}")
        })?;
        return Ok(0);
    }
    Ok(metadata.len())
}

fn validate_content_range(
    value: Option<&reqwest::header::HeaderValue>,
    expected_start: u64,
) -> Result<(), String> {
    let value = value
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "Driver package resume response has no valid Content-Range".to_string())?;
    let value = value
        .strip_prefix("bytes ")
        .ok_or_else(|| "Driver package resume response has an invalid Content-Range".to_string())?;
    let (range, total) = value
        .split_once('/')
        .ok_or_else(|| "Driver package resume response has an invalid Content-Range".to_string())?;
    let (start, end) = range
        .split_once('-')
        .ok_or_else(|| "Driver package resume response has an invalid Content-Range".to_string())?;
    let start = start
        .parse::<u64>()
        .map_err(|_| "Driver package resume response has an invalid Content-Range".to_string())?;
    let end = end
        .parse::<u64>()
        .map_err(|_| "Driver package resume response has an invalid Content-Range".to_string())?;
    let total = total
        .parse::<u64>()
        .map_err(|_| "Driver package resume response has an invalid Content-Range".to_string())?;
    if start != expected_start
        || end < start
        || end >= total
        || total > MAX_DRIVER_PACKAGE_ARCHIVE_BYTES
    {
        return Err("Driver package resume response has an unsafe Content-Range".to_string());
    }
    Ok(())
}

fn update_digest_from_file(path: &Path, digest: &mut Sha256) -> Result<(), String> {
    let mut input = fs::File::open(path)
        .map_err(|error| format!("Cannot read incomplete driver package download: {error}"))?;
    let mut read_total = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = input
            .read(&mut buffer)
            .map_err(|error| format!("Cannot read incomplete driver package download: {error}"))?;
        if read == 0 {
            break;
        }
        read_total = read_total
            .checked_add(u64::try_from(read).unwrap_or(u64::MAX))
            .ok_or_else(|| "Driver package archive size overflow".to_string())?;
        if read_total > MAX_DRIVER_PACKAGE_ARCHIVE_BYTES {
            return Err("Driver package archive exceeds the 512 MiB limit".to_string());
        }
        digest.update(&buffer[..read]);
    }
    Ok(())
}

fn publish_resumed_driver_archive(
    partial_path: &Path,
    destination: &Path,
    expected_sha256: &str,
) -> Result<(), String> {
    if destination.exists() {
        if archive_file_matches_digest(destination, expected_sha256)? {
            fs::remove_file(partial_path).map_err(|error| {
                format!("Cannot remove redundant driver package download: {error}")
            })?;
            return Ok(());
        }
        return Err("Driver package cache destination already exists and is invalid".to_string());
    }
    fs::rename(partial_path, destination)
        .map_err(|error| format!("Cannot publish verified driver package archive: {error}"))
}

/// Return the only permitted cache location for a catalog archive. The digest
/// is part of the filename, so a republished version cannot replace a cached
/// archive with different bytes.
fn catalog_cache_archive_path(
    root: &Path,
    driver_id: &str,
    package_version: &str,
    archive_sha256: &str,
) -> Result<PathBuf, String> {
    if !is_safe_token(driver_id) || !is_safe_token(package_version) {
        return Err("Invalid driver package identity for archive cache".to_string());
    }
    validate_sha256(archive_sha256, "Driver package archive SHA-256")?;
    Ok(root
        .join(DRIVER_PACKAGE_CACHE_DIRECTORY)
        .join(driver_id)
        .join(package_version)
        .join(format!("{archive_sha256}.tar.gz")))
}

/// Copy a verified cached archive into an invocation-local staging directory.
/// A corrupt or non-regular cache entry is discarded and treated as a miss;
/// callers then download the exact archive bound by the signed catalog.
fn copy_cached_driver_package_archive(
    cache_path: &Path,
    destination: &Path,
    expected_sha256: &str,
) -> Result<bool, String> {
    let metadata = match fs::symlink_metadata(cache_path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(format!("Cannot inspect cached driver package: {error}")),
    };
    if !metadata.file_type().is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > MAX_DRIVER_PACKAGE_ARCHIVE_BYTES
        || !archive_file_matches_digest(cache_path, expected_sha256)?
    {
        // The path was constructed from validated tokens and a digest. Do not
        // retain a malformed cache file forever, but never recurse or touch
        // anything outside that one entry.
        fs::remove_file(cache_path)
            .map_err(|error| format!("Cannot remove invalid cached driver package: {error}"))?;
        return Ok(false);
    }
    copy_archive_file(cache_path, destination, expected_sha256)?;
    Ok(true)
}

/// Persist a second verified copy only after the temporary download has passed
/// the catalog digest check. This is intentionally best-effort; cache storage
/// is never an authority for package execution.
#[cfg(test)]
fn cache_driver_package_archive(
    source: &Path,
    cache_path: &Path,
    expected_sha256: &str,
) -> Result<(), String> {
    let parent = cache_path
        .parent()
        .ok_or_else(|| "Driver package cache path has no parent directory".to_string())?;
    ensure_catalog_cache_parent(cache_path)?;
    if cache_path.exists() {
        return Ok(());
    }
    let mut temporary = NamedTempFile::new_in(parent)
        .map_err(|error| format!("Cannot create driver package cache staging file: {error}"))?;
    write_archive_copy(source, temporary.as_file_mut(), expected_sha256)?;
    temporary.persist_noclobber(cache_path).map_err(|error| {
        if error.error.kind() == std::io::ErrorKind::AlreadyExists {
            "Driver package archive was cached concurrently".to_string()
        } else {
            format!(
                "Cannot publish cached driver package archive: {}",
                error.error
            )
        }
    })?;
    Ok(())
}

fn copy_archive_file(
    source: &Path,
    destination: &Path,
    expected_sha256: &str,
) -> Result<(), String> {
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map_err(|error| format!("Cannot create driver package archive copy: {error}"))?;
    write_archive_copy(source, &mut output, expected_sha256)
}

fn write_archive_copy(
    source: &Path,
    output: &mut fs::File,
    expected_sha256: &str,
) -> Result<(), String> {
    let source_metadata = fs::symlink_metadata(source)
        .map_err(|error| format!("Cannot inspect driver package archive: {error}"))?;
    if !source_metadata.file_type().is_file()
        || source_metadata.file_type().is_symlink()
        || source_metadata.len() > MAX_DRIVER_PACKAGE_ARCHIVE_BYTES
    {
        return Err("Driver package archive is invalid".to_string());
    }
    let mut input = fs::File::open(source)
        .map_err(|error| format!("Cannot read driver package archive: {error}"))?;
    let mut digest = Sha256::new();
    let mut copied = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = input
            .read(&mut buffer)
            .map_err(|error| format!("Cannot read driver package archive: {error}"))?;
        if read == 0 {
            break;
        }
        copied = copied
            .checked_add(u64::try_from(read).unwrap_or(u64::MAX))
            .ok_or_else(|| "Driver package archive size overflow".to_string())?;
        if copied > MAX_DRIVER_PACKAGE_ARCHIVE_BYTES {
            return Err("Driver package archive exceeds the 512 MiB limit".to_string());
        }
        output
            .write_all(&buffer[..read])
            .map_err(|error| format!("Cannot write driver package archive copy: {error}"))?;
        digest.update(&buffer[..read]);
    }
    output
        .sync_all()
        .map_err(|error| format!("Cannot finalize driver package archive copy: {error}"))?;
    let actual = format!("{:x}", digest.finalize());
    if !actual.eq_ignore_ascii_case(expected_sha256) {
        return Err("Driver package archive digest does not match the signed catalog".to_string());
    }
    Ok(())
}

fn archive_file_matches_digest(path: &Path, expected_sha256: &str) -> Result<bool, String> {
    let mut input = fs::File::open(path)
        .map_err(|error| format!("Cannot read cached driver package: {error}"))?;
    let mut digest = Sha256::new();
    let mut read_total = 0u64;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = input
            .read(&mut buffer)
            .map_err(|error| format!("Cannot read cached driver package: {error}"))?;
        if read == 0 {
            break;
        }
        read_total = read_total
            .checked_add(u64::try_from(read).unwrap_or(u64::MAX))
            .ok_or_else(|| "Cached driver package size overflow".to_string())?;
        if read_total > MAX_DRIVER_PACKAGE_ARCHIVE_BYTES {
            return Ok(false);
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()).eq_ignore_ascii_case(expected_sha256))
}

fn unpack_driver_package_archive(archive_path: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir(destination)
        .map_err(|error| format!("Cannot create package extraction directory: {error}"))?;
    let archive = fs::File::open(archive_path)
        .map_err(|error| format!("Cannot open driver package archive: {error}"))?;
    let mut archive = Archive::new(GzDecoder::new(archive));
    let mut budget = PackageCopyBudget::default();
    let mut paths = std::collections::HashSet::new();
    for entry in archive
        .entries()
        .map_err(|error| format!("Cannot read driver package archive: {error}"))?
    {
        let mut entry =
            entry.map_err(|error| format!("Cannot read driver package archive entry: {error}"))?;
        let relative = entry
            .path()
            .map_err(|error| format!("Driver package archive path is invalid: {error}"))?;
        let relative = safe_archive_relative_path(&relative)?;
        if !paths.insert(relative.clone()) {
            return Err("Driver package archive contains duplicate paths".to_string());
        }
        if relative.components().count() > MAX_DRIVER_PACKAGE_DEPTH {
            return Err("Driver package archive nesting exceeds the limit".to_string());
        }
        let destination_path = destination.join(&relative);
        if entry.header().entry_type().is_dir() {
            fs::create_dir_all(&destination_path)
                .map_err(|error| format!("Cannot create package archive directory: {error}"))?;
            continue;
        }
        if !entry.header().entry_type().is_file() {
            return Err(
                "Driver package archive may contain only regular files and directories".to_string(),
            );
        }
        budget.files = budget
            .files
            .checked_add(1)
            .ok_or_else(|| "Driver package archive file count overflow".to_string())?;
        if budget.files > MAX_DRIVER_PACKAGE_FILES {
            return Err("Driver package archive contains too many files".to_string());
        }
        let declared_size = entry
            .header()
            .size()
            .map_err(|error| format!("Driver package archive file size is invalid: {error}"))?;
        budget.bytes = budget
            .bytes
            .checked_add(declared_size)
            .ok_or_else(|| "Driver package archive size overflow".to_string())?;
        if budget.bytes > MAX_DRIVER_PACKAGE_BYTES {
            return Err("Driver package archive expands beyond the 512 MiB limit".to_string());
        }
        let parent = destination_path
            .parent()
            .ok_or_else(|| "Driver package archive file has no parent".to_string())?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("Cannot create package archive parent directory: {error}"))?;
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination_path)
            .map_err(|error| format!("Cannot create extracted package file: {error}"))?;
        let copied = std::io::copy(&mut entry, &mut output)
            .map_err(|error| format!("Cannot extract driver package file: {error}"))?;
        if copied != declared_size {
            return Err("Driver package archive file size changed during extraction".to_string());
        }
        output
            .sync_all()
            .map_err(|error| format!("Cannot finalize extracted package file: {error}"))?;
    }
    Ok(())
}

fn safe_archive_relative_path(path: &Path) -> Result<PathBuf, String> {
    if path.as_os_str().is_empty() || path.is_absolute() {
        return Err("Driver package archive contains an invalid path".to_string());
    }
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => normalized.push(value),
            _ => return Err("Driver package archive path escapes its package root".to_string()),
        }
    }
    Ok(normalized)
}

fn verify_detached_document(
    document: &[u8],
    signature_text: &[u8],
    trust: &DriverPackageTrust,
    label: &str,
) -> Result<(), String> {
    match trust {
        DriverPackageTrust::PublicKey(public_key) => {
            let signature_text = std::str::from_utf8(signature_text)
                .map_err(|error| format!("{label} signature is not UTF-8: {error}"))?;
            let signature = Signature::decode(signature_text)
                .map_err(|error| format!("{label} signature is invalid: {error}"))?;
            public_key
                .verify(document, &signature, false)
                .map_err(|error| format!("{label} signature is not trusted: {error}"))
        }
        DriverPackageTrust::Unavailable => {
            Err("No trusted database driver signing key is configured in this build".to_string())
        }
        DriverPackageTrust::InvalidKey(error) => Err(format!(
            "The database driver signing key configured for this build is invalid: {error}"
        )),
        #[cfg(test)]
        DriverPackageTrust::AllowUnsigned => Ok(()),
    }
}

fn validate_driver_catalog(catalog: &DriverPackageCatalog) -> Result<(), String> {
    if catalog.schema_version != DRIVER_PACKAGE_CATALOG_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported driver catalog schema version {}",
            catalog.schema_version
        ));
    }
    if catalog.packages.len() > MAX_DRIVER_CATALOG_ENTRIES {
        return Err(format!(
            "Driver catalog contains more than {MAX_DRIVER_CATALOG_ENTRIES} packages"
        ));
    }
    if catalog
        .generated_at
        .as_deref()
        .is_some_and(|value| value.is_empty() || value.len() > 128)
    {
        return Err("Driver catalog contains an invalid generated-at value".to_string());
    }
    let mut identities = std::collections::HashSet::new();
    for entry in &catalog.packages {
        if !is_safe_token(&entry.driver_id) || !is_safe_token(&entry.package_version) {
            return Err("Driver catalog contains an invalid package identity".to_string());
        }
        if !identities.insert((&entry.driver_id, &entry.package_version)) {
            return Err("Driver catalog contains a duplicate package identity".to_string());
        }
        for value in [
            &entry.display_name,
            &entry.protocol_version,
            &entry.download_url,
        ] {
            if value.trim().is_empty() || value.len() > MAX_DRIVER_CATALOG_FIELD_LENGTH {
                return Err("Driver catalog contains an invalid field length".to_string());
            }
        }
        validated_catalog_url(&entry.download_url, "Driver package download URL")?;
        if let Some(archive_sha256) = entry.archive_sha256.as_deref() {
            validate_sha256(archive_sha256, "Driver package archive SHA-256")?;
        }
        if let Some(url) = entry.release_notes_url.as_deref() {
            if url.len() > MAX_DRIVER_CATALOG_FIELD_LENGTH {
                return Err("Driver catalog contains an invalid release notes URL".to_string());
            }
            validated_catalog_url(url, "Driver release notes URL")?;
        }
        validate_server_version_range(entry.server_version_range.as_deref())?;
        validate_connection_url_template(entry.connection_url_template.as_deref())?;
        if let Some(capabilities) = &entry.capabilities {
            validate_capability_contract(&entry.driver_id, capabilities)?;
        }
        validate_schema_migration_contract(
            entry.capabilities.as_ref(),
            entry.schema_migration.as_ref(),
        )?;
        if let Some(conformance) = &entry.conformance {
            validate_driver_conformance(entry, conformance)?;
            validate_conformance_capability_contract(
                entry.capabilities.as_ref(),
                entry.schema_migration.as_ref(),
                conformance,
            )?;
        }
        if entry.supported_targets.len() > 16
            || entry
                .supported_targets
                .iter()
                .any(|target| target.len() > 96 || !(target == "*" || is_safe_token(target)))
            || entry
                .supported_targets
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len()
                != entry.supported_targets.len()
        {
            return Err("Driver catalog contains invalid supported targets".to_string());
        }
    }
    Ok(())
}

fn validate_driver_conformance(
    entry: &DriverPackageCatalogEntry,
    conformance: &DriverPackageConformance,
) -> Result<(), String> {
    const MAX_VERSIONS_PER_OPERATION: usize = 32;
    const MAX_EVIDENCE_PER_PACKAGE: usize = 128;
    for (_, versions) in conformance_operation_versions(conformance) {
        if versions.len() > MAX_VERSIONS_PER_OPERATION
            || versions.iter().any(|version| {
                let version = version.trim();
                version.is_empty() || version.len() > 96 || version.contains('\0')
            })
        {
            return Err("Driver catalog contains invalid conformance versions".to_string());
        }
        let distinct = versions
            .iter()
            .map(|version| version.trim().to_ascii_lowercase())
            .collect::<std::collections::HashSet<_>>();
        if distinct.len() != versions.len() {
            return Err("Driver catalog contains duplicate conformance versions".to_string());
        }
    }
    if conformance.evidence.len() > MAX_EVIDENCE_PER_PACKAGE {
        return Err("Driver catalog contains too many conformance evidence records".to_string());
    }
    let mut evidence_keys = std::collections::HashSet::new();
    for evidence in &conformance.evidence {
        validate_driver_conformance_evidence(entry, evidence)?;
        let key = format!(
            "{}:{}:{}:{}:{}",
            evidence.target.to_ascii_lowercase(),
            evidence.server_version.to_ascii_lowercase(),
            evidence.fixture_id.to_ascii_lowercase(),
            evidence.report_sha256.to_ascii_lowercase(),
            evidence.operations.join(",").to_ascii_lowercase(),
        );
        if !evidence_keys.insert(key) {
            return Err("Driver catalog contains duplicate conformance evidence".to_string());
        }
    }
    for (operation, versions) in conformance_operation_versions(conformance) {
        for version in versions {
            let covered = conformance.evidence.iter().any(|evidence| {
                evidence.server_version.eq_ignore_ascii_case(version)
                    && evidence
                        .operations
                        .iter()
                        .any(|candidate| candidate == operation)
            });
            if !covered {
                return Err(format!(
                    "Driver catalog conformance {operation} version {version} has no matching runner evidence"
                ));
            }
        }
    }
    Ok(())
}

fn conformance_operation_versions(
    conformance: &DriverPackageConformance,
) -> [(&'static str, &Vec<String>); 7] {
    [
        ("connect", &conformance.connect),
        ("metadata", &conformance.metadata),
        ("query", &conformance.query),
        ("cancellation", &conformance.cancellation),
        ("mutations", &conformance.mutations),
        ("migration", &conformance.migration),
        ("dataTransfer", &conformance.data_transfer),
    ]
}

fn validate_driver_conformance_evidence(
    entry: &DriverPackageCatalogEntry,
    evidence: &DriverPackageConformanceEvidence,
) -> Result<(), String> {
    if evidence.schema_version != 1
        || !is_safe_token(&evidence.runner_version)
        || evidence.driver_id != entry.driver_id
        || evidence.package_version != entry.package_version
        || !is_safe_token(&evidence.target)
        || !is_safe_token(&evidence.fixture_id)
        || evidence.server_version.trim().is_empty()
        || evidence.server_version.len() > 96
        || evidence.server_version.contains('\0')
    {
        return Err("Driver catalog contains invalid conformance evidence identity".to_string());
    }
    if !entry.supported_targets.is_empty()
        && !entry
            .supported_targets
            .iter()
            .any(|target| target == "*" || target.eq_ignore_ascii_case(&evidence.target))
    {
        return Err(
            "Driver catalog conformance evidence target is not supported by the package"
                .to_string(),
        );
    }
    validate_sha256(
        &evidence.entrypoint_sha256,
        "Driver conformance entrypoint SHA-256",
    )?;
    validate_sha256(
        &evidence.fixture_sha256,
        "Driver conformance fixture SHA-256",
    )?;
    validate_sha256(&evidence.report_sha256, "Driver conformance report SHA-256")?;
    validated_catalog_url(&evidence.report_url, "Driver conformance report URL")?;
    if evidence.operations.is_empty()
        || evidence.operations.len() > 7
        || evidence
            .operations
            .iter()
            .any(|operation| !conformance_operation_is_valid(operation))
        || evidence
            .operations
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len()
            != evidence.operations.len()
        || !evidence
            .operations
            .iter()
            .any(|operation| operation == "connect")
    {
        return Err("Driver catalog contains invalid conformance evidence operations".to_string());
    }
    Ok(())
}

fn conformance_operation_is_valid(operation: &str) -> bool {
    matches!(
        operation,
        "connect"
            | "metadata"
            | "query"
            | "cancellation"
            | "mutations"
            | "migration"
            | "dataTransfer"
    )
}

/// Release evidence is advisory rather than executable authority, but it must
/// still be internally honest. A catalog cannot advertise tested query,
/// metadata, Grid writes, migrations, or cancellation for a package that does
/// not declare the corresponding user-facing capability.
fn validate_conformance_capability_contract(
    capabilities: Option<&DatabaseCapabilities>,
    schema_migration: Option<&DriverPackageSchemaMigrationContract>,
    conformance: &DriverPackageConformance,
) -> Result<(), String> {
    let needs_declared_capabilities = !conformance.metadata.is_empty()
        || !conformance.query.is_empty()
        || !conformance.cancellation.is_empty()
        || !conformance.mutations.is_empty()
        || !conformance.migration.is_empty()
        || !conformance.data_transfer.is_empty();
    if needs_declared_capabilities && conformance.connect.is_empty() {
        return Err(
            "Driver catalog conformance for advanced operations requires connection conformance"
                .to_string(),
        );
    }
    let Some(capabilities) = capabilities else {
        if needs_declared_capabilities {
            return Err(
                "Driver catalog conformance for advanced operations requires a capability contract"
                    .to_string(),
            );
        }
        return Ok(());
    };
    if !conformance.query.is_empty() && !capabilities.supports_sql_query {
        return Err(
            "Driver catalog declares query conformance without SQL query capability".to_string(),
        );
    }
    if !conformance.metadata.is_empty()
        && !capabilities.supports_table_browsing
        && !capabilities.supports_collection_browsing
        && !capabilities.supports_key_value_browsing
    {
        return Err(
            "Driver catalog declares metadata conformance without metadata browsing capability"
                .to_string(),
        );
    }
    if !conformance.cancellation.is_empty() && !capabilities.supports_query_cancellation {
        return Err(
            "Driver catalog declares cancellation conformance without query cancellation capability"
                .to_string(),
        );
    }
    if !conformance.mutations.is_empty() && !capabilities.supports_table_row_mutation {
        return Err(
            "Driver catalog declares mutation conformance without table row mutation capability"
                .to_string(),
        );
    }
    if !conformance.migration.is_empty()
        && (!capabilities.supports_table_ddl || schema_migration.is_none())
    {
        return Err(
            "Driver catalog declares migration conformance without a semantic schema-migration contract"
                .to_string(),
        );
    }
    if !conformance.data_transfer.is_empty()
        && (!capabilities.supports_table_data_transfer || !capabilities.supports_table_browsing)
    {
        return Err(
            "Driver catalog declares data transfer conformance without a reviewed table data transfer capability"
                .to_string(),
        );
    }
    Ok(())
}

fn verify_package_signature(
    manifest_path: &Path,
    trust: &DriverPackageTrust,
) -> Result<(), String> {
    match trust {
        DriverPackageTrust::PublicKey(public_key) => {
            let manifest_metadata = fs::metadata(manifest_path)
                .map_err(|error| format!("Cannot inspect driver manifest: {error}"))?;
            if !manifest_metadata.is_file() || manifest_metadata.len() > MAX_DRIVER_MANIFEST_BYTES {
                return Err("Driver manifest is missing or exceeds 256 KiB".to_string());
            }
            let manifest = fs::read(manifest_path)
                .map_err(|error| format!("Cannot read driver manifest: {error}"))?;
            let signature_path = manifest_path.with_extension("json.minisig");
            let signature_metadata = fs::metadata(&signature_path).map_err(|error| {
                format!(
                    "Driver package signature is missing or unreadable ({}): {error}",
                    signature_path.display()
                )
            })?;
            if !signature_metadata.is_file()
                || signature_metadata.len() > MAX_DRIVER_SIGNATURE_BYTES
            {
                return Err("Driver package signature is missing or exceeds 64 KiB".to_string());
            }
            let signature_text = fs::read_to_string(&signature_path).map_err(|error| {
                format!(
                    "Driver package signature is missing or unreadable ({}): {error}",
                    signature_path.display()
                )
            })?;
            let signature = Signature::decode(&signature_text)
                .map_err(|error| format!("Driver package signature is invalid: {error}"))?;
            public_key
                .verify(&manifest, &signature, false)
                .map_err(|error| format!("Driver package signature is not trusted: {error}"))
        }
        DriverPackageTrust::Unavailable => {
            Err("No trusted database driver signing key is configured in this build".to_string())
        }
        DriverPackageTrust::InvalidKey(error) => Err(format!(
            "The database driver signing key configured for this build is invalid: {error}"
        )),
        #[cfg(test)]
        DriverPackageTrust::AllowUnsigned => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use oxide_driver_protocol::DriverRuntimeCapabilities;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
    };

    #[test]
    fn catalog_validation_requires_https_safe_identities_and_unique_versions() {
        let valid = DriverPackageCatalog {
            schema_version: DRIVER_PACKAGE_CATALOG_SCHEMA_VERSION,
            generated_at: Some("2026-07-31T00:00:00Z".to_string()),
            packages: vec![DriverPackageCatalogEntry {
                driver_id: "clickhouse".to_string(),
                display_name: "ClickHouse".to_string(),
                package_version: "1.2.3".to_string(),
                protocol_version: "1.0".to_string(),
                download_url: "https://drivers.example.com/clickhouse-1.2.3".to_string(),
                archive_sha256: None,
                supported_targets: vec!["darwin-arm64".to_string()],
                server_version_range: None,
                release_notes_url: None,
                connection_url_template: None,
                capabilities: Some({
                    let mut capabilities =
                        crate::core::dialect::database_capabilities_for_driver("postgres").unwrap();
                    capabilities.driver = "clickhouse".to_string();
                    capabilities.display_name = "ClickHouse".to_string();
                    capabilities
                }),
                schema_migration: None,
                conformance: Some(DriverPackageConformance {
                    connect: vec!["24.3".to_string()],
                    metadata: vec!["24.3".to_string()],
                    query: vec!["24.3".to_string()],
                    cancellation: vec!["24.3".to_string()],
                    mutations: Vec::new(),
                    migration: Vec::new(),
                    data_transfer: Vec::new(),
                    evidence: vec![DriverPackageConformanceEvidence {
                        schema_version: 1,
                        runner_version: "1.0.0".to_string(),
                        driver_id: "clickhouse".to_string(),
                        package_version: "1.2.3".to_string(),
                        entrypoint_sha256: "a".repeat(64),
                        target: "darwin-arm64".to_string(),
                        server_version: "24.3".to_string(),
                        fixture_id: "clickhouse-core-v1".to_string(),
                        fixture_sha256: "b".repeat(64),
                        report_url: "https://drivers.example.com/evidence/clickhouse-24.3.json"
                            .to_string(),
                        report_sha256: "c".repeat(64),
                        operations: vec![
                            "connect".to_string(),
                            "metadata".to_string(),
                            "query".to_string(),
                            "cancellation".to_string(),
                        ],
                    }],
                }),
            }],
        };
        assert!(validate_driver_catalog(&valid).is_ok());

        let mut missing_query_capability = valid.clone();
        missing_query_capability.packages[0]
            .capabilities
            .as_mut()
            .expect("test package should declare capabilities")
            .supports_sql_query = false;
        assert!(validate_driver_catalog(&missing_query_capability)
            .unwrap_err()
            .contains("query conformance"));

        let mut missing_metadata_contract = valid.clone();
        missing_metadata_contract.packages[0].capabilities = None;
        assert!(validate_driver_catalog(&missing_metadata_contract)
            .unwrap_err()
            .contains("requires a capability contract"));

        let mut missing_connect_conformance = valid.clone();
        missing_connect_conformance.packages[0]
            .conformance
            .as_mut()
            .expect("fixture has conformance")
            .connect = Vec::new();
        assert!(validate_driver_catalog(&missing_connect_conformance)
            .unwrap_err()
            .contains("requires connection conformance"));

        let mut insecure = valid.clone();
        insecure.packages[0].download_url = "http://drivers.example.com/package".to_string();
        assert!(validate_driver_catalog(&insecure)
            .unwrap_err()
            .contains("must use HTTPS"));

        let mut invalid_archive_digest = valid.clone();
        invalid_archive_digest.packages[0].archive_sha256 = Some("invalid".to_string());
        assert!(validate_driver_catalog(&invalid_archive_digest)
            .unwrap_err()
            .contains("SHA-256"));

        let mut duplicate = valid.clone();
        duplicate.packages.push(valid.packages[0].clone());
        assert!(validate_driver_catalog(&duplicate)
            .unwrap_err()
            .contains("duplicate"));

        let mut mismatched_capabilities = valid.clone();
        mismatched_capabilities.packages[0]
            .capabilities
            .as_mut()
            .unwrap()
            .driver = "postgres".to_string();
        assert!(validate_driver_catalog(&mismatched_capabilities)
            .unwrap_err()
            .contains("driverId"));

        let mut unsupported_version_range = valid.clone();
        unsupported_version_range.packages[0].server_version_range = Some("6 - 9".to_string());
        assert!(validate_driver_catalog(&unsupported_version_range)
            .unwrap_err()
            .contains("version range"));

        let mut duplicate_conformance = valid.clone();
        duplicate_conformance.packages[0]
            .conformance
            .as_mut()
            .unwrap()
            .query = vec!["24.3".to_string(), "24.3".to_string()];
        assert!(validate_driver_catalog(&duplicate_conformance)
            .unwrap_err()
            .contains("duplicate conformance"));

        let mut missing_runner_evidence = valid.clone();
        missing_runner_evidence.packages[0]
            .conformance
            .as_mut()
            .unwrap()
            .evidence
            .clear();
        assert!(validate_driver_catalog(&missing_runner_evidence)
            .unwrap_err()
            .contains("no matching runner evidence"));

        let mut evidence_package_mismatch = valid.clone();
        evidence_package_mismatch.packages[0]
            .conformance
            .as_mut()
            .unwrap()
            .evidence[0]
            .package_version = "9.9.9".to_string();
        assert!(validate_driver_catalog(&evidence_package_mismatch)
            .unwrap_err()
            .contains("invalid conformance evidence identity"));

        let mut unsupported_mutations = valid;
        let capabilities = unsupported_mutations.packages[0]
            .capabilities
            .as_mut()
            .expect("fixture has capabilities");
        capabilities.supports_table_row_mutation = false;
        unsupported_mutations.packages[0]
            .conformance
            .as_mut()
            .expect("fixture has conformance")
            .mutations = vec!["24.3".to_string()];
        unsupported_mutations.packages[0]
            .conformance
            .as_mut()
            .expect("fixture has conformance")
            .evidence[0]
            .operations
            .push("mutations".to_string());
        assert!(validate_driver_catalog(&unsupported_mutations)
            .unwrap_err()
            .contains("mutation conformance"));
    }

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

    #[test]
    fn connection_url_templates_are_bounded_and_allow_only_declared_placeholders() {
        assert!(validate_connection_url_template(Some(
            "jdbc:oracle:thin:@{host}:{port}/{database}",
        ))
        .is_ok());
        assert!(validate_connection_url_template(Some("jdbc:test://{unknown}")).is_err());
        assert!(validate_connection_url_template(Some("jdbc:test://{host")).is_err());
        assert!(validate_connection_url_template(Some("\u{0000}jdbc:test")).is_err());
    }

    #[test]
    fn catalog_release_contract_must_match_the_downloaded_manifest() {
        let capabilities = crate::core::dialect::database_capabilities_for_driver("postgres")
            .expect("PostgreSQL capabilities");
        let entry = DriverPackageCatalogEntry {
            driver_id: "warehouse".to_string(),
            display_name: "Warehouse".to_string(),
            package_version: "1.0.0".to_string(),
            protocol_version: DRIVER_PROTOCOL_VERSION.to_string(),
            download_url: "https://drivers.example.com/warehouse-1.0.0.tar.gz".to_string(),
            archive_sha256: Some("a".repeat(64)),
            supported_targets: vec!["darwin-arm64".to_string(), "linux-x86_64".to_string()],
            server_version_range: Some(">= 1 < 3".to_string()),
            release_notes_url: None,
            connection_url_template: Some("jdbc:warehouse://{host}:{port}/{database}".to_string()),
            capabilities: Some(capabilities.clone()),
            schema_migration: None,
            conformance: Some(DriverPackageConformance {
                evidence: vec![DriverPackageConformanceEvidence {
                    schema_version: 1,
                    runner_version: "1.0.0".to_string(),
                    driver_id: "warehouse".to_string(),
                    package_version: "1.0.0".to_string(),
                    entrypoint_sha256: "a".repeat(64),
                    target: "darwin-arm64".to_string(),
                    server_version: "1.0".to_string(),
                    fixture_id: "warehouse-core-v1".to_string(),
                    fixture_sha256: "b".repeat(64),
                    report_url: "https://drivers.example.com/evidence/warehouse-1.0.json"
                        .to_string(),
                    report_sha256: "c".repeat(64),
                    operations: vec!["connect".to_string()],
                }],
                ..DriverPackageConformance::default()
            }),
        };
        let manifest = DriverPackageManifest {
            schema_version: DRIVER_PACKAGE_SCHEMA_VERSION,
            package_id: "oxide.warehouse".to_string(),
            package_version: "1.0.0".to_string(),
            protocol_version: DRIVER_PROTOCOL_VERSION.to_string(),
            driver_id: "warehouse".to_string(),
            display_name: "Warehouse".to_string(),
            client_library: "warehouse-jdbc".to_string(),
            client_version: "1.0".to_string(),
            entrypoint: "driver".to_string(),
            sha256: "a".repeat(64),
            runtime: DriverPackageRuntime::Native,
            supported_targets: vec!["linux-x86_64".to_string(), "darwin-arm64".to_string()],
            server_version_range: Some(">= 1 < 3".to_string()),
            connection_url_template: Some("jdbc:warehouse://{host}:{port}/{database}".to_string()),
            capabilities: Some(capabilities),
            schema_migration: None,
        };
        assert!(validate_catalog_manifest_binding(&entry, &manifest).is_ok());

        let mut protocol_mismatch = manifest.clone();
        protocol_mismatch.protocol_version = "0.9".to_string();
        assert!(
            validate_catalog_manifest_binding(&entry, &protocol_mismatch)
                .unwrap_err()
                .contains("protocol")
        );

        let mut evidence_mismatch = manifest.clone();
        evidence_mismatch.sha256 = "d".repeat(64);
        assert!(
            validate_catalog_manifest_binding(&entry, &evidence_mismatch)
                .unwrap_err()
                .contains("conformance evidence")
        );

        let mut capability_mismatch = manifest;
        capability_mismatch
            .capabilities
            .as_mut()
            .expect("capabilities")
            .supports_sql_query = false;
        assert!(
            validate_catalog_manifest_binding(&entry, &capability_mismatch)
                .unwrap_err()
                .contains("capabilities")
        );
    }

    #[test]
    fn server_version_ranges_are_explicit_and_enforced_after_connect() {
        assert!(validate_server_version_range(Some(">= 6 < 9")).is_ok());
        assert!(validate_server_version_range(Some("6 - 9")).is_err());
        assert!(validate_server_version_compatibility(
            Some(">= 6 < 9"),
            Some("Elasticsearch 8.15.2 (default distribution)")
        )
        .is_ok());
        assert!(
            validate_server_version_compatibility(Some(">= 6 < 9"), Some("9.0.0"))
                .unwrap_err()
                .contains("outside")
        );
        assert!(
            validate_server_version_compatibility(Some(">= 6 < 9"), Some("unknown"))
                .unwrap_err()
                .contains("could not determine")
        );
    }

    #[test]
    fn catalog_signature_location_tracks_the_catalog_document() {
        let catalog = validated_catalog_url(
            "https://drivers.example.com/releases/catalog.json",
            "Driver catalog URL",
        )
        .unwrap();
        assert_eq!(
            catalog_signature_url(&catalog).unwrap().as_str(),
            "https://drivers.example.com/releases/catalog.json.minisig"
        );
        assert!(validated_catalog_url(
            "https://user:password@drivers.example.com/catalog.json",
            "Driver catalog URL",
        )
        .is_err());
    }

    fn write_package(root: &Path, protocol: &str, digest: Option<&str>) {
        let package_root = root.join("clickhouse").join("1.2.3");
        fs::create_dir_all(&package_root).unwrap();
        fs::write(package_root.join("driver"), b"driver-sidecar").unwrap();
        let actual_digest = format!("{:x}", Sha256::digest(b"driver-sidecar"));
        let manifest = serde_json::json!({
            "schemaVersion": 1,
            "packageId": "oxide.clickhouse",
            "packageVersion": "1.2.3",
            "protocolVersion": protocol,
            "driverId": "clickhouse",
            "displayName": "ClickHouse",
            "clientLibrary": "clickhouse-rs",
            "clientVersion": "0.13.0",
            "entrypoint": "driver",
            "sha256": digest.unwrap_or(&actual_digest),
            "supportedTargets": [current_target()],
            "serverVersionRange": ">=22"
        });
        fs::write(
            package_root.join("manifest.json"),
            serde_json::to_vec_pretty(&manifest).unwrap(),
        )
        .unwrap();
        fs::write(root.join("clickhouse").join("current"), "1.2.3\n").unwrap();
    }

    #[test]
    fn discovers_verified_active_package() {
        let directory = tempfile::tempdir().unwrap();
        write_package(directory.path(), DRIVER_PROTOCOL_VERSION, None);
        let packages =
            DatabaseDriverPackageRegistry::allow_unsigned_for_tests(directory.path().to_path_buf())
                .list_installed();
        assert_eq!(packages.len(), 1);
        assert!(packages[0].active);
        assert_eq!(packages[0].status, DriverPackageStatus::Ready);
    }

    #[test]
    fn legacy_capability_contract_defaults_new_opt_in_flags_to_false() {
        let mut capabilities = serde_json::to_value(
            crate::core::dialect::database_capabilities_for_driver("postgres").unwrap(),
        )
        .unwrap();
        let contract = capabilities
            .as_object_mut()
            .expect("capability contract should be an object");
        contract.remove("supportsTableRowMutation");
        contract.remove("supportsTableDdl");
        contract.remove("supportsCreateDatabaseOwner");
        contract.remove("supportsCreateDatabaseCollation");

        let manifest: DriverPackageManifest = serde_json::from_value(serde_json::json!({
            "schemaVersion": 1,
            "packageId": "oxide.clickhouse",
            "packageVersion": "1.2.3",
            "protocolVersion": DRIVER_PROTOCOL_VERSION,
            "driverId": "clickhouse",
            "displayName": "ClickHouse",
            "clientLibrary": "clickhouse-rs",
            "clientVersion": "0.13.0",
            "entrypoint": "driver",
            "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "capabilities": capabilities,
        }))
        .unwrap();

        let capabilities = manifest.capabilities.expect("capabilities should decode");
        assert!(!capabilities.supports_table_row_mutation);
        assert!(!capabilities.supports_table_ddl);
        assert!(!capabilities.supports_create_database_owner);
        assert!(!capabilities.supports_create_database_collation);
        assert_eq!(
            capabilities.connection_mode,
            crate::core::dialect::DatabaseConnectionMode::Network,
            "legacy external manifests must safely retain the network default"
        );
    }

    #[test]
    fn unsigned_package_is_visible_but_cannot_be_resolved_for_execution() {
        let directory = tempfile::tempdir().unwrap();
        write_package(directory.path(), DRIVER_PROTOCOL_VERSION, None);
        let registry =
            DatabaseDriverPackageRegistry::require_signature_for_tests(directory.path().into());

        let packages = registry.list_installed();
        assert_eq!(packages.len(), 1);
        assert_eq!(packages[0].status, DriverPackageStatus::Untrusted);
        assert!(packages[0]
            .status_message
            .as_deref()
            .unwrap_or_default()
            .contains("signing key"));
        assert!(registry.resolve_active("clickhouse").is_err());
    }

    #[test]
    fn offline_install_activates_atomically_and_rolls_back_to_previous_version() {
        let source = tempfile::tempdir().unwrap();
        let registry_root = tempfile::tempdir().unwrap();
        write_package(source.path(), DRIVER_PROTOCOL_VERSION, None);
        let source_package = source.path().join("clickhouse").join("1.2.3");
        let registry = DatabaseDriverPackageRegistry::allow_unsigned_for_tests(
            registry_root.path().to_path_buf(),
        );

        let installed = registry
            .install_from_directory(&source_package, true)
            .unwrap();
        assert_eq!(installed.manifest.package_version, "1.2.3");
        assert!(installed.active);

        let manifest_path = source_package.join("manifest.json");
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
        manifest["packageVersion"] = serde_json::Value::String("1.2.4".to_string());
        fs::write(
            &manifest_path,
            serde_json::to_vec_pretty(&manifest).unwrap(),
        )
        .unwrap();
        registry
            .install_from_directory(&source_package, true)
            .unwrap();
        assert_eq!(
            registry.activation_state("clickhouse"),
            Some(DriverActivationState {
                current: "1.2.4".to_string(),
                previous: Some("1.2.3".to_string()),
            })
        );

        let state = registry.rollback_package("clickhouse").unwrap();
        assert_eq!(state.current, "1.2.3");
        assert_eq!(state.previous.as_deref(), Some("1.2.4"));
        assert_eq!(
            registry
                .resolve_active("clickhouse")
                .unwrap()
                .manifest
                .package_version,
            "1.2.3"
        );
    }

    #[test]
    fn offline_install_never_overwrites_an_existing_version() {
        let source = tempfile::tempdir().unwrap();
        let registry_root = tempfile::tempdir().unwrap();
        write_package(source.path(), DRIVER_PROTOCOL_VERSION, None);
        let source_package = source.path().join("clickhouse").join("1.2.3");
        let registry = DatabaseDriverPackageRegistry::allow_unsigned_for_tests(
            registry_root.path().to_path_buf(),
        );

        registry
            .install_from_directory(&source_package, false)
            .unwrap();
        let error = registry
            .install_from_directory(&source_package, false)
            .unwrap_err();
        assert!(error.contains("already installed"));
    }

    #[test]
    fn catalog_install_path_persists_host_owned_receipt() {
        let source = tempfile::tempdir().unwrap();
        let registry_root = tempfile::tempdir().unwrap();
        write_package(source.path(), DRIVER_PROTOCOL_VERSION, None);
        let source_package = source.path().join("clickhouse").join("1.2.3");
        let entry = DriverPackageCatalogEntry {
            driver_id: "clickhouse".to_string(),
            display_name: "ClickHouse".to_string(),
            package_version: "1.2.3".to_string(),
            protocol_version: DRIVER_PROTOCOL_VERSION.to_string(),
            download_url: "https://drivers.example.com/clickhouse-1.2.3.tar.gz".to_string(),
            archive_sha256: Some("a".repeat(64)),
            supported_targets: vec![current_target()],
            server_version_range: Some(">=22".to_string()),
            release_notes_url: None,
            connection_url_template: None,
            capabilities: None,
            schema_migration: None,
            conformance: None,
        };
        let registry = DatabaseDriverPackageRegistry::allow_unsigned_for_tests(
            registry_root.path().to_path_buf(),
        );

        let installed = registry
            .install_from_directory_with_catalog_entry(&source_package, false, Some(&entry))
            .unwrap();

        assert_eq!(installed.catalog_entry, Some(entry));
        assert!(installed
            .package_root
            .join(DRIVER_PACKAGE_CATALOG_RECEIPT)
            .is_file());
    }

    #[test]
    fn offline_install_rejects_forged_catalog_receipt_from_package() {
        let source = tempfile::tempdir().unwrap();
        let registry_root = tempfile::tempdir().unwrap();
        write_package(source.path(), DRIVER_PROTOCOL_VERSION, None);
        let source_package = source.path().join("clickhouse").join("1.2.3");
        fs::write(
            source_package.join(DRIVER_PACKAGE_CATALOG_RECEIPT),
            b"untrusted package-owned receipt",
        )
        .unwrap();
        let registry = DatabaseDriverPackageRegistry::allow_unsigned_for_tests(
            registry_root.path().to_path_buf(),
        );

        let error = registry
            .install_from_directory(&source_package, false)
            .unwrap_err();

        assert!(error.contains("reserved Host metadata"));
        assert!(registry.list_installed().is_empty());
    }

    #[test]
    fn migration_evidence_requires_exact_server_and_platform() {
        let directory = tempfile::tempdir().unwrap();
        write_package(directory.path(), DRIVER_PROTOCOL_VERSION, None);
        let mut package =
            DatabaseDriverPackageRegistry::allow_unsigned_for_tests(directory.path().to_path_buf())
                .resolve_active("clickhouse")
                .unwrap();
        package.manifest.schema_migration = Some(DriverPackageSchemaMigrationContract {
            snapshot_version: 1,
            mode: SchemaMigrationMode::Transactional,
        });
        let evidence = DriverPackageConformanceEvidence {
            schema_version: 1,
            runner_version: "1.1.0".to_string(),
            driver_id: package.manifest.driver_id.clone(),
            package_version: package.manifest.package_version.clone(),
            entrypoint_sha256: package.manifest.sha256.clone(),
            target: current_target(),
            server_version: "24.3.1".to_string(),
            fixture_id: "clickhouse-migration-v1".to_string(),
            fixture_sha256: "b".repeat(64),
            report_url: "https://drivers.example.com/evidence/clickhouse-24.3.1.json".to_string(),
            report_sha256: "c".repeat(64),
            operations: vec!["connect".to_string(), "migration".to_string()],
        };
        package.catalog_entry = Some(DriverPackageCatalogEntry {
            driver_id: package.manifest.driver_id.clone(),
            display_name: package.manifest.display_name.clone(),
            package_version: package.manifest.package_version.clone(),
            protocol_version: package.manifest.protocol_version.clone(),
            download_url: "https://drivers.example.com/clickhouse.tar.gz".to_string(),
            archive_sha256: Some("a".repeat(64)),
            supported_targets: package.manifest.supported_targets.clone(),
            server_version_range: package.manifest.server_version_range.clone(),
            release_notes_url: None,
            connection_url_template: None,
            capabilities: None,
            schema_migration: package.manifest.schema_migration.clone(),
            conformance: Some(DriverPackageConformance {
                connect: vec!["24.3.1".to_string()],
                migration: vec!["24.3.1".to_string()],
                evidence: vec![evidence],
                ..DriverPackageConformance::default()
            }),
        });

        assert!(package.has_exact_migration_evidence("24.3.1"));
        assert!(!package.has_exact_migration_evidence("24.3.2"));
        package
            .catalog_entry
            .as_mut()
            .unwrap()
            .conformance
            .as_mut()
            .unwrap()
            .evidence[0]
            .target = "*".to_string();
        assert!(!package.has_exact_migration_evidence("24.3.1"));
    }

    #[cfg(unix)]
    #[test]
    fn offline_install_rejects_symlinks_anywhere_in_the_package() {
        use std::os::unix::fs::symlink;

        let source = tempfile::tempdir().unwrap();
        let registry_root = tempfile::tempdir().unwrap();
        write_package(source.path(), DRIVER_PROTOCOL_VERSION, None);
        let source_package = source.path().join("clickhouse").join("1.2.3");
        symlink(
            source_package.join("driver"),
            source_package.join("driver-link"),
        )
        .unwrap();
        let registry = DatabaseDriverPackageRegistry::allow_unsigned_for_tests(
            registry_root.path().to_path_buf(),
        );

        let error = registry
            .install_from_directory(&source_package, false)
            .unwrap_err();
        assert!(error.contains("symbolic links"));
        assert!(registry.list_installed().is_empty());
    }

    #[test]
    fn rejects_digest_mismatch_without_executing_package() {
        let directory = tempfile::tempdir().unwrap();
        write_package(
            directory.path(),
            DRIVER_PROTOCOL_VERSION,
            Some(&"0".repeat(64)),
        );
        let packages =
            DatabaseDriverPackageRegistry::allow_unsigned_for_tests(directory.path().to_path_buf())
                .list_installed();
        assert_eq!(packages[0].status, DriverPackageStatus::Invalid);
        assert!(packages[0]
            .status_message
            .as_deref()
            .unwrap_or_default()
            .contains("digest"));
    }

    #[test]
    fn reports_protocol_major_mismatch_as_incompatible() {
        let directory = tempfile::tempdir().unwrap();
        write_package(directory.path(), "2.0", None);
        let packages =
            DatabaseDriverPackageRegistry::allow_unsigned_for_tests(directory.path().to_path_buf())
                .list_installed();
        assert_eq!(packages[0].status, DriverPackageStatus::Incompatible);
    }

    #[test]
    fn rejects_entrypoint_path_escape() {
        let manifest = DriverPackageManifest {
            schema_version: 1,
            package_id: "oxide.test".to_string(),
            package_version: "1.0.0".to_string(),
            protocol_version: "1.0".to_string(),
            driver_id: "test".to_string(),
            display_name: "Test".to_string(),
            client_library: "test".to_string(),
            client_version: "1".to_string(),
            entrypoint: "../outside".to_string(),
            sha256: "0".repeat(64),
            runtime: DriverPackageRuntime::Native,
            supported_targets: Vec::new(),
            server_version_range: None,
            connection_url_template: None,
            capabilities: None,
            schema_migration: None,
        };
        assert!(validate_manifest(&manifest, Path::new("/tmp/package")).is_err());
    }

    #[test]
    fn java_runtime_requires_a_signed_in_package_classpath() {
        let directory = tempfile::tempdir().unwrap();
        let package = directory.path().join("package");
        fs::create_dir_all(package.join("lib")).unwrap();
        fs::write(package.join("agent.jar"), b"agent").unwrap();
        fs::write(package.join("lib/vendor.jar"), b"vendor-driver").unwrap();
        let runtime = DriverPackageRuntime::Java(DriverPackageJavaRuntime {
            java_major: 21,
            main_class: "studio.oxide.jdbc.DriverMain".to_string(),
            classpath: vec![DriverPackageClasspathEntry {
                path: "lib/vendor.jar".to_string(),
                sha256: format!("{:x}", Sha256::digest(b"vendor-driver")),
            }],
        });
        let manifest = DriverPackageManifest {
            schema_version: DRIVER_PACKAGE_SCHEMA_VERSION,
            package_id: "oxide.jdbc-fixture".to_string(),
            package_version: "1.0.0".to_string(),
            protocol_version: DRIVER_PROTOCOL_VERSION.to_string(),
            driver_id: "jdbc-fixture".to_string(),
            display_name: "JDBC fixture".to_string(),
            client_library: "vendor-jdbc".to_string(),
            client_version: "1.0".to_string(),
            entrypoint: "agent.jar".to_string(),
            sha256: format!("{:x}", Sha256::digest(b"agent")),
            runtime: runtime.clone(),
            supported_targets: Vec::new(),
            server_version_range: None,
            connection_url_template: None,
            capabilities: None,
            schema_migration: None,
        };
        assert!(validate_manifest(&manifest, &package).is_ok());
        assert!(verify_runtime_dependencies(&package, &runtime).is_ok());

        fs::write(package.join("lib/vendor.jar"), b"tampered").unwrap();
        assert!(verify_runtime_dependencies(&package, &runtime)
            .unwrap_err()
            .contains("digest"));

        let mut unsupported = manifest;
        unsupported.runtime = DriverPackageRuntime::Java(DriverPackageJavaRuntime {
            java_major: 17,
            main_class: "studio.oxide.jdbc.DriverMain".to_string(),
            classpath: Vec::new(),
        });
        assert!(validate_manifest(&unsupported, &package)
            .unwrap_err()
            .contains("Java 21"));
    }

    #[test]
    fn resolves_only_a_ready_active_package() {
        let directory = tempfile::tempdir().unwrap();
        write_package(directory.path(), DRIVER_PROTOCOL_VERSION, None);
        let registry =
            DatabaseDriverPackageRegistry::allow_unsigned_for_tests(directory.path().to_path_buf());
        let package = registry.resolve_active("clickhouse").unwrap();
        assert_eq!(package.manifest.package_version, "1.2.3");

        write_package(
            directory.path(),
            DRIVER_PROTOCOL_VERSION,
            Some(&"0".repeat(64)),
        );
        assert!(registry.resolve_active("clickhouse").is_err());
    }

    #[test]
    fn handshake_must_match_the_verified_manifest() {
        let directory = tempfile::tempdir().unwrap();
        write_package(directory.path(), DRIVER_PROTOCOL_VERSION, None);
        let package =
            DatabaseDriverPackageRegistry::allow_unsigned_for_tests(directory.path().to_path_buf())
                .resolve_active("clickhouse")
                .unwrap();
        let mut response = HandshakeResponse {
            protocol_version: DRIVER_PROTOCOL_VERSION.to_string(),
            package_id: package.manifest.package_id.clone(),
            package_version: package.manifest.package_version.clone(),
            driver_id: package.manifest.driver_id.clone(),
            capabilities: DriverRuntimeCapabilities {
                query: true,
                ..DriverRuntimeCapabilities::default()
            },
        };
        assert!(validate_handshake(&package.manifest, &response).is_ok());

        response.package_version = "9.9.9".to_string();
        assert!(validate_handshake(&package.manifest, &response).is_err());
    }

    #[test]
    fn handshake_cannot_downgrade_signed_runtime_capabilities() {
        let directory = tempfile::tempdir().unwrap();
        write_package(directory.path(), DRIVER_PROTOCOL_VERSION, None);
        let mut package =
            DatabaseDriverPackageRegistry::allow_unsigned_for_tests(directory.path().to_path_buf())
                .resolve_active("clickhouse")
                .unwrap();
        package.manifest.capabilities = Some(
            serde_json::from_value(serde_json::json!({
                "driver": "clickhouse",
                "displayName": "ClickHouse",
                "dataModel": "relational",
                "lspLanguageId": "sql",
                "namespaceLabel": "database",
                "identifierQuote": "`",
                "defaultPort": 8123,
                "supportsSqlQuery": true,
                "supportsTableBrowsing": true,
                "supportsCollectionBrowsing": false,
                "supportsKeyValueBrowsing": false,
                "supportsSchemas": true,
                "supportsCreateDatabase": false,
                "supportsCreateDatabaseCharset": false,
                "supportsColumnComments": false,
                "supportsInlineColumnComments": false,
                "supportsRenameDatabase": false,
                "supportsViews": true,
                "supportsReplaceView": false,
                "supportsMaterializedViews": true,
                "supportsTableIndexes": false,
                "supportsTableConstraints": false,
                "supportsForeignKeys": false,
                "supportsCheckConstraints": false,
                "supportsFunctions": false,
                "supportsTransactions": true,
                "supportsQueryCancellation": true,
                "supportsExplainPlan": true,
                "autoIncrementKeyword": null,
                "defaultPrimaryKeyType": "UInt64",
                "commonDataTypes": ["UInt64", "String"]
            }))
            .unwrap(),
        );
        let mut response = HandshakeResponse {
            protocol_version: DRIVER_PROTOCOL_VERSION.to_string(),
            package_id: package.manifest.package_id.clone(),
            package_version: package.manifest.package_version.clone(),
            driver_id: package.manifest.driver_id.clone(),
            capabilities: DriverRuntimeCapabilities {
                query: true,
                ..DriverRuntimeCapabilities::default()
            },
        };
        assert!(validate_handshake(&package.manifest, &response)
            .unwrap_err()
            .contains("Explorer metadata"));

        {
            let capabilities = package.manifest.capabilities.as_mut().unwrap();
            capabilities.supports_table_browsing = false;
            capabilities.supports_schemas = false;
            capabilities.supports_transactions = false;
            capabilities.supports_query_cancellation = false;
            capabilities.supports_foreign_keys = true;
        }
        assert!(validate_handshake(&package.manifest, &response)
            .unwrap_err()
            .contains("foreign-key navigation"));

        response.capabilities.referencing_foreign_keys = true;
        package
            .manifest
            .capabilities
            .as_mut()
            .unwrap()
            .supports_create_database = true;
        assert!(validate_handshake(&package.manifest, &response)
            .unwrap_err()
            .contains("database creation"));
    }

    #[test]
    fn table_row_mutation_requires_transactions_in_both_contracts() {
        let mut capabilities = crate::core::dialect::database_capabilities_for_driver("postgres")
            .expect("postgres capability fixture should exist");
        capabilities.driver = "clickhouse".to_string();
        capabilities.supports_transactions = false;

        assert!(validate_capability_contract("clickhouse", &capabilities)
            .unwrap_err()
            .contains("Table row mutation requires"));

        capabilities.supports_transactions = true;
        let manifest = DriverPackageManifest {
            schema_version: DRIVER_PACKAGE_SCHEMA_VERSION,
            package_id: "oxide.clickhouse".to_string(),
            package_version: "1.2.3".to_string(),
            protocol_version: DRIVER_PROTOCOL_VERSION.to_string(),
            driver_id: "clickhouse".to_string(),
            display_name: "ClickHouse".to_string(),
            client_library: "clickhouse-rs".to_string(),
            client_version: "0.13.0".to_string(),
            entrypoint: "driver".to_string(),
            sha256: "a".repeat(64),
            runtime: DriverPackageRuntime::Native,
            supported_targets: Vec::new(),
            server_version_range: None,
            connection_url_template: None,
            capabilities: Some(capabilities),
            schema_migration: None,
        };
        let response = HandshakeResponse {
            protocol_version: DRIVER_PROTOCOL_VERSION.to_string(),
            package_id: manifest.package_id.clone(),
            package_version: manifest.package_version.clone(),
            driver_id: manifest.driver_id.clone(),
            capabilities: DriverRuntimeCapabilities {
                query: true,
                metadata: true,
                ..DriverRuntimeCapabilities::default()
            },
        };
        assert!(validate_handshake(&manifest, &response)
            .unwrap_err()
            .contains("table row mutation"));
    }

    #[test]
    fn semantic_migration_requires_signed_runtime_and_evidence_contracts() {
        let mut capabilities = crate::core::dialect::database_capabilities_for_driver("postgres")
            .expect("postgres capability fixture should exist");
        capabilities.driver = "warehouse".to_string();
        let contract = DriverPackageSchemaMigrationContract {
            snapshot_version: 1,
            mode: SchemaMigrationMode::Transactional,
        };
        assert!(validate_schema_migration_contract(Some(&capabilities), Some(&contract)).is_ok());

        let conformance = DriverPackageConformance {
            connect: vec!["1.0".to_string()],
            migration: vec!["1.0".to_string()],
            ..DriverPackageConformance::default()
        };
        assert!(
            validate_conformance_capability_contract(Some(&capabilities), None, &conformance,)
                .unwrap_err()
                .contains("semantic schema-migration contract")
        );
        assert!(validate_conformance_capability_contract(
            Some(&capabilities),
            Some(&contract),
            &conformance,
        )
        .is_ok());

        let manifest = DriverPackageManifest {
            schema_version: DRIVER_PACKAGE_SCHEMA_VERSION,
            package_id: "oxide.warehouse".to_string(),
            package_version: "1.0.0".to_string(),
            protocol_version: DRIVER_PROTOCOL_VERSION.to_string(),
            driver_id: "warehouse".to_string(),
            display_name: "Warehouse".to_string(),
            client_library: "warehouse-client".to_string(),
            client_version: "1.0".to_string(),
            entrypoint: "driver".to_string(),
            sha256: "a".repeat(64),
            runtime: DriverPackageRuntime::Native,
            supported_targets: Vec::new(),
            server_version_range: None,
            connection_url_template: None,
            capabilities: Some(capabilities),
            schema_migration: Some(contract),
        };
        let mut response = HandshakeResponse {
            protocol_version: DRIVER_PROTOCOL_VERSION.to_string(),
            package_id: manifest.package_id.clone(),
            package_version: manifest.package_version.clone(),
            driver_id: manifest.driver_id.clone(),
            capabilities: DriverRuntimeCapabilities {
                query: true,
                metadata: true,
                cancellation: true,
                transactions: true,
                database_creation: true,
                referencing_foreign_keys: true,
                ..DriverRuntimeCapabilities::default()
            },
        };
        assert!(validate_handshake(&manifest, &response)
            .unwrap_err()
            .contains("semantic schema migration"));
        response.capabilities.semantic_schema_migration = true;
        assert!(validate_handshake(&manifest, &response).is_ok());
    }

    #[test]
    fn table_data_transfer_requires_an_explicit_reviewed_contract() {
        let mut capabilities = crate::core::dialect::database_capabilities_for_driver("postgres")
            .expect("postgres capability fixture should exist");
        capabilities.driver = "warehouse".to_string();
        capabilities.supports_table_data_transfer = true;
        capabilities.table_export_formats.clear();
        capabilities.supports_table_browsing = false;
        assert!(validate_capability_contract("warehouse", &capabilities)
            .unwrap_err()
            .contains("Table data transfer requires table browsing and transactions"));

        capabilities.supports_table_browsing = true;
        capabilities.supports_transactions = true;
        capabilities.lsp_language_id = "sql".to_string();
        capabilities.table_export_formats.clear();
        assert!(validate_capability_contract("warehouse", &capabilities)
            .unwrap_err()
            .contains("reviewed postgres, mysql, sqlite, or duckdb dialect"));

        capabilities.lsp_language_id = "postgres".to_string();
        assert!(validate_capability_contract("warehouse", &capabilities).is_ok());
    }

    #[test]
    fn generic_sql_capabilities_may_select_only_a_reviewed_lsp_server_dialect() {
        let mut capabilities = crate::core::dialect::database_capabilities_for_driver("postgres")
            .expect("postgres capability fixture should exist");
        capabilities.driver = "doris".to_string();
        capabilities.lsp_language_id = "sql".to_string();
        capabilities.lsp_server_dialect = Some("mysql".to_string());
        // This test exercises LSP routing only. Cross-connection transfer is
        // intentionally stricter and requires a dedicated document dialect.
        capabilities.supports_table_data_transfer = false;
        capabilities.table_export_formats.clear();
        assert!(validate_capability_contract("doris", &capabilities).is_ok());

        capabilities.lsp_server_dialect = Some("doris".to_string());
        assert!(validate_capability_contract("doris", &capabilities).is_ok());

        capabilities.lsp_server_dialect = Some("vendor-private".to_string());
        assert!(validate_capability_contract("doris", &capabilities)
            .unwrap_err()
            .contains("not supported"));

        capabilities.lsp_server_dialect = Some("  ".to_string());
        assert!(validate_capability_contract("doris", &capabilities)
            .unwrap_err()
            .contains("must not be empty"));

        capabilities.lsp_server_dialect = Some("mysql".to_string());
        capabilities.lsp_language_id = "postgres".to_string();
        assert!(validate_capability_contract("doris", &capabilities)
            .unwrap_err()
            .contains("must match its document language"));
    }

    #[test]
    fn capability_identifier_quote_is_limited_to_host_supported_delimiters() {
        let mut capabilities = crate::core::dialect::database_capabilities_for_driver("postgres")
            .expect("postgres capability fixture should exist");
        capabilities.driver = "sqlserver".to_string();
        capabilities.identifier_quote = "[".to_string();
        assert!(validate_capability_contract("sqlserver", &capabilities).is_ok());

        capabilities.identifier_quote = "] ; DROP TABLE users; --".to_string();
        assert!(validate_capability_contract("sqlserver", &capabilities)
            .unwrap_err()
            .contains("identifier quote is not supported"));
    }

    #[test]
    fn non_relational_packages_cannot_claim_the_relational_table_editor() {
        let mut capabilities = crate::core::dialect::database_capabilities_for_driver("postgres")
            .expect("postgres capability fixture should exist");
        capabilities.driver = "neo4j".to_string();
        capabilities.data_model = crate::core::dialect::DatabaseDataModel::Graph;
        capabilities.table_export_formats.clear();

        assert!(validate_capability_contract("neo4j", &capabilities)
            .unwrap_err()
            .contains("relational Table Editor"));

        capabilities.supports_table_browsing = false;
        capabilities.supports_table_row_mutation = false;
        capabilities.supports_table_data_transfer = false;
        capabilities.supports_table_ddl = false;
        capabilities.supports_column_alteration = false;
        capabilities.supports_index_rename = false;
        capabilities.supports_constraint_alteration = false;
        capabilities.table_export_formats.clear();
        assert!(validate_capability_contract("neo4j", &capabilities).is_ok());
    }

    #[test]
    fn table_export_formats_require_a_reviewed_unique_contract() {
        let mut capabilities = crate::core::dialect::database_capabilities_for_driver("postgres")
            .expect("postgres capability fixture should exist");
        capabilities.driver = "warehouse".to_string();
        capabilities.table_export_formats = vec!["parquet".to_string(), "arrow".to_string()];
        assert!(validate_capability_contract("warehouse", &capabilities).is_ok());

        capabilities.table_export_formats = vec!["csv".to_string(), "csv".to_string()];
        assert!(validate_capability_contract("warehouse", &capabilities)
            .unwrap_err()
            .contains("duplicate"));

        capabilities.table_export_formats = vec!["vendor-binary".to_string()];
        assert!(validate_capability_contract("warehouse", &capabilities)
            .unwrap_err()
            .contains("unsupported"));

        capabilities.table_export_formats = vec!["csv".to_string()];
        capabilities.lsp_language_id = "sql".to_string();
        assert!(validate_capability_contract("warehouse", &capabilities)
            .unwrap_err()
            .contains("reviewed postgres, mysql, sqlite, or duckdb paging dialect"));
    }

    #[test]
    fn rejects_manifest_identity_that_does_not_match_installation_path() {
        let directory = tempfile::tempdir().unwrap();
        write_package(directory.path(), DRIVER_PROTOCOL_VERSION, None);
        let manifest_path = directory
            .path()
            .join("clickhouse")
            .join("1.2.3")
            .join("manifest.json");
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
        manifest["driverId"] = serde_json::Value::String("postgres".to_string());
        fs::write(
            &manifest_path,
            serde_json::to_vec_pretty(&manifest).unwrap(),
        )
        .unwrap();

        let packages =
            DatabaseDriverPackageRegistry::allow_unsigned_for_tests(directory.path().to_path_buf())
                .list_installed();
        assert_eq!(packages[0].status, DriverPackageStatus::Invalid);
        assert!(packages[0]
            .status_message
            .as_deref()
            .unwrap_or_default()
            .contains("installation directory"));
    }

    #[test]
    fn rejects_capability_contract_for_another_driver() {
        let directory = tempfile::tempdir().unwrap();
        write_package(directory.path(), DRIVER_PROTOCOL_VERSION, None);
        let manifest_path = directory
            .path()
            .join("clickhouse")
            .join("1.2.3")
            .join("manifest.json");
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
        manifest["capabilities"] = serde_json::json!({
            "driver": "postgres",
            "displayName": "Incorrect",
            "dataModel": "relational",
            "lspLanguageId": "sql",
            "namespaceLabel": "schema",
            "identifierQuote": "\"",
            "defaultPort": 5432,
            "supportsSqlQuery": true,
            "supportsTableBrowsing": true,
            "supportsCollectionBrowsing": false,
            "supportsKeyValueBrowsing": false,
            "supportsSchemas": true,
            "supportsCreateDatabase": false,
            "supportsCreateDatabaseCharset": false,
            "supportsColumnComments": false,
            "supportsInlineColumnComments": false,
            "supportsRenameDatabase": false,
            "supportsViews": true,
            "supportsReplaceView": false,
            "supportsMaterializedViews": false,
            "supportsTableIndexes": false,
            "supportsTableConstraints": false,
            "supportsForeignKeys": false,
            "supportsCheckConstraints": false,
            "supportsFunctions": false,
            "supportsTransactions": false,
            "supportsQueryCancellation": false,
            "supportsExplainPlan": false,
            "autoIncrementKeyword": null,
            "defaultPrimaryKeyType": "INTEGER",
            "commonDataTypes": []
        });
        fs::write(
            &manifest_path,
            serde_json::to_vec_pretty(&manifest).unwrap(),
        )
        .unwrap();

        let packages =
            DatabaseDriverPackageRegistry::allow_unsigned_for_tests(directory.path().to_path_buf())
                .list_installed();
        assert_eq!(packages[0].status, DriverPackageStatus::Invalid);
        assert!(packages[0]
            .status_message
            .as_deref()
            .unwrap_or_default()
            .contains("capability contract"));
    }

    #[test]
    fn accepts_the_common_os_and_architecture_alias() {
        let directory = tempfile::tempdir().unwrap();
        write_package(directory.path(), DRIVER_PROTOCOL_VERSION, None);
        let manifest_path = directory
            .path()
            .join("clickhouse")
            .join("1.2.3")
            .join("manifest.json");
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
        manifest["supportedTargets"] =
            serde_json::json!([current_target_aliases().last().cloned().unwrap()]);
        fs::write(
            &manifest_path,
            serde_json::to_vec_pretty(&manifest).unwrap(),
        )
        .unwrap();

        let packages =
            DatabaseDriverPackageRegistry::allow_unsigned_for_tests(directory.path().to_path_buf())
                .list_installed();
        assert_eq!(packages[0].status, DriverPackageStatus::Ready);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_entrypoint_symlink_that_escapes_the_package() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().unwrap();
        write_package(directory.path(), DRIVER_PROTOCOL_VERSION, None);
        let package_root = directory.path().join("clickhouse").join("1.2.3");
        let outside = directory.path().join("outside-driver");
        fs::write(&outside, b"driver-sidecar").unwrap();
        fs::remove_file(package_root.join("driver")).unwrap();
        symlink(&outside, package_root.join("driver")).unwrap();

        let packages =
            DatabaseDriverPackageRegistry::allow_unsigned_for_tests(directory.path().to_path_buf())
                .list_installed();
        assert_eq!(packages[0].status, DriverPackageStatus::Invalid);
        assert!(packages[0]
            .status_message
            .as_deref()
            .unwrap_or_default()
            .contains("outside its package"));
    }

    #[test]
    fn managed_java_runtime_is_activated_and_revalidated_before_launch() {
        let directory = tempfile::tempdir().unwrap();
        let source = tempfile::tempdir().unwrap();
        let source_bin = source.path().join("bin");
        fs::create_dir_all(&source_bin).unwrap();
        let java = source_bin.join(if cfg!(windows) { "java.exe" } else { "java" });
        fs::write(&java, b"managed-java-fixture").unwrap();
        let runtime_manifest = ManagedJavaRuntimeManifest {
            schema_version: DRIVER_PACKAGE_SCHEMA_VERSION,
            runtime_kind: MANAGED_JAVA_RUNTIME_KIND.to_string(),
            java_major: 21,
            runtime_version: "21.0.3-fixture".to_string(),
            entrypoint: format!("bin/{}", java.file_name().unwrap().to_string_lossy()),
            sha256: format!("{:x}", Sha256::digest(b"managed-java-fixture")),
            supported_targets: vec![current_target()],
        };
        fs::write(
            source.path().join(MANAGED_JAVA_RUNTIME_MANIFEST),
            serde_json::to_vec_pretty(&runtime_manifest).unwrap(),
        )
        .unwrap();

        let package_root = directory.path().join("jdbc-test").join("1.0.0");
        fs::create_dir_all(&package_root).unwrap();
        fs::write(package_root.join("agent.jar"), b"agent").unwrap();
        let package = InstalledDriverPackage {
            manifest: DriverPackageManifest {
                schema_version: DRIVER_PACKAGE_SCHEMA_VERSION,
                package_id: "oxide.jdbc-test".to_string(),
                package_version: "1.0.0".to_string(),
                protocol_version: DRIVER_PROTOCOL_VERSION.to_string(),
                driver_id: "jdbc-test".to_string(),
                display_name: "JDBC test".to_string(),
                client_library: "fixture".to_string(),
                client_version: "1".to_string(),
                entrypoint: "agent.jar".to_string(),
                sha256: format!("{:x}", Sha256::digest(b"agent")),
                runtime: DriverPackageRuntime::Java(DriverPackageJavaRuntime {
                    java_major: 21,
                    main_class: "studio.oxide.jdbc.DriverMain".to_string(),
                    classpath: Vec::new(),
                }),
                supported_targets: vec![current_target()],
                server_version_range: None,
                connection_url_template: None,
                capabilities: None,
                schema_migration: None,
            },
            entrypoint: package_root.join("agent.jar"),
            package_root,
            active: true,
            status: DriverPackageStatus::Ready,
            status_message: None,
            catalog_entry: None,
        };
        let registry =
            DatabaseDriverPackageRegistry::allow_unsigned_for_tests(directory.path().to_path_buf());
        let installation = registry
            .install_managed_java_runtime_from_directory(source.path(), true)
            .unwrap();
        assert!(installation.active);
        let resolved = registry
            .resolve_managed_java_runtime_binary(&package, 21)
            .unwrap();
        assert_eq!(fs::read(&resolved).unwrap(), b"managed-java-fixture");

        fs::write(&resolved, b"modified").unwrap();
        assert!(registry
            .resolve_managed_java_runtime_binary(&package, 21)
            .unwrap_err()
            .contains("digest does not match"));
    }

    #[test]
    fn store_migration_copies_without_replacing_the_running_registry() {
        let source = tempfile::tempdir().unwrap();
        let target_parent = tempfile::tempdir().unwrap();
        write_package(source.path(), DRIVER_PROTOCOL_VERSION, None);
        let registry =
            DatabaseDriverPackageRegistry::allow_unsigned_for_tests(source.path().to_path_buf());
        let target = target_parent.path().join("migrated-driver-store");

        registry.stage_store_migration(&target).unwrap();

        assert_eq!(registry.root(), source.path());
        assert!(target
            .join("clickhouse")
            .join("1.2.3")
            .join("manifest.json")
            .exists());
        assert_eq!(
            DatabaseDriverPackageRegistry::allow_unsigned_for_tests(target)
                .list_installed()
                .len(),
            1,
        );
    }
}
