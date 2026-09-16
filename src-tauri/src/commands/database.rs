//! Database command facade; capability contracts, package lifecycle, runtime controls, and namespace mutations stay separate.

pub mod capabilities;
mod models;
pub mod namespace;
pub mod packages;
pub mod runtime;

pub use models::{
    ConnectionDatabaseCapabilityContext, DatabaseDriverCatalog, DatabaseDriverInstallation,
    DatabaseDriverProbeResult, DatabaseDriverRuntimeReconnectResult, DatabaseDriverRuntimeSummary,
    DatabaseDriverStoreInfo, SchemaMigrationCapabilityMode,
};

#[cfg(test)]
#[allow(unused_imports)]
pub(super) use capabilities::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use models::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use namespace::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use packages::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use runtime::*;
#[cfg(test)]
mod tests;
