//! Rust Agent Host facade. State and protocol handlers live in owning modules.

mod approval_types;
mod approved_query_review;
mod artifact_helpers;
mod artifact_runtime;
mod bridge_runtime;
mod checkpoint_helpers;
mod checkpoint_runtime;
mod cli_runtime;
mod connection_config;
mod connection_runtime;
mod connection_types;
mod conversation_helpers;
mod conversation_runtime;
mod event_projection;
mod event_runtime;
mod host_errors;
mod identity_helpers;
mod interaction_runtime;
mod lifecycle_runtime;
mod manager;
mod metrics_helpers;
mod metrics_types;
mod model_runtime;
mod mutation_runtime;
mod native_read_only;
mod process_helpers;
mod process_runtime;
mod query_result;
mod read_runtime;
mod review_types;
mod session_state;
#[cfg(test)]
mod tests;
mod tool_manifest;
mod tool_runtime;
mod turn_runtime;
mod turn_state;

pub use manager::AgentHostManager;
