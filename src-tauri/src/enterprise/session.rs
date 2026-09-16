use crate::core::private_file::replace_private_file;
use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use anyhow::{anyhow, Context, Result};
use rand::RngCore;
use std::{fs, path::PathBuf};
use zeroize::Zeroize;

use super::{
    models::EncryptedEnterpriseSession,
    support::{
        ENTERPRISE_REFRESH_ACCOUNT, ENTERPRISE_REFRESH_SERVICE, ENTERPRISE_SESSION_AAD,
        ENTERPRISE_SESSION_KEY_ACCOUNT,
    },
};

pub(super) async fn load_refresh_token(enterprise_directory: PathBuf) -> Result<Option<String>> {
    let encrypted_path = enterprise_directory.join("session.json.enc");
    let encrypted_bytes = match fs::read(&encrypted_path) {
        Ok(bytes) => Some(bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error).context("failed to read the enterprise session"),
    };

    if let Some(encrypted_bytes) = encrypted_bytes {
        let mut key = match load_session_key().await? {
            Some(key) => key,
            None => return Ok(None),
        };
        let result = decrypt_refresh_token(&encrypted_bytes, &key);
        key.zeroize();
        return result.map(Some);
    }

    load_legacy_refresh_token().await
}

pub(super) async fn save_refresh_token(enterprise_directory: PathBuf, token: &str) -> Result<()> {
    let mut key = match load_session_key().await? {
        Some(key) => key,
        None => {
            let mut key = [0_u8; 32];
            rand::thread_rng().fill_bytes(&mut key);
            save_session_key(key).await?;
            key
        }
    };
    let encrypted = encrypt_refresh_token(token, &key)?;
    key.zeroize();
    replace_private_file(
        &enterprise_directory.join("session.json.enc"),
        &encrypted,
        "enterprise-session",
    )?;

    // Remove credentials written by older builds after the encrypted envelope is durable.
    delete_keyring_entry(ENTERPRISE_REFRESH_ACCOUNT).await
}

pub(super) async fn load_session_key() -> Result<Option<[u8; 32]>> {
    tokio::task::spawn_blocking(|| {
        let entry = keyring::Entry::new(ENTERPRISE_REFRESH_SERVICE, ENTERPRISE_SESSION_KEY_ACCOUNT)
            .context("platform credential storage is unavailable")?;
        match entry.get_secret() {
            Ok(mut secret) => {
                if secret.len() != 32 {
                    secret.zeroize();
                    return Err(anyhow!("stored enterprise session key is invalid"));
                }
                let mut key = [0_u8; 32];
                key.copy_from_slice(&secret);
                secret.zeroize();
                Ok(Some(key))
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(anyhow!(error)).context("failed to read the enterprise session key"),
        }
    })
    .await
    .context("enterprise credential task failed")?
}

pub(super) async fn save_session_key(mut key: [u8; 32]) -> Result<()> {
    tokio::task::spawn_blocking(move || {
        let entry = keyring::Entry::new(ENTERPRISE_REFRESH_SERVICE, ENTERPRISE_SESSION_KEY_ACCOUNT)
            .context("platform credential storage is unavailable")?;
        let result = entry
            .set_secret(&key)
            .context("failed to protect the enterprise session key");
        key.zeroize();
        result
    })
    .await
    .context("enterprise credential task failed")?
}

pub(super) async fn load_legacy_refresh_token() -> Result<Option<String>> {
    tokio::task::spawn_blocking(|| {
        let entry = keyring::Entry::new(ENTERPRISE_REFRESH_SERVICE, ENTERPRISE_REFRESH_ACCOUNT)
            .context("platform credential storage is unavailable")?;
        match entry.get_secret() {
            Ok(secret) => Ok(Some(decode_refresh_token_secret(secret)?)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(anyhow!(error)).context("failed to read the enterprise session"),
        }
    })
    .await
    .context("enterprise credential task failed")?
}

pub(super) fn encrypt_refresh_token(token: &str, key: &[u8; 32]) -> Result<Vec<u8>> {
    let cipher = Aes256Gcm::new_from_slice(key).context("enterprise session key is invalid")?;
    let mut nonce_bytes = [0_u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let ciphertext = cipher
        .encrypt(
            &Nonce::from(nonce_bytes),
            Payload {
                msg: token.as_bytes(),
                aad: ENTERPRISE_SESSION_AAD,
            },
        )
        .map_err(|_| anyhow!("failed to encrypt the enterprise session"))?;
    serde_json::to_vec(&EncryptedEnterpriseSession {
        nonce: nonce_bytes.to_vec(),
        ciphertext,
    })
    .context("failed to encode the enterprise session")
}

pub(super) fn decrypt_refresh_token(encrypted_bytes: &[u8], key: &[u8; 32]) -> Result<String> {
    let encrypted: EncryptedEnterpriseSession =
        serde_json::from_slice(encrypted_bytes).context("stored enterprise session is invalid")?;
    let nonce_bytes: [u8; 12] = encrypted
        .nonce
        .try_into()
        .map_err(|_| anyhow!("stored enterprise session nonce is invalid"))?;
    let cipher = Aes256Gcm::new_from_slice(key).context("enterprise session key is invalid")?;
    let mut plaintext = cipher
        .decrypt(
            &Nonce::from(nonce_bytes),
            Payload {
                msg: &encrypted.ciphertext,
                aad: ENTERPRISE_SESSION_AAD,
            },
        )
        .map_err(|_| anyhow!("stored enterprise session authentication failed"))?;
    let result = std::str::from_utf8(&plaintext)
        .map(str::to_owned)
        .context("stored enterprise session is invalid");
    plaintext.zeroize();
    result
}

pub(super) fn decode_refresh_token_secret(mut secret: Vec<u8>) -> Result<String> {
    let decoded = match std::str::from_utf8(&secret) {
        Ok(value) if !value.contains('\0') => Ok(value.to_string()),
        _ if secret.len().is_multiple_of(2) => {
            let utf16 = secret
                .chunks_exact(2)
                .map(|bytes| u16::from_le_bytes([bytes[0], bytes[1]]))
                .collect::<Vec<_>>();
            String::from_utf16(&utf16).context("stored enterprise session is invalid")
        }
        _ => Err(anyhow!("stored enterprise session is invalid")),
    };
    secret.zeroize();
    decoded
}

pub(super) async fn delete_keyring_entry(account: &'static str) -> Result<()> {
    tokio::task::spawn_blocking(move || {
        let entry = keyring::Entry::new(ENTERPRISE_REFRESH_SERVICE, account)
            .context("platform credential storage is unavailable")?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(anyhow!(error)).context("failed to remove the enterprise session"),
        }
    })
    .await
    .context("enterprise credential task failed")?
}

pub(super) async fn delete_refresh_token(enterprise_directory: PathBuf) -> Result<()> {
    delete_keyring_entry(ENTERPRISE_REFRESH_ACCOUNT).await?;
    delete_keyring_entry(ENTERPRISE_SESSION_KEY_ACCOUNT).await?;
    match fs::remove_file(enterprise_directory.join("session.json.enc")) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error).context("failed to remove the enterprise session"),
    }
}
