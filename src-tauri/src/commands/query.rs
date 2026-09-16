//! Query command facade; diagnostics, execution, imports, read-only flow, and completion stay separate.

pub mod completion;
pub mod execution;
pub mod imports;
mod models;
pub mod read_only;
mod state;

pub(crate) use read_only::execute_query_with_cancellation;
pub use state::{ParserState, QueryCancellationState};

#[cfg(test)]
#[allow(unused_imports)]
pub(super) use completion::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use execution::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use imports::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use models::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use read_only::*;
#[cfg(test)]
#[allow(unused_imports)]
pub(super) use state::*;

#[cfg(test)]
mod tests;
