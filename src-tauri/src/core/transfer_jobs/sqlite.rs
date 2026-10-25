mod catalog;
mod copy;
mod file_publish;
mod receipt;

pub(super) use catalog::{connect, prepare_snapshot};
pub(super) use copy::{copy_batch, initialize, publish, reconcile, remove_staging};
pub(super) use receipt::read_header;

pub(super) fn quote(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}
