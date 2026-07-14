pub mod ai;
pub mod cache;
/// Commands module
/// 将所有 Tauri commands 按功能模块组织
pub mod connection;
pub mod database;
pub mod lsp;
pub mod project_files;
pub mod query;
pub mod schema;
pub mod schema_diff;
pub mod settings;
pub mod store;
pub mod table;
pub mod transaction;
pub mod window;

// Re-export all commands for easy access
pub use ai::*;
pub use cache::*;
pub use connection::*;
pub use database::*;
pub use lsp::*;
pub use project_files::*;
pub use query::*;
pub use schema::*;
pub use schema_diff::*;
pub use settings::*;
pub use store::*;
pub use table::*;
pub use transaction::*;
pub use window::*;
