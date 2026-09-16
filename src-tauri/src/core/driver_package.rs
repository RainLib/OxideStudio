#[cfg(test)]
#[allow(unused_imports)]
use crate::core::dialect::{DatabaseCapabilities, DECLARED_TABLE_EXPORT_FORMATS};
#[cfg(test)]
#[allow(unused_imports)]
use flate2::read::GzDecoder;
#[cfg(test)]
#[allow(unused_imports)]
use futures::StreamExt;
#[cfg(test)]
#[allow(unused_imports)]
use minisign_verify::{PublicKey, Signature};
pub use oxide_driver_protocol::DRIVER_PROTOCOL_VERSION;

#[cfg(test)]
#[allow(unused_imports)]
use oxide_driver_protocol::{HandshakeResponse, SchemaMigrationMode};
#[cfg(test)]
#[allow(unused_imports)]
use regex::Regex;
#[cfg(test)]
#[allow(unused_imports)]
use reqwest::{
    header::{CONTENT_RANGE, RANGE},
    StatusCode,
};
#[cfg(test)]
#[allow(unused_imports)]
use semver::{Version, VersionReq};
#[cfg(test)]
#[allow(unused_imports)]
use serde::{Deserialize, Serialize};
#[cfg(test)]
#[allow(unused_imports)]
use sha2::{Digest, Sha256};
#[cfg(test)]
#[allow(unused_imports)]
use std::collections::BTreeSet;
#[cfg(test)]
#[allow(unused_imports)]
use std::fs;
#[cfg(test)]
#[allow(unused_imports)]
use std::io::{Read, Write};
#[cfg(test)]
#[allow(unused_imports)]
use std::path::{Component, Path, PathBuf};
#[cfg(test)]
#[allow(unused_imports)]
use std::sync::{Arc, Mutex};
#[cfg(test)]
#[allow(unused_imports)]
use std::time::Duration;
#[cfg(test)]
#[allow(unused_imports)]
use tar::Archive;
#[cfg(test)]
#[allow(unused_imports)]
use tempfile::{NamedTempFile, TempDir};
#[cfg(test)]
#[allow(unused_imports)]
use tokio::sync::Mutex as AsyncMutex;
#[cfg(test)]
#[allow(unused_imports)]
use url::Url;
#[cfg(test)]
#[allow(unused_imports)]
use uuid::Uuid;

mod archive;
mod cache;
mod catalog_binding;
mod catalog_registry;
mod catalog_transport;
mod catalog_validation;
mod downloads;
mod handshake;
mod installation;
mod java_runtime;
mod manifest_io;
mod package_contracts;
mod package_identity;
mod package_validation;
mod registry_core;
mod resolution;
mod signature;
mod store_copy;
mod types;
mod version_policy;

pub use handshake::validate_handshake;
pub use package_identity::is_safe_driver_package_token;
pub use types::{
    DatabaseDriverPackageRegistry, DriverActivationState, DriverPackageCachePruneResult,
    DriverPackageCatalog, DriverPackageCatalogDependency, DriverPackageCatalogEntry,
    DriverPackageClasspathEntry, DriverPackageConformance, DriverPackageConformanceEvidence,
    DriverPackageJavaRuntime, DriverPackageManifest, DriverPackageRuntime,
    DriverPackageSchemaMigrationContract, DriverPackageStatus, InstalledDriverPackage,
    ManagedJavaRuntimeInstallation, ManagedJavaRuntimeManifest,
    DRIVER_PACKAGE_CATALOG_SCHEMA_VERSION, DRIVER_PACKAGE_SCHEMA_VERSION,
};
pub use version_policy::validate_server_version_compatibility;

#[cfg(test)]
#[allow(unused_imports)]
use archive::*;
#[cfg(test)]
#[allow(unused_imports)]
use cache::*;
#[cfg(test)]
#[allow(unused_imports)]
use catalog_binding::*;
#[cfg(test)]
#[allow(unused_imports)]
use catalog_registry::*;
#[cfg(test)]
#[allow(unused_imports)]
use catalog_transport::*;
#[cfg(test)]
#[allow(unused_imports)]
use catalog_validation::*;
#[cfg(test)]
#[allow(unused_imports)]
use downloads::*;
#[cfg(test)]
#[allow(unused_imports)]
use handshake::*;
#[cfg(test)]
#[allow(unused_imports)]
use installation::*;
#[cfg(test)]
#[allow(unused_imports)]
use java_runtime::*;
#[cfg(test)]
#[allow(unused_imports)]
use manifest_io::*;
#[cfg(test)]
#[allow(unused_imports)]
use package_contracts::*;
#[cfg(test)]
#[allow(unused_imports)]
use package_identity::*;
#[cfg(test)]
#[allow(unused_imports)]
use package_validation::*;
#[cfg(test)]
#[allow(unused_imports)]
use registry_core::*;
#[cfg(test)]
#[allow(unused_imports)]
use resolution::*;
#[cfg(test)]
#[allow(unused_imports)]
use signature::*;
#[cfg(test)]
#[allow(unused_imports)]
use store_copy::*;
#[cfg(test)]
#[allow(unused_imports)]
use types::*;
#[cfg(test)]
#[allow(unused_imports)]
use version_policy::*;

#[cfg(test)]
mod tests;
