use crate::ai_cli::CliProviderKind;
use anyhow::{Context, Result};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub(super) fn managed_provider_root(app: &AppHandle, provider: CliProviderKind) -> Result<PathBuf> {
    let app_data = app
        .path()
        .app_data_dir()
        .context("failed to resolve the application data directory")?;
    Ok(app_data.join("ai-agents").join(provider.as_str()))
}

pub(super) fn managed_executable_path(
    root: &std::path::Path,
    provider: CliProviderKind,
) -> PathBuf {
    let executable = match provider {
        CliProviderKind::CodexCli => "codex",
        CliProviderKind::CodebuddyCli => "codebuddy",
    };
    #[cfg(windows)]
    return root
        .join("node_modules")
        .join(".bin")
        .join(format!("{executable}.cmd"));
    #[cfg(not(windows))]
    return root.join("node_modules").join(".bin").join(executable);
}
