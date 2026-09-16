//! Fixed database administration facade; models, confirmation, observation, mutations, events, and maintenance stay separate.

pub mod events;
pub mod identity;
pub mod maintenance;
mod models;
pub mod read;
mod support;
pub mod write;

pub use identity::get_database_admin_server_identity;
pub use models::*;
pub use read::{
    list_database_admin_lock_waits, list_database_admin_metrics,
    list_database_admin_role_memberships, list_database_admin_sessions,
    list_database_admin_table_privileges, list_database_admin_users,
    terminate_database_admin_session,
};
pub use write::{
    create_database_admin_user, delete_database_admin_user, set_database_admin_user_login,
    update_database_admin_user_password,
};

#[cfg(test)]
mod tests;
