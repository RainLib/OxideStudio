use crate::core::config::{RemoteSqliteSshConfig, SqliteWorkerPlacement, SshTunnelConfig};
use crate::core::sqlite_worker_artifact::ResolvedSqliteWorker;
use crate::core::ssh::SshSession;
use anyhow::{anyhow, bail, Result};
use sha2::{Digest, Sha256};

use super::models::REMOTE_WORKER_DIRECTORY;

pub async fn detect_remote_sqlite_platform(config: &SshTunnelConfig) -> Result<String> {
    if !config.enabled {
        bail!("Remote SQLite requires an enabled SSH connection");
    }
    if !config.strict_host_key_checking {
        bail!("Remote SQLite requires strict SSH host-key verification");
    }
    let session = SshSession::connect(config).await?;
    let platform = remote_platform(&session).await;
    session.shutdown().await;
    platform
}

pub(super) fn worker_upload_is_approved(
    config: &RemoteSqliteSshConfig,
    worker: &ResolvedSqliteWorker,
) -> bool {
    config.allow_worker_upload
        && config
            .approved_worker_digest
            .as_deref()
            .is_some_and(|digest| digest.eq_ignore_ascii_case(&worker.digest))
}

pub(super) async fn remote_home(session: &SshSession) -> Result<String> {
    let home = session.capture_fixed("printf %s \"$HOME\"").await?;
    let home = home.trim();
    validate_remote_absolute_path(home)?;
    Ok(home.trim_end_matches('/').to_string())
}

pub(super) async fn remote_platform(session: &SshSession) -> Result<String> {
    let operating_system = session.capture_fixed("uname -s").await?;
    if !operating_system.trim().eq_ignore_ascii_case("linux") {
        bail!(
            "Remote SQLite supports Linux hosts only; found {}",
            operating_system.trim()
        );
    }
    match session.capture_fixed("uname -m").await?.trim() {
        "x86_64" | "amd64" => Ok("linux-x64".into()),
        "aarch64" | "arm64" => Ok("linux-aarch64".into()),
        architecture => {
            bail!("Remote SQLite supports Linux amd64/arm64 only; found {architecture}")
        }
    }
}

pub(super) fn worker_remote_path(
    connection_id: &str,
    config: &RemoteSqliteSshConfig,
    worker: &ResolvedSqliteWorker,
    home: &str,
) -> Result<(String, bool)> {
    let default_root = format!("{home}/{REMOTE_WORKER_DIRECTORY}");
    let path = match config.placement {
        SqliteWorkerPlacement::Session => {
            let id = format!("{:x}", Sha256::digest(connection_id.as_bytes()));
            format!("{default_root}/session-{}-{}", &id[..16], worker.digest)
        }
        SqliteWorkerPlacement::Persist => config
            .worker_path
            .as_deref()
            .map(|path| expand_remote_home(path, home))
            .transpose()?
            .unwrap_or_else(|| format!("{default_root}/{}-{}", worker.version, worker.digest)),
        SqliteWorkerPlacement::Preplaced => expand_remote_home(
            config
                .worker_path
                .as_deref()
                .filter(|path| !path.trim().is_empty())
                .ok_or_else(|| anyhow!("Preplaced SQLite worker path is required"))?,
            home,
        )?,
    };
    validate_remote_absolute_path(&path)?;
    Ok((path, config.placement == SqliteWorkerPlacement::Session))
}

pub(super) fn remote_sqlite_path(database_url: &str) -> Result<String> {
    let value = database_url.trim();
    let path = value
        .strip_prefix("sqlite://")
        .or_else(|| value.strip_prefix("sqlite:"))
        .unwrap_or(value);
    if path == ":memory:" || path.is_empty() || path.contains('?') || path.contains('#') {
        bail!("Remote SQLite requires one absolute file path without URL parameters");
    }
    Ok(path.to_string())
}

pub(super) fn expand_remote_home(path: &str, home: &str) -> Result<String> {
    if path == "~" {
        return Ok(home.to_string());
    }
    if let Some(relative) = path.strip_prefix("~/") {
        return Ok(format!("{}/{}", home.trim_end_matches('/'), relative));
    }
    Ok(path.to_string())
}

pub(super) fn validate_remote_absolute_path(path: &str) -> Result<()> {
    if !path.starts_with('/')
        || path.contains('\0')
        || path.contains('\n')
        || path.contains('\r')
        || path.split('/').any(|component| component == "..")
    {
        bail!("Remote SQLite path must be an absolute normalized Linux path");
    }
    Ok(())
}

pub(super) fn validate_worker_capabilities(capabilities: &[String]) -> Result<()> {
    for capability in [
        "parameterized-query",
        "parameterized-execute",
        "metadata",
        "online-backup",
        "restore",
        "interrupt",
    ] {
        if !capabilities.iter().any(|value| value == capability) {
            bail!("SQLite worker is missing required capability {capability}");
        }
    }
    Ok(())
}
