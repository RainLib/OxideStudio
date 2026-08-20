//! Shared, versioned contracts for OxideStudio's enterprise control and data planes.
//!
//! The types in this crate are intentionally secret-free. Database credentials
//! belong to a gateway-local [`SecretProvider`](../../gateway/src/secret.rs)
//! implementation and must never be represented by these wire contracts.

mod enrollment;
mod model;
#[cfg(feature = "policy")]
mod policy;
#[cfg(feature = "ticket")]
mod ticket;

pub use enrollment::*;
pub use model::*;
#[cfg(feature = "policy")]
pub use policy::*;
#[cfg(feature = "ticket")]
pub use ticket::*;

pub const ENTERPRISE_CONTRACT_VERSION: u16 = 1;
