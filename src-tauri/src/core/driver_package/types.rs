use crate::core::dialect::DatabaseCapabilities;
use minisign_verify::PublicKey;
use oxide_driver_protocol::SchemaMigrationMode;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::sync::Mutex as AsyncMutex;

pub const DRIVER_PACKAGE_SCHEMA_VERSION: u32 = 1;
pub const DRIVER_PACKAGE_CATALOG_SCHEMA_VERSION: u32 = 1;
pub(super) const MAX_DRIVER_MANIFEST_BYTES: u64 = 256 * 1024;
pub(super) const MAX_DRIVER_SIGNATURE_BYTES: u64 = 64 * 1024;
pub(super) const MAX_DRIVER_PACKAGE_FILES: usize = 4_096;
pub(super) const MAX_DRIVER_PACKAGE_BYTES: u64 = 512 * 1024 * 1024;
pub(super) const MAX_DRIVER_PACKAGE_DEPTH: usize = 32;
pub(super) const MAX_DRIVER_PACKAGE_ARCHIVE_BYTES: u64 = 512 * 1024 * 1024;
pub(super) const MAX_DRIVER_CATALOG_BYTES: u64 = 512 * 1024;
pub(super) const MAX_DRIVER_CATALOG_ENTRIES: usize = 256;
pub(super) const MAX_DRIVER_CATALOG_FIELD_LENGTH: usize = 512;
pub(super) const DRIVER_PACKAGE_CACHE_DIRECTORY: &str = "_catalog-cache";
pub(super) const DRIVER_DEPENDENCY_CACHE_DIRECTORY: &str = "_dependency-cache";
pub(super) const DRIVER_PACKAGE_CATALOG_RECEIPT: &str = ".oxide-catalog-receipt.json";
pub(super) const MANAGED_JAVA_RUNTIME_MANIFEST: &str = "runtime.json";
pub(super) const MANAGED_JAVA_RUNTIME_KIND: &str = "java";
pub(super) const MAX_DRIVER_DEPENDENCIES: usize = 64;
pub(super) const MAX_DRIVER_DEPENDENCY_BYTES: u64 = 128 * 1024 * 1024;
pub(super) const MAX_DRIVER_DEPENDENCIES_BYTES: u64 = 256 * 1024 * 1024;
pub(super) const MAVEN_REPOSITORY_HOST_ALLOWLIST: &[&str] =
    &["repo.maven.apache.org", "repo1.maven.org"];

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
    /// Optional Java dependency payloads resolved by the catalog publisher.
    /// Every item is immutable, license-declared, and must match a path/digest
    /// already signed into the package manifest's Java classpath.
    #[serde(default)]
    pub dependencies: Vec<DriverPackageCatalogDependency>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DriverPackageCatalogDependency {
    /// Fixed Maven GAV coordinate used for inventory and diagnostics only.
    pub coordinate: String,
    /// Destination inside the package staging directory, normally `lib/*.jar`.
    pub path: String,
    pub download_url: String,
    pub sha256: String,
    pub size_bytes: u64,
    /// Non-empty SPDX expression supplied by the signed catalog publisher.
    pub license_spdx: String,
    pub license_url: String,
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
pub(super) struct DriverPackageCatalogReceipt {
    pub(super) schema_version: u32,
    pub(super) entry: DriverPackageCatalogEntry,
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
    pub(super) root: PathBuf,
    pub(super) trust: DriverPackageTrust,
    pub(super) mutation_lock: Arc<Mutex<()>>,
    pub(super) download_lock: Arc<AsyncMutex<()>>,
}

#[derive(Debug, Clone)]
pub(super) enum DriverPackageTrust {
    PublicKey(PublicKey),
    Unavailable,
    InvalidKey(String),
    #[cfg(test)]
    AllowUnsigned,
}
