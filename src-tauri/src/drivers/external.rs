//! External driver facade; state, sidecar lifecycle, protocol conversion, migration validation, and trait adaptation stay separate.

mod conversions;
mod driver;
mod lookup_context;
mod migration;
mod models;
mod runtime;

#[cfg(feature = "desktop")]
pub(crate) use conversions::external_statement_scan_dialect;
pub use models::ExternalDriver;

#[cfg(test)]
#[allow(unused_imports)]
pub(super) use conversions::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use migration::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use models::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use runtime::*;
#[cfg(test)]
mod tests;
