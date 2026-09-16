//! MySQL driver facade; state, runtime operations, trait adaptation, and value codecs stay separate.

mod driver;
mod models;
mod runtime;
mod values;

pub use models::MysqlDriver;

#[cfg(test)]
#[allow(unused_imports)]
pub(super) use driver::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use models::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use runtime::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use values::*;

#[cfg(test)]
mod tests;
