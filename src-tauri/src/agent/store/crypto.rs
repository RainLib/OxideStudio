use crate::core::private_file::create_private_file;
use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use anyhow::{anyhow, Context, Result};
use rand::{rngs::OsRng, RngCore};
use serde_json::Value;
use zeroize::Zeroize;

use super::models::{EncryptedRecord, RecordKey, AGENT_STORE_KEY_BYTES};

pub(super) fn resolve_persistent_key(path: &std::path::Path) -> Option<[u8; 32]> {
    match load_local_key(path) {
        Ok(Some(key)) => return Some(key),
        Ok(None) => {}
        Err(_) => return None,
    }

    let mut candidate = random_key();
    match create_private_file(path, &candidate) {
        Ok(true) => Some(candidate),
        Ok(false) => {
            candidate.zeroize();
            load_local_key(path).ok().flatten()
        }
        Err(_) => {
            candidate.zeroize();
            None
        }
    }
}

pub(super) fn load_local_key(path: &std::path::Path) -> Result<Option<[u8; 32]>> {
    let mut bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(anyhow!("failed to read agent key file: {error}")),
    };
    if bytes.len() != AGENT_STORE_KEY_BYTES {
        bytes.zeroize();
        return Err(anyhow!("agent key file has an invalid length"));
    }
    let mut key = [0u8; AGENT_STORE_KEY_BYTES];
    key.copy_from_slice(&bytes);
    bytes.zeroize();
    Ok(Some(key))
}

pub(super) fn random_key() -> [u8; 32] {
    let mut key = [0u8; 32];
    OsRng.fill_bytes(&mut key);
    key
}

pub(super) fn encrypt(
    key: &[u8; 32],
    record_key: &RecordKey,
    plaintext: &[u8],
    expires_at: i64,
) -> Result<EncryptedRecord> {
    let cipher = Aes256Gcm::new_from_slice(key).context("invalid agent encryption key")?;
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from(nonce_bytes);
    let ciphertext = cipher
        .encrypt(
            &nonce,
            Payload {
                msg: plaintext,
                aad: &record_key.aad(),
            },
        )
        .map_err(|_| anyhow!("failed to encrypt agent state"))?;
    Ok(EncryptedRecord {
        ciphertext,
        nonce: nonce_bytes,
        expires_at,
    })
}

pub(super) fn decrypt(
    key: &[u8; 32],
    record_key: &RecordKey,
    record: &EncryptedRecord,
) -> Result<Vec<u8>> {
    let cipher = Aes256Gcm::new_from_slice(key).context("invalid agent encryption key")?;
    let nonce = Nonce::from(record.nonce);
    cipher
        .decrypt(
            &nonce,
            Payload {
                msg: &record.ciphertext,
                aad: &record_key.aad(),
            },
        )
        .map_err(|_| anyhow!("agent state authentication failed"))
}

pub(super) fn encrypt_json(
    key: &[u8; 32],
    aad: &[u8],
    value: &Value,
    expires_at: i64,
) -> Result<EncryptedRecord> {
    let mut plaintext = serde_json::to_vec(value).context("failed to encode graph checkpoint")?;
    let cipher = Aes256Gcm::new_from_slice(key).context("invalid agent encryption key")?;
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from(nonce_bytes);
    let ciphertext = cipher
        .encrypt(
            &nonce,
            Payload {
                msg: &plaintext,
                aad,
            },
        )
        .map_err(|_| anyhow!("failed to encrypt graph checkpoint"))?;
    plaintext.zeroize();
    Ok(EncryptedRecord {
        ciphertext,
        nonce: nonce_bytes,
        expires_at,
    })
}

pub(super) fn decrypt_json(key: &[u8; 32], aad: &[u8], record: &EncryptedRecord) -> Result<Value> {
    let cipher = Aes256Gcm::new_from_slice(key).context("invalid agent encryption key")?;
    let nonce = Nonce::from(record.nonce);
    let mut plaintext = cipher
        .decrypt(
            &nonce,
            Payload {
                msg: &record.ciphertext,
                aad,
            },
        )
        .map_err(|_| anyhow!("graph checkpoint authentication failed"))?;
    let decoded =
        serde_json::from_slice(&plaintext).context("decrypted graph checkpoint is not valid JSON");
    plaintext.zeroize();
    decoded
}
