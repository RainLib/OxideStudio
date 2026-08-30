//! Minimal, versioned protocol shared by the OxideStudio desktop and the
//! short-lived SQLite worker deployed to a confirmed SSH host.

pub mod protocol;

#[cfg(feature = "runtime")]
pub mod runtime;

pub use protocol::*;

pub const SQLITE_WORKER_PACKAGE_VERSION: &str = env!("CARGO_PKG_VERSION");
