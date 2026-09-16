//! Shell policy and sandbox facade. Implementations live in feature modules.

mod builtin_policy;
mod command_targets;
mod declarative_policy;
mod execution;
mod policy_config;
mod policy_engine;
mod syntax;
#[cfg(test)]
mod tests;
mod types;

pub use execution::*;
pub use policy_engine::evaluate_shell_command_policy;
pub use types::*;
