//! Shared database capability catalog and driver-specific SQL rendering facade.

mod catalog;
mod sql;
mod types;

pub use catalog::*;
pub use sql::*;
pub use types::*;

#[cfg(test)]
#[allow(unused_imports)]
pub(super) use catalog::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use sql::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use types::*;

#[cfg(test)]
mod tests;
