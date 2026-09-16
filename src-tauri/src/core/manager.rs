//! Connection lifecycle and database-driver dispatch facade.

mod lifecycle;
mod models;
mod operations;

pub use models::{
    ConnectionManager, ExternalDriverRuntimeReconnectResult, ExternalDriverRuntimeSummary,
    LiveConnectionCapabilitySnapshot,
};

#[cfg(test)]
#[allow(unused_imports)]
pub(super) use lifecycle::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use models::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use operations::*;

#[cfg(test)]
mod tests;
