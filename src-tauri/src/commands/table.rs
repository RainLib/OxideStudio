//! Table command API. Implementations live in feature modules under `table/`.
//! Keep command names and wire types stable; put new logic in its owning module.

mod access;
mod compare_execute;
mod compare_rows;
mod compare_runtime;
mod compare_sync;
mod compare_types;
mod ddl_columns;
mod ddl_commands;
mod ddl_constraint_commands;
mod ddl_constraints;
mod ddl_index_commands;
mod ddl_read;
mod ddl_types;
mod export_analytical;
mod export_commands;
mod export_database;
mod export_files;
mod export_sql;
mod export_text;
mod export_types;
mod export_writer;
mod export_xlsx;
mod import_commands;
mod import_csv;
mod import_inference;
mod import_json;
mod import_preflight;
mod import_preview;
mod import_transaction;
mod import_types;
mod limits;
mod policy;
mod postgres_catalog;
mod reports;
mod row_commands;
mod row_sql;
mod row_types;
mod sqlite_ddl;
mod sqlite_ddl_builders;
mod transfer_batch_execute;
mod transfer_batch_plan;
mod transfer_execute;
mod transfer_identity;
mod transfer_mapping;
mod transfer_objects;
mod transfer_plan;
mod transfer_runtime;
mod transfer_schema;
mod transfer_target;
mod transfer_target_columns;
mod transfer_target_types;
mod transfer_transaction;
mod transfer_types;
mod values;

pub use compare_execute::*;
pub use compare_sync::*;
pub use compare_types::*;
pub use ddl_commands::*;
pub use ddl_constraint_commands::*;
pub use ddl_index_commands::*;
pub use ddl_read::*;
pub use ddl_types::*;
pub use export_commands::*;
pub use export_database::*;
pub use export_types::*;
pub use import_commands::*;
pub use import_inference::*;
pub use import_preflight::*;
pub use import_preview::*;
pub use import_types::*;
pub use limits::*;
pub use row_commands::*;
pub use row_types::*;
pub(crate) use sqlite_ddl::{
    rewrite_sqlite_create_index_for_transfer, rewrite_sqlite_create_table_for_transfer,
    rewrite_sqlite_create_trigger_for_transfer, rewrite_sqlite_create_view_for_transfer,
};
pub use transfer_batch_execute::*;
pub use transfer_batch_plan::*;
pub use transfer_execute::*;
pub use transfer_plan::*;
pub use transfer_target::*;
pub use transfer_types::*;

#[cfg(test)]
mod tests;
