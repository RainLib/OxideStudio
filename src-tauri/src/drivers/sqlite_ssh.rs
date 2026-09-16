//! Remote SQLite over SSH facade; worker transport, trusted deployment, result projection, metadata, and driver adaptation stay separate.

mod driver;
mod metadata;
mod models;
mod platform;
mod response;
mod runtime;
mod transport;

pub use models::RemoteSqliteDriver;
pub use platform::detect_remote_sqlite_platform;

#[cfg(test)]
#[allow(unused_imports)]
pub(super) use metadata::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use platform::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use response::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use transport::*;
#[cfg(test)]
mod tests;
