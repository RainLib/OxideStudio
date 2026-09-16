use crate::{
    ai_cli::{
        codebuddy, codex, setup, CliAuthenticationLaunchResult, CliCommandInfo,
        CliConnectionTestResult, CliDetectionResult, CliEnvironmentRequest,
        CliEnvironmentSaveResult, CliInstallationLaunchResult, CliModelInfo, CliProfileRequest,
        CliProviderConfig, CliProviderKind,
    },
    core::{
        cli_provider_secret::{load_cli_environment, save_cli_environment},
        protocol::Response,
        provider_headers::{load_provider_headers, provider_header_map, save_provider_headers},
        provider_secret::{
            has_scoped_provider_secret, load_scoped_provider_secret, normalize_provider_secret,
            save_scoped_provider_secret,
        },
        store::MetaStore,
    },
};
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    future::Future,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, State};
use tokio::sync::{watch, Mutex};

mod cancellation;
mod chat_commands;
mod chat_transport;
mod cli_cache;
mod cli_diagnostics;
mod cli_discovery;
mod cli_environment;
mod cli_setup;
mod inline_commands;
mod inline_transport;
mod provider_settings;
mod provider_support;
#[cfg(test)]
mod tests;
mod wire_types;

pub use cancellation::*;
pub use chat_commands::*;
use chat_transport::send_chat_completion;
#[cfg(test)]
use cli_cache::{cli_capability_cache_key, CLI_CAPABILITY_CACHE_TTL_MS};
use cli_cache::{cli_capability_cache_now_ms, load_cached_cli_capability};
use cli_diagnostics::cli_operation_error_code;
pub use cli_discovery::*;
pub use cli_environment::*;
pub use cli_setup::*;
pub use inline_commands::*;
use inline_transport::send_inline_completion;
#[cfg(test)]
use inline_transport::{clean_inline_completion, inline_completion_timeout, truncate_utf8_tail};
pub use provider_settings::*;
use provider_support::{
    chat_completions_url, hydrate_provider_headers, hydrate_provider_secret, provider_endpoint_url,
    provider_error_message, validate_config,
};
pub use wire_types::*;
