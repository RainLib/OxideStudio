use super::credential_crypto::{
    config_contains_plaintext_credentials, connection_credential_aad, extract_ssh_tunnel_secrets,
    restore_ssh_tunnel_secrets, ProtectedConnectionCredentials,
};
use super::models::{MetaStore, SavedConnection};
use aes_gcm::aead::Aead;
use aes_gcm::aead::Payload;
use aes_gcm::KeyInit;
use aes_gcm::{Aes256Gcm, Nonce};
use anyhow::Context;
use anyhow::{anyhow, Result};
use rand::rngs::OsRng;
use rand::RngCore;
use sqlx::Row;
use sqlx::Sqlite;
use zeroize::Zeroize;

impl MetaStore {
    pub async fn save_connection(&self, conn: &SavedConnection) -> Result<()> {
        let (safe_config, protected_credentials) =
            self.protect_connection_config(&conn.project_id, &conn.id, &conn.config)?;
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            r#"
            INSERT INTO connections (id, project_id, name, driver, config, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                project_id = excluded.project_id,
                name = excluded.name,
                driver = excluded.driver,
                config = excluded.config,
                updated_at = excluded.updated_at
            "#,
        )
        .bind(&conn.id)
        .bind(&conn.project_id)
        .bind(&conn.name)
        .bind(&conn.driver)
        .bind(&safe_config)
        .bind(conn.created_at)
        .bind(conn.updated_at)
        .execute(&mut *tx)
        .await?;
        self.save_protected_credentials(
            &mut tx,
            &conn.project_id,
            &conn.id,
            protected_credentials,
            conn.updated_at,
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn replace_connections(
        &self,
        project_id: &str,
        connections: &[SavedConnection],
    ) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM connections WHERE project_id = ?")
            .bind(project_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM connection_credentials WHERE project_id = ?")
            .bind(project_id)
            .execute(&mut *tx)
            .await?;

        for conn in connections {
            let scoped_project_id = if conn.project_id.is_empty() {
                project_id
            } else {
                conn.project_id.as_str()
            };
            let (safe_config, protected_credentials) =
                self.protect_connection_config(scoped_project_id, &conn.id, &conn.config)?;
            sqlx::query(
                r#"
                INSERT INTO connections (id, project_id, name, driver, config, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    project_id = excluded.project_id,
                    name = excluded.name,
                    driver = excluded.driver,
                    config = excluded.config,
                    updated_at = excluded.updated_at
                "#,
            )
            .bind(&conn.id)
            .bind(scoped_project_id)
            .bind(&conn.name)
            .bind(&conn.driver)
            .bind(&safe_config)
            .bind(conn.created_at)
            .bind(conn.updated_at)
            .execute(&mut *tx)
            .await?;
            self.save_protected_credentials(
                &mut tx,
                scoped_project_id,
                &conn.id,
                protected_credentials,
                conn.updated_at,
            )
            .await?;
        }

        tx.commit().await?;
        Ok(())
    }

    /// Read only the package pin needed by driver-cache retention. This query
    /// deliberately does not join or decrypt the credential table.
    pub async fn pinned_driver_packages(&self) -> Result<Vec<(String, String)>> {
        let records = sqlx::query("SELECT driver, config FROM connections")
            .fetch_all(&self.pool)
            .await?;
        let mut packages = Vec::new();
        for record in records {
            let driver: String = record.get("driver");
            let config: serde_json::Value = record.get("config");
            let Some(version) = config
                .get("driverPackageVersion")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            else {
                continue;
            };
            let driver = driver.trim();
            if !driver.is_empty() {
                packages.push((driver.to_string(), version.to_string()));
            }
        }
        Ok(packages)
    }

    pub async fn get_connections(&self, project_id: &str) -> Result<Vec<SavedConnection>> {
        let recs = sqlx::query(
            "SELECT c.*, s.ciphertext AS secret_ciphertext, s.nonce AS secret_nonce
             FROM connections c
             LEFT JOIN connection_credentials s
               ON s.project_id = c.project_id AND s.connection_id = c.id
             WHERE c.project_id = ? ORDER BY c.name",
        )
        .bind(project_id)
        .fetch_all(&self.pool)
        .await?;

        let mut connections = Vec::new();
        let mut legacy_plaintext = Vec::new();
        for rec in recs {
            let id: String = rec.get("id");
            let mut config: serde_json::Value = rec.get("config");
            let ciphertext = rec.try_get::<Option<Vec<u8>>, _>("secret_ciphertext")?;
            let nonce = rec.try_get::<Option<Vec<u8>>, _>("secret_nonce")?;
            let protected = ciphertext.is_some() && nonce.is_some();
            match (ciphertext, nonce) {
                (Some(ciphertext), Some(nonce)) => {
                    self.restore_connection_config(
                        project_id,
                        &id,
                        &mut config,
                        &ciphertext,
                        &nonce,
                    )?;
                }
                (None, None) => {}
                _ => anyhow::bail!("stored local connection credential record is incomplete"),
            }
            let connection = SavedConnection {
                id,
                project_id: rec.get("project_id"),
                name: rec.get("name"),
                driver: rec.get("driver"),
                config,
                created_at: rec.get("created_at"),
                updated_at: rec.get("updated_at"),
            };
            if !protected && config_contains_plaintext_credentials(&connection.config) {
                legacy_plaintext.push(connection.clone());
            }
            connections.push(connection);
        }
        for connection in legacy_plaintext {
            self.save_connection(&connection).await?;
        }
        Ok(connections)
    }

    pub async fn delete_connection(&self, project_id: &str, id: &str) -> Result<()> {
        sqlx::query("DELETE FROM connections WHERE project_id = ? AND id = ?")
            .bind(project_id)
            .bind(id)
            .execute(&self.pool)
            .await?;
        sqlx::query(
            "DELETE FROM connection_credentials WHERE project_id = ? AND connection_id = ?",
        )
        .bind(project_id)
        .bind(id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub(super) fn protect_connection_config(
        &self,
        project_id: &str,
        connection_id: &str,
        config: &serde_json::Value,
    ) -> Result<(serde_json::Value, Option<ProtectedConnectionCredentials>)> {
        let mut safe = config.clone();
        let Some(object) = safe.as_object_mut() else {
            return Ok((safe, None));
        };
        let mut secrets = serde_json::Map::new();
        for key in ["url", "connectionUrl", "password"] {
            if let Some(value) = object.remove(key) {
                if !value.is_null() && value.as_str().is_none_or(|text| !text.is_empty()) {
                    secrets.insert(key.to_string(), value);
                }
            }
        }
        object.insert("url".into(), serde_json::Value::String(String::new()));
        if let Some(tunnel) = object
            .get_mut("sshTunnel")
            .and_then(serde_json::Value::as_object_mut)
        {
            let tunnel_secrets = extract_ssh_tunnel_secrets(tunnel);
            if !tunnel_secrets.is_empty() {
                secrets.insert(
                    "sshTunnel".into(),
                    serde_json::Value::Object(tunnel_secrets),
                );
            }
        }
        if secrets.is_empty() {
            return Ok((safe, None));
        }
        let mut plaintext = serde_json::to_vec(&secrets)?;
        let cipher = Aes256Gcm::new_from_slice(self.credential_key.as_ref())
            .context("invalid local credential key")?;
        let mut nonce_bytes = [0_u8; 12];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from(nonce_bytes);
        let ciphertext = cipher
            .encrypt(
                &nonce,
                Payload {
                    msg: &plaintext,
                    aad: &connection_credential_aad(project_id, connection_id),
                },
            )
            .map_err(|_| anyhow!("failed to protect local connection credentials"))?;
        plaintext.zeroize();
        Ok((
            safe,
            Some(ProtectedConnectionCredentials {
                ciphertext,
                nonce: nonce_bytes,
            }),
        ))
    }

    pub(super) fn restore_connection_config(
        &self,
        project_id: &str,
        connection_id: &str,
        config: &mut serde_json::Value,
        ciphertext: &[u8],
        nonce: &[u8],
    ) -> Result<()> {
        let nonce_bytes: [u8; 12] = nonce
            .try_into()
            .map_err(|_| anyhow!("local connection credential nonce is invalid"))?;
        let cipher = Aes256Gcm::new_from_slice(self.credential_key.as_ref())
            .context("invalid local credential key")?;
        let nonce = Nonce::from(nonce_bytes);
        let mut plaintext = cipher
            .decrypt(
                &nonce,
                Payload {
                    msg: ciphertext,
                    aad: &connection_credential_aad(project_id, connection_id),
                },
            )
            .map_err(|_| anyhow!("local connection credentials could not be authenticated"))?;
        let secrets: serde_json::Map<String, serde_json::Value> =
            serde_json::from_slice(&plaintext)
                .context("local connection credentials are invalid")?;
        plaintext.zeroize();
        let object = config
            .as_object_mut()
            .context("stored local connection config is invalid")?;
        for (key, value) in secrets {
            if key == "sshTunnel" {
                let tunnel = object
                    .entry("sshTunnel")
                    .or_insert_with(|| serde_json::json!({}))
                    .as_object_mut()
                    .context("stored SSH tunnel config is invalid")?;
                if let Some(values) = value.as_object() {
                    restore_ssh_tunnel_secrets(tunnel, values);
                }
            } else {
                object.insert(key, value);
            }
        }
        Ok(())
    }

    pub(super) async fn save_protected_credentials(
        &self,
        transaction: &mut sqlx::Transaction<'_, Sqlite>,
        project_id: &str,
        connection_id: &str,
        protected: Option<ProtectedConnectionCredentials>,
        updated_at: i64,
    ) -> Result<()> {
        if let Some(protected) = protected {
            sqlx::query(
                "INSERT INTO connection_credentials
                 (project_id, connection_id, ciphertext, nonce, updated_at)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(project_id, connection_id) DO UPDATE SET
                   ciphertext = excluded.ciphertext,
                   nonce = excluded.nonce,
                   updated_at = excluded.updated_at",
            )
            .bind(project_id)
            .bind(connection_id)
            .bind(protected.ciphertext)
            .bind(protected.nonce.to_vec())
            .bind(updated_at)
            .execute(&mut **transaction)
            .await?;
        } else {
            sqlx::query(
                "DELETE FROM connection_credentials
                 WHERE project_id = ? AND connection_id = ?",
            )
            .bind(project_id)
            .bind(connection_id)
            .execute(&mut **transaction)
            .await?;
        }
        Ok(())
    }
}
