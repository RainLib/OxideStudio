//! Encrypted Agent state facade; lifecycle, records, graph persistence, and cryptography stay separate.

mod crypto;
mod graph;
mod models;
mod persistence;
mod records;
mod runtime;

pub use models::AgentStore;
pub(crate) use models::{StoredGraphCheckpoint, StoredGraphWrite};

#[cfg(test)]
#[allow(unused_imports)]
pub(super) use crypto::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use graph::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use models::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use persistence::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use records::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use runtime::*;
#[cfg(test)]
mod tests;
