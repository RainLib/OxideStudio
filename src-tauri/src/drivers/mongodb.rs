//! MongoDB driver facade; execution, document mutation, metadata, and value rendering stay separate.

mod commands;
mod documents;
mod driver;
mod models;
mod read_only;
mod results;
mod runtime;

pub use models::MongoDbDriver;
pub(crate) use runtime::mongodb_url_uses_oidc;

#[cfg(test)]
#[allow(unused_imports)]
pub(super) use commands::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use documents::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use driver::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use models::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use results::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use runtime::*;

#[cfg(test)]
mod tests;
