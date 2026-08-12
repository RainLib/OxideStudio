use crate::core::private_file::replace_private_file;
use anyhow::{anyhow, Context, Result};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    path::PathBuf,
    sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Manager};
use zeroize::Zeroize;

const MAX_CLI_ENV_BYTES: usize = 64 * 1024;
const MAX_CLI_ENV_ENTRIES: usize = 128;
static CLI_ENV_IO_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

pub fn validate_cli_profile_id(profile_id: &str) -> Result<String> {
    let value = profile_id.trim();
    if value.is_empty() || value.len() > 160 {
        return Err(anyhow!("CLI profile id must contain 1 to 160 characters"));
    }
    if !value
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.'))
    {
        return Err(anyhow!("CLI profile id contains unsupported characters"));
    }
    Ok(value.to_string())
}

pub fn validate_cli_environment(environment: &BTreeMap<String, String>) -> Result<()> {
    if environment.len() > MAX_CLI_ENV_ENTRIES {
        return Err(anyhow!(
            "CLI environment exceeds {MAX_CLI_ENV_ENTRIES} entries"
        ));
    }
    let mut encoded_bytes = 0usize;
    for (name, value) in environment {
        if !valid_environment_name(name) {
            return Err(anyhow!("CLI environment variable name is invalid: {name}"));
        }
        if reserved_environment_name(name) {
            return Err(anyhow!(
                "CLI environment variable is reserved by OxideStudio: {name}"
            ));
        }
        if value.contains('\0') {
            return Err(anyhow!(
                "CLI environment variable contains a null byte: {name}"
            ));
        }
        encoded_bytes = encoded_bytes
            .saturating_add(name.len())
            .saturating_add(value.len());
    }
    if encoded_bytes > MAX_CLI_ENV_BYTES {
        return Err(anyhow!("CLI environment exceeds the 64 KiB limit"));
    }
    Ok(())
}

pub async fn save_cli_environment(
    app: &AppHandle,
    provider: &str,
    profile_id: &str,
    environment: BTreeMap<String, String>,
) -> Result<Vec<String>> {
    let path = cli_environment_path(app, provider, profile_id)?;
    validate_cli_environment(&environment)?;
    let keys = environment.keys().cloned().collect::<Vec<_>>();
    tokio::task::spawn_blocking(move || {
        let _guard = io_lock()?;
        if environment.is_empty() {
            match fs::remove_file(&path) {
                Ok(()) => return Ok(keys),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(keys),
                Err(error) => return Err(anyhow!("failed to delete CLI environment: {error}")),
            }
        }
        let mut payload =
            serde_json::to_vec(&environment).context("failed to serialize CLI environment")?;
        if payload.len() > MAX_CLI_ENV_BYTES {
            payload.zeroize();
            return Err(anyhow!("CLI environment exceeds the 64 KiB limit"));
        }
        let result = replace_private_file(&path, &payload, "ai-cli-environment");
        payload.zeroize();
        result?;
        Ok(keys)
    })
    .await
    .context("CLI environment credential task failed")?
}

pub async fn load_cli_environment(
    app: &AppHandle,
    provider: &str,
    profile_id: &str,
) -> Result<BTreeMap<String, String>> {
    let path = cli_environment_path(app, provider, profile_id)?;
    tokio::task::spawn_blocking(move || {
        let _guard = io_lock()?;
        let metadata = match fs::metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(BTreeMap::new())
            }
            Err(error) => return Err(anyhow!("failed to inspect CLI environment: {error}")),
        };
        if metadata.len() > MAX_CLI_ENV_BYTES as u64 {
            return Err(anyhow!("CLI environment file is unexpectedly large"));
        }
        let mut payload = match fs::read(&path) {
            Ok(payload) => payload,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(BTreeMap::new())
            }
            Err(error) => return Err(anyhow!("failed to read CLI environment: {error}")),
        };
        let parsed = serde_json::from_slice::<BTreeMap<String, String>>(&payload)
            .context("stored CLI environment is invalid");
        payload.zeroize();
        let environment = parsed?;
        validate_cli_environment(&environment)?;
        Ok(environment)
    })
    .await
    .context("CLI environment credential task failed")?
}

fn cli_environment_path(app: &AppHandle, provider: &str, profile_id: &str) -> Result<PathBuf> {
    let provider = match provider.trim() {
        "codex-cli" => "codex-cli",
        "codebuddy-cli" => "codebuddy-cli",
        _ => return Err(anyhow!("unsupported CLI provider")),
    };
    let profile_id = validate_cli_profile_id(profile_id)?;
    let digest = Sha256::digest(format!("{provider}:{profile_id}").as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Ok(app
        .path()
        .app_config_dir()
        .context("failed to resolve the application configuration directory")?
        .join("credentials")
        .join(format!("ai-cli-{provider}-{digest}.json")))
}

fn valid_environment_name(name: &str) -> bool {
    let mut bytes = name.bytes();
    let Some(first) = bytes.next() else {
        return false;
    };
    (first.is_ascii_alphabetic() || first == b'_')
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

fn reserved_environment_name(name: &str) -> bool {
    let upper = name.to_ascii_uppercase();
    upper.starts_with("OXIDE_")
        || upper.starts_with("DBX_MCP_")
        || matches!(
            upper.as_str(),
            "TAURI_PRIVATE_KEY" | "TAURI_KEY_PASSWORD" | "RUST_LOG"
        )
}

fn io_lock() -> Result<std::sync::MutexGuard<'static, ()>> {
    CLI_ENV_IO_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| anyhow!("CLI environment file lock is poisoned"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_environment_names_and_reserved_bridge_keys() {
        let mut valid = BTreeMap::new();
        valid.insert(
            "HTTPS_PROXY".to_string(),
            "http://localhost:8080".to_string(),
        );
        valid.insert("CODEX_HOME".to_string(), "C:/codex".to_string());
        assert!(validate_cli_environment(&valid).is_ok());

        for name in [
            "1INVALID",
            "HAS-DASH",
            "OXIDE_CLI_BRIDGE_TOKEN",
            "DBX_MCP_ALLOW_WRITES",
        ] {
            let mut invalid = BTreeMap::new();
            invalid.insert(name.to_string(), "value".to_string());
            assert!(
                validate_cli_environment(&invalid).is_err(),
                "accepted {name}"
            );
        }
    }

    #[test]
    fn validates_profile_identifiers() {
        assert_eq!(
            validate_cli_profile_id("codex-cli:default").unwrap(),
            "codex-cli:default"
        );
        assert!(validate_cli_profile_id("../../profile").is_err());
    }
}
