//! SQLite driver facade; state, runtime, trait adaptation, file safety, and values stay separate.

mod backup;
mod driver;
mod models;
mod runtime;
mod values;

pub(super) use backup::{replace_backup_file, sync_file, temporary_backup_path};
pub use models::SqliteDriver;
pub(super) use runtime::validate_sqlite_rebuild_statements;

#[cfg(test)]
#[allow(unused_imports)]
pub(super) use backup::*;
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
