use super::packages::{
    activate_managed_install, download_verified_package, managed_package_spec,
    verify_staged_install, NPM_REGISTRY,
};
use super::paths::{managed_executable_path, managed_provider_root};
use crate::ai_cli::runtime::{resolve_named_command, run_captured};
use crate::ai_cli::{
    CliInstallResult, CliInstallationLaunchResult, CliInstallationPhase, CliInstallationStatus,
    CliProviderKind,
};
use anyhow::{anyhow, Context, Result};
use std::collections::{BTreeMap, HashMap};
use std::sync::LazyLock;
use std::time::Duration;
use tauri::AppHandle;
use tokio::sync::Mutex;

pub(super) const INSTALL_TIMEOUT: Duration = Duration::from_secs(10 * 60);

pub(super) struct ManagedInstallationSession {
    pub(super) status: CliInstallationStatus,
}

pub(super) static INSTALLATION_SESSIONS: LazyLock<
    Mutex<HashMap<String, ManagedInstallationSession>>,
> = LazyLock::new(|| Mutex::new(HashMap::new()));

pub async fn install_provider(
    app: &AppHandle,
    provider: CliProviderKind,
) -> Result<CliInstallResult> {
    install_provider_with_progress(app, provider, None).await
}

pub(super) async fn install_provider_with_progress(
    app: &AppHandle,
    provider: CliProviderKind,
    session_id: Option<&str>,
) -> Result<CliInstallResult> {
    let npm = resolve_named_command("npm").map_err(|error| {
        anyhow!(
            "Node.js and npm are required for managed installation. Install Node.js LTS or, if it was installed after OxideStudio started, restart OxideStudio and retry. {error}"
        )
    })?;
    let package = managed_package_spec(provider);
    let target = managed_provider_root(app, provider)?;
    let parent = target
        .parent()
        .ok_or_else(|| anyhow!("managed agent directory has no parent"))?;
    std::fs::create_dir_all(parent)
        .with_context(|| format!("failed to create {}", parent.display()))?;
    let install_id = uuid::Uuid::new_v4();
    let staging = parent.join(format!(".{}-install-{install_id}", provider.as_str()));
    std::fs::create_dir_all(&staging).with_context(|| {
        format!(
            "failed to create install staging directory {}",
            staging.display()
        )
    })?;
    if let Some(session_id) = session_id {
        update_installation(
            session_id,
            CliInstallationPhase::Downloading,
            "Downloading and verifying the managed CLI package...",
        )
        .await;
    }
    let archive = match download_verified_package(&npm, package, &staging, parent).await {
        Ok(archive) => archive,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&staging);
            return Err(error);
        }
    };
    let args = vec![
        "install".to_string(),
        "--prefix".to_string(),
        staging.to_string_lossy().into_owned(),
        "--no-save".to_string(),
        "--omit=dev".to_string(),
        "--no-audit".to_string(),
        "--no-fund".to_string(),
        format!("--registry={NPM_REGISTRY}"),
        archive.to_string_lossy().into_owned(),
    ];
    if let Some(session_id) = session_id {
        update_installation(
            session_id,
            CliInstallationPhase::Installing,
            "Installing the verified CLI package in OxideStudio...",
        )
        .await;
    }
    let install = run_captured(
        &npm,
        &args,
        &BTreeMap::new(),
        Some(&staging),
        None,
        INSTALL_TIMEOUT,
    )
    .await;
    let output = match install {
        Ok(output) => output,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&staging);
            return Err(error.context("managed installation failed before activation"));
        }
    };
    if !output.success {
        let detail = output
            .stderr
            .lines()
            .chain(output.stdout.lines())
            .map(str::trim)
            .find(|line| !line.is_empty())
            .unwrap_or("npm did not provide an error message");
        let _ = std::fs::remove_dir_all(&staging);
        return Err(anyhow!("managed installation failed: {detail}"));
    }

    if let Some(session_id) = session_id {
        update_installation(
            session_id,
            CliInstallationPhase::Verifying,
            "Verifying the installed CLI entry point...",
        )
        .await;
    }
    if let Err(error) = verify_staged_install(&staging, provider, package) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(error);
    }
    let _ = std::fs::remove_file(&archive);
    if let Err(error) = activate_managed_install(&target, &staging, provider) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(error);
    }

    let executable_path = managed_executable_path(&target, provider);
    if !executable_path.is_file() {
        return Err(anyhow!(
            "managed installation activation did not preserve {}",
            executable_path.display()
        ));
    }
    Ok(CliInstallResult {
        provider,
        executable_path: executable_path.to_string_lossy().into_owned(),
        message: format!(
            "{} {} was verified and installed in OxideStudio's managed agent directory",
            provider.display_name(),
            package.version
        ),
    })
}

pub async fn begin_installation(
    app: &AppHandle,
    provider: CliProviderKind,
) -> Result<CliInstallationLaunchResult> {
    let session_id = {
        let mut sessions = INSTALLATION_SESSIONS.lock().await;
        if let Some(session) = sessions.values().find(|session| {
            session.status.provider == provider && !session.status.phase.is_terminal()
        }) {
            return Ok(CliInstallationLaunchResult {
                provider,
                session_id: session.status.session_id.clone(),
                message: session.status.message.clone(),
            });
        }
        if sessions.len() >= 64 {
            sessions.retain(|_, session| !session.status.phase.is_terminal());
        }
        let session_id = uuid::Uuid::new_v4().to_string();
        sessions.insert(
            session_id.clone(),
            ManagedInstallationSession {
                status: CliInstallationStatus {
                    session_id: session_id.clone(),
                    provider,
                    phase: CliInstallationPhase::Starting,
                    message: format!("Preparing {} installation...", provider.display_name()),
                    result: None,
                },
            },
        );
        session_id
    };
    let task_app = app.clone();
    let task_session_id = session_id.clone();
    tauri::async_runtime::spawn(async move {
        match install_provider_with_progress(&task_app, provider, Some(&task_session_id)).await {
            Ok(result) => {
                update_installation_with_result(
                    &task_session_id,
                    CliInstallationPhase::Succeeded,
                    result.message.clone(),
                    Some(result),
                )
                .await;
            }
            Err(error) => {
                update_installation_with_result(
                    &task_session_id,
                    CliInstallationPhase::Failed,
                    installation_error_message(&error),
                    None,
                )
                .await;
            }
        }
    });
    Ok(CliInstallationLaunchResult {
        provider,
        session_id,
        message: format!("Preparing {} installation...", provider.display_name()),
    })
}

pub async fn installation_status(session_id: &str) -> Result<CliInstallationStatus> {
    INSTALLATION_SESSIONS
        .lock()
        .await
        .get(session_id)
        .map(|session| session.status.clone())
        .ok_or_else(|| anyhow!("installation session is no longer available"))
}

pub(super) fn installation_error_message(error: &anyhow::Error) -> String {
    format!("{error:#}").chars().take(2_000).collect()
}

pub(super) async fn update_installation(
    session_id: &str,
    phase: CliInstallationPhase,
    message: impl Into<String>,
) {
    update_installation_with_result(session_id, phase, message, None).await;
}

pub(super) async fn update_installation_with_result(
    session_id: &str,
    phase: CliInstallationPhase,
    message: impl Into<String>,
    result: Option<CliInstallResult>,
) {
    if let Some(session) = INSTALLATION_SESSIONS.lock().await.get_mut(session_id) {
        if !session.status.phase.is_terminal() || phase.is_terminal() {
            session.status.phase = phase;
            session.status.message = message.into();
            if result.is_some() {
                session.status.result = result;
            }
        }
    }
}
