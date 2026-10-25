use super::*;
use crate::core::transfer_jobs::models::SealedConfig;
use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::Value;

impl JobStore {
    fn sealing_key(&self, domain: &[u8]) -> Result<Zeroizing<[u8; 32]>> {
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(self.key.as_ref().as_ref())
            .map_err(|_| anyhow!("invalid transfer encryption key"))?;
        mac.update(domain);
        Ok(Zeroizing::new(mac.finalize().into_bytes().into()))
    }
    pub(in crate::core::transfer_jobs) fn seal_target(
        &self,
        id: &str,
        project: &str,
        value: &Value,
    ) -> Result<SealedConfig> {
        self.seal_context(
            id,
            project,
            value,
            b"oxide-large-transfer-v2\0postgres-target-encryption-key",
            "postgres-target-v2",
        )
    }
    pub(in crate::core::transfer_jobs) fn seal_mysql_target(
        &self,
        id: &str,
        project: &str,
        value: &Value,
    ) -> Result<SealedConfig> {
        self.seal_context(
            id,
            project,
            value,
            b"oxide-large-transfer-v3\0mysql-target-encryption-key",
            "mysql-target-v3",
        )
    }
    fn seal_context(
        &self,
        id: &str,
        project: &str,
        value: &Value,
        domain: &[u8],
        context: &str,
    ) -> Result<SealedConfig> {
        let body = Zeroizing::new(serde_json::to_vec(value)?);
        if body.len() > 64 * 1024 {
            bail!("migration connection exceeds its private record budget");
        }
        let key = self.sealing_key(domain)?;
        let cipher = Aes256Gcm::new_from_slice(key.as_ref())
            .map_err(|_| anyhow!("invalid transfer encryption key"))?;
        let mut nonce = [0; 12];
        OsRng.fill_bytes(&mut nonce);
        let aad = serde_json::to_vec(&(id, project, context))?;
        let encrypted = cipher
            .encrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: &body,
                    aad: &aad,
                },
            )
            .map_err(|_| anyhow!("failed to protect migration connection"))?;
        Ok(SealedConfig {
            nonce: STANDARD.encode(nonce),
            body: STANDARD.encode(encrypted),
        })
    }
    pub(in crate::core::transfer_jobs) fn unseal_target(
        &self,
        id: &str,
        project: &str,
        value: &SealedConfig,
    ) -> Result<Value> {
        self.unseal_context(
            id,
            project,
            value,
            b"oxide-large-transfer-v2\0postgres-target-encryption-key",
            "postgres-target-v2",
        )
    }
    pub(in crate::core::transfer_jobs) fn unseal_mysql_target(
        &self,
        id: &str,
        project: &str,
        value: &SealedConfig,
    ) -> Result<Value> {
        self.unseal_context(
            id,
            project,
            value,
            b"oxide-large-transfer-v3\0mysql-target-encryption-key",
            "mysql-target-v3",
        )
    }
    fn unseal_context(
        &self,
        id: &str,
        project: &str,
        value: &SealedConfig,
        domain: &[u8],
        context: &str,
    ) -> Result<Value> {
        if value.nonce.len() != 16 || value.body.len() > 90_000 {
            bail!("invalid protected migration connection");
        }
        let nonce = STANDARD.decode(&value.nonce)?;
        if nonce.len() != 12 {
            bail!("invalid protected migration nonce");
        }
        let encrypted = STANDARD.decode(&value.body)?;
        let key = self.sealing_key(domain)?;
        let cipher = Aes256Gcm::new_from_slice(key.as_ref())
            .map_err(|_| anyhow!("invalid transfer encryption key"))?;
        let aad = serde_json::to_vec(&(id, project, context))?;
        let body = Zeroizing::new(
            cipher
                .decrypt(
                    Nonce::from_slice(&nonce),
                    Payload {
                        msg: &encrypted,
                        aad: &aad,
                    },
                )
                .map_err(|_| anyhow!("protected migration connection authentication failed"))?,
        );
        Ok(serde_json::from_slice(&body)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn mysql_target_encryption_is_separated_from_postgres() -> Result<()> {
        let root = tempfile::tempdir()?;
        let store = JobStore::open(root.path()).await?;
        let config = serde_json::json!({"url":"mysql://user:private@127.0.0.1/test"});
        let mysql = store.seal_mysql_target("job", "project", &config)?;
        let postgres = store.seal_target("job", "project", &config)?;
        assert_eq!(store.unseal_mysql_target("job", "project", &mysql)?, config);
        assert!(store.unseal_target("job", "project", &mysql).is_err());
        assert!(store
            .unseal_mysql_target("job", "project", &postgres)
            .is_err());
        assert!(store
            .unseal_mysql_target("other", "project", &mysql)
            .is_err());
        assert!(store.unseal_mysql_target("job", "other", &mysql).is_err());
        let reopened = JobStore::open(root.path()).await?;
        assert_eq!(
            reopened.unseal_mysql_target("job", "project", &mysql)?,
            config
        );
        assert_eq!(reopened.unseal_target("job", "project", &postgres)?, config);
        Ok(())
    }
    use crate::core::transfer_jobs::models::StoredJob;
    #[tokio::test]
    async fn sealed_target_survives_reopen_and_rejects_another_job_or_project() -> Result<()> {
        let root = tempfile::tempdir()?;
        let store = JobStore::open(root.path()).await?;
        let config = serde_json::json!({"driver":"postgres","url":"postgresql://writer:fixture-long-private-password@127.0.0.1:5432/fixture"});
        let sealed = store.seal_target("job-a", "project-a", &config)?;
        assert!(!serde_json::to_string(&sealed)?.contains(config["url"].as_str().unwrap()));
        assert_eq!(store.unseal_target("job-a", "project-a", &sealed)?, config);
        assert!(store.unseal_target("job-b", "project-a", &sealed).is_err());
        assert!(store.unseal_target("job-a", "project-b", &sealed).is_err());
        let reopened = JobStore::open(root.path()).await?;
        assert_eq!(
            reopened.unseal_target("job-a", "project-a", &sealed)?,
            config
        );
        let mut corrupted = sealed.clone();
        corrupted.body.replace_range(
            0..1,
            if corrupted.body.starts_with('A') {
                "B"
            } else {
                "A"
            },
        );
        assert!(reopened
            .unseal_target("job-a", "project-a", &corrupted)
            .is_err());
        Ok(())
    }
    #[tokio::test]
    async fn legacy_v1_job_body_and_signature_remain_readable() -> Result<()> {
        let endpoint = r#"{"connectionId":"source","driver":"sqlite","schema":"main","table":"items","database":null}"#;
        let summary = format!(
            r#"{{"id":"00000000-0000-4000-8000-000000000001","projectId":"p","source":{endpoint},"target":{endpoint},"mode":"append","phase":"awaitingReview","sourceRows":1,"rowsStaged":0,"batches":0,"snapshotBytes":4096,"reviewReady":true,"createdAt":1,"updatedAt":1,"issue":null}}"#
        );
        let request = format!(
            r#"{{"projectId":"p","source":{endpoint},"target":{endpoint},"mode":"append","batchRows":500}}"#
        );
        // The exact pre-v2 serialization order is authenticated as raw bytes.
        let legacy = format!(
            r#"{{"version":1,"summary":{summary},"request":{request},"source_file":{{"path":"/fixture/source.sqlite","volume":1,"index":2}},"target_file":{{"path":"/fixture/target.sqlite","volume":1,"index":3}},"source_binding":"source","target_binding":"target","snapshot_digest":"snapshot","target_schema_digest":"schema","target_data_digest":"data","target_rows_before":0,"columns":[{{"source":"id","target":"id","sourceType":"INTEGER","targetType":"INTEGER"}}],"skipped_columns":[],"keys":[{{"column":"id","collation":"BINARY","rowid":false}}],"target_keys":["id"],"confirmation_token":"MIGRATE OLD","plan_digest":"old-plan","receipt_table":"old-receipt","stage_table":"old-stage","sequence_column":"old-sequence"}}"#
        );
        let root = tempfile::tempdir()?;
        let store = JobStore::open(root.path()).await?;
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(store.key.as_ref().as_ref()).unwrap();
        mac.update(b"oxide-large-transfer-v1\0job\0");
        mac.update(legacy.as_bytes());
        let signature = hex_bytes(&mac.finalize().into_bytes());
        let restored: StoredJob = store.decode("job", &legacy, &signature)?;
        assert_eq!(serde_json::to_string(&restored)?, legacy);
        restored.validate_version()?;
        sqlx::query("INSERT INTO jobs(id,project_id,body,mac,updated_at) VALUES(?,?,?,?,1)")
            .bind(&restored.summary.id)
            .bind("p")
            .bind(&legacy)
            .bind(signature)
            .execute(&store.pool)
            .await?;
        assert_eq!(
            store
                .load("p", &restored.summary.id)
                .await?
                .confirmation_token,
            "MIGRATE OLD"
        );
        let mut invalid = restored;
        invalid.version = 2;
        assert!(invalid.validate_version().is_err());
        Ok(())
    }
}
