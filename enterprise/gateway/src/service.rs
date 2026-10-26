//! Gateway data-plane facade. RPC orchestration delegates to explicit policy, session, driver, and authorization owners.

mod authorization;
mod driver;
mod models;
mod mutation;
mod policy;
mod protocol;
mod rpc;
mod session;
#[cfg(test)]
mod tests;

pub use models::DataPlaneService;
