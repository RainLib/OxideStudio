use super::{
    command_config::{
        build_prompt, codebuddy_args, codex_args, non_default, provider_kind,
        resolve_oxide_agent_binary, DEFAULT_CLI_TIMEOUT, MAX_CLI_TIMEOUT_MS, MIN_CLI_TIMEOUT_MS,
    },
    run::{CliRunProtocol, PreparedCliRun},
};
use crate::{
    agent::{
        bridge::{PrivateBridgeSession, BRIDGE_ENDPOINT_ENV, BRIDGE_TOKEN_ENV},
        protocol::{AgentProfile, AgentProviderConfig, AgentTurnRequest},
    },
    ai_cli::{
        runtime::{isolated_working_directory, resolve_command},
        CliProviderKind,
    },
    core::{cli_provider_secret::load_cli_environment, store::MetaStore},
};
use anyhow::{anyhow, Result};
use std::{collections::BTreeMap, time::Duration};
use tauri::{AppHandle, Manager};

pub async fn prepare_cli_run(
    app: &AppHandle,
    request: &AgentTurnRequest,
    provider: &AgentProviderConfig,
    bridge: PrivateBridgeSession,
) -> Result<PreparedCliRun> {
    let provider_kind = provider_kind(provider.kind)?;
    let profile_id = provider
        .profile_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow!("CLI provider profileId is required"))?;
    let command = resolve_command(provider_kind, provider.executable_path.as_deref()).await?;
    let stored_environment = load_cli_environment(app, provider_kind.as_str(), profile_id).await?;
    let mut environment = stored_environment
        .into_iter()
        .filter(|(name, _)| provider.environment_keys.iter().any(|key| key == name))
        .collect::<BTreeMap<_, _>>();
    environment.insert(
        BRIDGE_ENDPOINT_ENV.to_string(),
        bridge.endpoint().to_string(),
    );
    environment.insert(BRIDGE_TOKEN_ENV.to_string(), bridge.token().to_string());

    let isolated_working_directory = isolated_working_directory()?;
    let oxide_agent = resolve_oxide_agent_binary(app)?;
    let full_access = provider_kind == CliProviderKind::CodexCli
        && request.profile == AgentProfile::Agent
        && provider.access_mode.as_deref() == Some("full")
        && provider
            .reasoning_effort
            .as_deref()
            .is_some_and(|effort| effort.eq_ignore_ascii_case("ultra"));
    let working_directory = if full_access {
        let store = app
            .try_state::<MetaStore>()
            .ok_or_else(|| anyhow!("project metadata store is unavailable"))?;
        crate::commands::project_files::agent_project_directory(&store, &request.project_id, None)
            .await?
            .1
    } else {
        isolated_working_directory.path().to_path_buf()
    };
    let prompt = build_prompt(request, full_access);
    let timeout = Duration::from_millis(
        provider
            .timeout_ms
            .unwrap_or(DEFAULT_CLI_TIMEOUT.as_millis() as u64)
            .clamp(MIN_CLI_TIMEOUT_MS, MAX_CLI_TIMEOUT_MS),
    );
    let args = match provider_kind {
        CliProviderKind::CodexCli => codex_args(provider, &oxide_agent, request, full_access),
        CliProviderKind::CodebuddyCli => {
            codebuddy_args(provider, &oxide_agent, request, &working_directory)?
        }
    };
    let protocol = match provider_kind {
        CliProviderKind::CodexCli => CliRunProtocol::CodexAppServer {
            model: non_default(provider.model.as_str()),
            effort: provider.reasoning_effort.as_deref().and_then(non_default),
            service_tier: provider.service_tier.as_deref().and_then(non_default),
            full_access,
            collaboration_mode: if request.profile == AgentProfile::Plan {
                "plan"
            } else {
                "default"
            },
        },
        CliProviderKind::CodebuddyCli => CliRunProtocol::Jsonl,
    };
    Ok(PreparedCliRun {
        provider: provider_kind,
        tool_names: request.tools.iter().map(|tool| tool.name.clone()).collect(),
        command,
        args,
        environment,
        stdin: prompt.into_bytes(),
        timeout,
        protocol,
        working_directory,
        _isolated_working_directory: isolated_working_directory,
        _bridge: bridge,
    })
}
