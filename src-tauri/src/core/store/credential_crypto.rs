use super::models::CONNECTION_CREDENTIAL_KEY_BYTES;
use crate::core::private_file::create_private_file;
use anyhow::Context;
use anyhow::{anyhow, Result};
use rand::rngs::OsRng;
use rand::RngCore;
use std::path::Path;
use zeroize::Zeroize;
use zeroize::Zeroizing;

pub(super) struct ProtectedConnectionCredentials {
    pub(super) ciphertext: Vec<u8>,
    pub(super) nonce: [u8; 12],
}

pub(super) fn connection_credential_aad(project_id: &str, connection_id: &str) -> Vec<u8> {
    format!("oxide-connection-credential-v1\0{project_id}\0{connection_id}").into_bytes()
}

pub(super) fn load_or_create_credential_key(
    path: &Path,
) -> Result<Zeroizing<[u8; CONNECTION_CREDENTIAL_KEY_BYTES]>> {
    if let Some(key) = read_credential_key(path)? {
        return Ok(Zeroizing::new(key));
    }
    let mut generated = [0_u8; CONNECTION_CREDENTIAL_KEY_BYTES];
    OsRng.fill_bytes(&mut generated);
    if create_private_file(path, &generated)? {
        return Ok(Zeroizing::new(generated));
    }
    generated.zeroize();
    read_credential_key(path)?
        .map(Zeroizing::new)
        .context("local connection credential key was not created")
}

pub(super) fn read_credential_key(
    path: &Path,
) -> Result<Option<[u8; CONNECTION_CREDENTIAL_KEY_BYTES]>> {
    let mut bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error).context("failed to read local connection credential key"),
    };
    if bytes.len() != CONNECTION_CREDENTIAL_KEY_BYTES {
        bytes.zeroize();
        return Err(anyhow!("local connection credential key is invalid"));
    }
    let mut key = [0_u8; CONNECTION_CREDENTIAL_KEY_BYTES];
    key.copy_from_slice(&bytes);
    bytes.zeroize();
    Ok(Some(key))
}

pub(super) fn config_contains_plaintext_credentials(config: &serde_json::Value) -> bool {
    let Some(object) = config.as_object() else {
        return false;
    };
    ["url", "connectionUrl", "password"].into_iter().any(|key| {
        object
            .get(key)
            .and_then(serde_json::Value::as_str)
            .is_some_and(|value| !value.is_empty())
    }) || object
        .get("sshTunnel")
        .and_then(serde_json::Value::as_object)
        .is_some_and(ssh_tunnel_contains_plaintext_credentials)
}

pub(super) fn ssh_tunnel_contains_plaintext_credentials(
    tunnel: &serde_json::Map<String, serde_json::Value>,
) -> bool {
    ["password", "privateKeyPassphrase"].into_iter().any(|key| {
        tunnel
            .get(key)
            .and_then(serde_json::Value::as_str)
            .is_some_and(|value| !value.is_empty())
    }) || tunnel
        .get("jumpHosts")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|hops| {
            hops.iter().any(|hop| {
                hop.as_object()
                    .is_some_and(ssh_tunnel_contains_plaintext_credentials)
            })
        })
}

/// Extract credentials recursively using a JSON shape that mirrors the public
/// tunnel configuration. This keeps later bastion credentials in the existing
/// encrypted record rather than the connection-config column.
pub(super) fn extract_ssh_tunnel_secrets(
    tunnel: &mut serde_json::Map<String, serde_json::Value>,
) -> serde_json::Map<String, serde_json::Value> {
    let mut secrets = serde_json::Map::new();
    for key in ["password", "privateKeyPassphrase"] {
        if let Some(value) = tunnel.remove(key) {
            if !value.is_null() && value.as_str().is_none_or(|text| !text.is_empty()) {
                secrets.insert(key.to_string(), value);
            }
        }
    }
    if let Some(hops) = tunnel
        .get_mut("jumpHosts")
        .and_then(serde_json::Value::as_array_mut)
    {
        let mut hop_secrets = Vec::with_capacity(hops.len());
        let mut has_secrets = false;
        for hop in hops {
            let hop_secret = hop
                .as_object_mut()
                .map(extract_ssh_tunnel_secrets)
                .unwrap_or_default();
            has_secrets |= !hop_secret.is_empty();
            hop_secrets.push(serde_json::Value::Object(hop_secret));
        }
        if has_secrets {
            secrets.insert(
                "jumpHosts".to_string(),
                serde_json::Value::Array(hop_secrets),
            );
        }
    }
    secrets
}

pub(super) fn restore_ssh_tunnel_secrets(
    tunnel: &mut serde_json::Map<String, serde_json::Value>,
    secrets: &serde_json::Map<String, serde_json::Value>,
) {
    for (key, value) in secrets {
        if key != "jumpHosts" {
            tunnel.insert(key.clone(), value.clone());
            continue;
        }
        let Some(secret_hops) = value.as_array() else {
            continue;
        };
        let Some(hops) = tunnel
            .get_mut("jumpHosts")
            .and_then(serde_json::Value::as_array_mut)
        else {
            continue;
        };
        for (hop, hop_secrets) in hops.iter_mut().zip(secret_hops) {
            if let (Some(hop), Some(hop_secrets)) = (hop.as_object_mut(), hop_secrets.as_object()) {
                restore_ssh_tunnel_secrets(hop, hop_secrets);
            }
        }
    }
}
