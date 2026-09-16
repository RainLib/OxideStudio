use super::cache_policy::{update_cache_mac_component, validate_cli_capability_cache_identity};
use super::models::{
    current_timestamp_millis, MetaStore, CLI_CAPABILITY_CACHE_KEY_HEX_LENGTH,
    CLI_CAPABILITY_CACHE_MAX_PAYLOAD_BYTES, CLI_CAPABILITY_CACHE_RETENTION_MS,
};
use anyhow::Context;
use anyhow::{anyhow, Result};
use hmac::Hmac;
use hmac::Mac;
use sha2::Sha256;

impl MetaStore {
    /// Derive a stable local-only cache key without exposing the key material
    /// or any identity component to SQLite. Each named component is
    /// length-delimited before authentication so concatenation is unambiguous.
    pub fn opaque_cache_key<'a, I>(&self, namespace: &str, components: I) -> Result<String>
    where
        I: IntoIterator<Item = (&'a str, &'a str)>,
    {
        if namespace.is_empty() || namespace.len() > 128 {
            anyhow::bail!("cache key namespace is invalid");
        }
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(self.credential_key.as_ref())
            .map_err(|_| anyhow!("local cache key material is invalid"))?;
        update_cache_mac_component(&mut mac, "namespace", namespace);
        for (name, value) in components {
            if name.is_empty() || name.len() > 128 {
                anyhow::bail!("cache key component name is invalid");
            }
            update_cache_mac_component(&mut mac, name, value);
        }
        let digest = mac.finalize().into_bytes();
        let mut encoded = String::with_capacity(CLI_CAPABILITY_CACHE_KEY_HEX_LENGTH);
        for byte in digest {
            use std::fmt::Write as _;
            write!(&mut encoded, "{byte:02x}").expect("writing to a String cannot fail");
        }
        Ok(encoded)
    }

    /// Return only a fresh, correctly typed entry. Callers deliberately treat
    /// any storage or JSON error as a cache miss and perform live discovery.
    pub async fn get_cli_capability_cache(
        &self,
        cache_key: &str,
        resource_kind: &str,
        now_ms: i64,
    ) -> Result<Option<serde_json::Value>> {
        validate_cli_capability_cache_identity(cache_key, resource_kind)?;
        let payload = sqlx::query_scalar::<_, String>(
            r#"
            SELECT payload
            FROM cli_capability_cache
            WHERE cache_key = ? AND resource_kind = ? AND expires_at > ?
            "#,
        )
        .bind(cache_key)
        .bind(resource_kind)
        .bind(now_ms)
        .fetch_optional(&self.pool)
        .await?;
        payload
            .map(|payload| serde_json::from_str(&payload).context("invalid CLI capability cache"))
            .transpose()
    }

    /// Atomically replace an entry after successful live discovery. Failed
    /// refreshes never call this method, leaving the last-known-good row intact.
    pub async fn save_cli_capability_cache(
        &self,
        cache_key: &str,
        resource_kind: &str,
        payload: &serde_json::Value,
        expires_at: i64,
    ) -> Result<()> {
        validate_cli_capability_cache_identity(cache_key, resource_kind)?;
        let now = current_timestamp_millis();
        if expires_at <= now {
            anyhow::bail!("CLI capability cache expiry must be in the future");
        }
        let payload = serde_json::to_string(payload)?;
        if payload.len() > CLI_CAPABILITY_CACHE_MAX_PAYLOAD_BYTES {
            anyhow::bail!("CLI capability cache payload exceeds its limit");
        }

        let mut tx = self.pool.begin().await?;
        sqlx::query(
            r#"
            INSERT INTO cli_capability_cache
                (cache_key, resource_kind, payload, updated_at, expires_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(cache_key) DO UPDATE SET
                resource_kind = excluded.resource_kind,
                payload = excluded.payload,
                updated_at = excluded.updated_at,
                expires_at = excluded.expires_at
            "#,
        )
        .bind(cache_key)
        .bind(resource_kind)
        .bind(payload)
        .bind(now)
        .bind(expires_at)
        .execute(&mut *tx)
        .await?;
        sqlx::query("DELETE FROM cli_capability_cache WHERE expires_at < ?")
            .bind(now.saturating_sub(CLI_CAPABILITY_CACHE_RETENTION_MS))
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(())
    }
}
