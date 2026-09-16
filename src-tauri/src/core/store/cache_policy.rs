use super::models::CLI_CAPABILITY_CACHE_KEY_HEX_LENGTH;
use anyhow::Result;
use hmac::Hmac;
use hmac::Mac;
use sha2::Sha256;

pub(super) fn update_cache_mac_component(mac: &mut Hmac<Sha256>, name: &str, value: &str) {
    for bytes in [name.as_bytes(), value.as_bytes()] {
        mac.update(&(bytes.len() as u64).to_be_bytes());
        mac.update(bytes);
    }
}

pub(super) fn validate_cli_capability_cache_identity(
    cache_key: &str,
    resource_kind: &str,
) -> Result<()> {
    if cache_key.len() != CLI_CAPABILITY_CACHE_KEY_HEX_LENGTH
        || !cache_key
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        anyhow::bail!("CLI capability cache key is invalid");
    }
    if !matches!(resource_kind, "models" | "commands" | "efforts") {
        anyhow::bail!("CLI capability cache resource kind is invalid");
    }
    Ok(())
}
