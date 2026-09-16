use super::{
    audit::{
        write_gateway_certificate_rotation_audit, write_gateway_enrollment_audit,
        write_management_audit,
    },
    crypto::{
        constant_time_equals, digest_enrollment_token, gateway_heartbeat_is_fresh,
        generate_enrollment_token, verify_enrollment_signature, verify_gateway_signature,
    },
    models::{
        ControlPlaneStore, GatewayCertificateRotation, GatewayRegistration,
        GatewayRevocationSnapshot,
    },
    GATEWAY_ENROLLMENT_TTL_MINUTES,
};
use anyhow::{Context, Result};
use oxide_enterprise_contracts::gateway_revocation_snapshot_signing_message;
use sqlx::Row;
use uuid::Uuid;

impl ControlPlaneStore {
    pub async fn register_gateway(
        &self,
        organization_id: Uuid,
        actor_user_id: Uuid,
        display_name: &str,
        direct_endpoint: &str,
        certificate_fingerprint: &str,
        enrollment_public_key: &str,
    ) -> Result<GatewayRegistration> {
        let gateway_id = Uuid::new_v4();
        let enrollment_token = generate_enrollment_token();
        let enrollment_token_hash = digest_enrollment_token(&enrollment_token);
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO gateways
             (id, organization_id, display_name, direct_endpoint, certificate_fingerprint,
              enrollment_public_key, enrollment_token_hash, enrollment_expires_at, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, now() + interval '15 minutes', 'pending')",
        )
        .bind(gateway_id)
        .bind(organization_id)
        .bind(display_name)
        .bind(direct_endpoint)
        .bind(certificate_fingerprint)
        .bind(enrollment_public_key)
        .bind(&enrollment_token_hash)
        .execute(&mut *tx)
        .await?;
        write_management_audit(
            &mut tx,
            organization_id,
            actor_user_id,
            None,
            None,
            &["gateways".into(), gateway_id.to_string()],
            "gateway.register",
            serde_json::json!({
                "displayName": display_name,
                "status": "pending",
                "enrollmentExpiresInMinutes": GATEWAY_ENROLLMENT_TTL_MINUTES,
            }),
        )
        .await?;
        let enrollment_expires_at = sqlx::query_scalar::<_, chrono::DateTime<chrono::Utc>>(
            "SELECT enrollment_expires_at FROM gateways WHERE id = $1",
        )
        .bind(gateway_id)
        .fetch_one(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(GatewayRegistration {
            id: gateway_id,
            enrollment_token,
            enrollment_expires_at,
        })
    }

    pub async fn activate_gateway_enrollment(
        &self,
        gateway_id: Uuid,
        direct_endpoint: &str,
        certificate_fingerprint: &str,
        enrollment_token: Option<&str>,
        enrollment_signature: &str,
    ) -> Result<Uuid> {
        let mut tx = self.pool.begin().await?;
        let gateway = sqlx::query(
            "SELECT organization_id, direct_endpoint, certificate_fingerprint, enrollment_public_key,
                    enrollment_token_hash, enrollment_expires_at, status,
                    pending_certificate_fingerprint, certificate_rotation_token_hash,
                    certificate_rotation_expires_at
             FROM gateways
             WHERE id = $1
             FOR UPDATE",
        )
        .bind(gateway_id)
        .fetch_optional(&mut *tx)
        .await?
        .context("Gateway enrollment is not available")?;
        let organization_id: Uuid = gateway.try_get("organization_id")?;
        let stored_endpoint: String = gateway.try_get("direct_endpoint")?;
        let stored_fingerprint: Option<String> = gateway.try_get("certificate_fingerprint")?;
        let enrollment_public_key: Option<String> = gateway.try_get("enrollment_public_key")?;
        let stored_token_hash: Option<String> = gateway.try_get("enrollment_token_hash")?;
        let expires_at: Option<chrono::DateTime<chrono::Utc>> =
            gateway.try_get("enrollment_expires_at")?;
        let status: String = gateway.try_get("status")?;
        let pending_certificate_fingerprint: Option<String> =
            gateway.try_get("pending_certificate_fingerprint")?;
        let rotation_token_hash: Option<String> =
            gateway.try_get("certificate_rotation_token_hash")?;
        let rotation_expires_at: Option<chrono::DateTime<chrono::Utc>> =
            gateway.try_get("certificate_rotation_expires_at")?;
        let enrollment_token = enrollment_token.unwrap_or_default();
        let identity_proof_valid = verify_enrollment_signature(
            enrollment_public_key.as_deref(),
            enrollment_signature,
            gateway_id,
            direct_endpoint,
            certificate_fingerprint,
            enrollment_token,
        );
        if !matches!(status.as_str(), "pending" | "active")
            || stored_endpoint != direct_endpoint
            || !identity_proof_valid
        {
            anyhow::bail!("Gateway enrollment proof was rejected");
        }
        if status == "active" {
            let rotation_is_pending = pending_certificate_fingerprint.is_some()
                || rotation_token_hash.is_some()
                || rotation_expires_at.is_some();
            if rotation_is_pending {
                let rotation_is_valid = pending_certificate_fingerprint.as_deref()
                    == Some(certificate_fingerprint)
                    && rotation_expires_at.is_some_and(|value| value > chrono::Utc::now())
                    && rotation_token_hash.as_deref().is_some_and(|expected| {
                        constant_time_equals(
                            expected.as_bytes(),
                            digest_enrollment_token(enrollment_token).as_bytes(),
                        )
                    });
                if !rotation_is_valid {
                    anyhow::bail!("Gateway certificate rotation proof was rejected");
                }
                sqlx::query(
                    "UPDATE gateways
                     SET certificate_fingerprint = $2, last_seen_at = now(), activated_at = now(),
                         pending_certificate_fingerprint = NULL,
                         certificate_rotation_token_hash = NULL,
                         certificate_rotation_expires_at = NULL
                     WHERE id = $1 AND status = 'active'",
                )
                .bind(gateway_id)
                .bind(certificate_fingerprint)
                .execute(&mut *tx)
                .await?;
                write_gateway_certificate_rotation_audit(&mut tx, organization_id, gateway_id)
                    .await?;
                tx.commit().await?;
                return Ok(organization_id);
            }
            if !enrollment_token.is_empty()
                || stored_fingerprint.as_deref() != Some(certificate_fingerprint)
            {
                anyhow::bail!("Gateway active identity proof was rejected");
            }
            sqlx::query("UPDATE gateways SET last_seen_at = now() WHERE id = $1")
                .bind(gateway_id)
                .execute(&mut *tx)
                .await?;
            tx.commit().await?;
            return Ok(organization_id);
        }
        if expires_at.is_none_or(|value| value <= chrono::Utc::now())
            || !stored_token_hash.is_some_and(|expected| {
                constant_time_equals(
                    expected.as_bytes(),
                    digest_enrollment_token(enrollment_token).as_bytes(),
                )
            })
        {
            anyhow::bail!("Gateway enrollment token was rejected");
        }
        let updated = sqlx::query(
            "UPDATE gateways
             SET status = 'active', last_seen_at = now(), activated_at = now(),
                 enrollment_token_hash = NULL, enrollment_expires_at = NULL
             WHERE id = $1 AND status = 'pending'",
        )
        .bind(gateway_id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
        if updated != 1 {
            anyhow::bail!("Gateway enrollment is no longer available");
        }
        write_gateway_enrollment_audit(&mut tx, organization_id, gateway_id).await?;
        tx.commit().await?;
        Ok(organization_id)
    }

    pub async fn rotate_gateway_certificate(
        &self,
        organization_id: Uuid,
        actor_user_id: Uuid,
        gateway_id: Uuid,
        certificate_fingerprint: &str,
    ) -> Result<GatewayCertificateRotation> {
        let enrollment_token = generate_enrollment_token();
        let enrollment_token_hash = digest_enrollment_token(&enrollment_token);
        let mut tx = self.pool.begin().await?;
        let current_fingerprint = sqlx::query_scalar::<_, String>(
            "SELECT certificate_fingerprint
             FROM gateways
             WHERE id = $1 AND organization_id = $2 AND status = 'active'
             FOR UPDATE",
        )
        .bind(gateway_id)
        .bind(organization_id)
        .fetch_optional(&mut *tx)
        .await?
        .context("Gateway is not active in this organization")?;
        if current_fingerprint == certificate_fingerprint {
            anyhow::bail!(
                "Gateway certificate rotation requires a different certificate fingerprint"
            );
        }
        let rotation_expires_at = sqlx::query_scalar::<_, chrono::DateTime<chrono::Utc>>(
            "UPDATE gateways
             SET pending_certificate_fingerprint = $3,
                 certificate_rotation_token_hash = $4,
                 certificate_rotation_expires_at = now() + interval '15 minutes'
             WHERE id = $1 AND organization_id = $2
             RETURNING certificate_rotation_expires_at",
        )
        .bind(gateway_id)
        .bind(organization_id)
        .bind(certificate_fingerprint)
        .bind(&enrollment_token_hash)
        .fetch_one(&mut *tx)
        .await?;
        write_management_audit(
            &mut tx,
            organization_id,
            actor_user_id,
            None,
            None,
            &[
                "gateways".into(),
                gateway_id.to_string(),
                "certificate-rotation".into(),
            ],
            "gateway.certificate-rotation.request",
            serde_json::json!({
                "previousCertificateFingerprint": current_fingerprint,
                "pendingCertificateFingerprint": certificate_fingerprint,
                "expiresAt": rotation_expires_at,
            }),
        )
        .await?;
        tx.commit().await?;
        Ok(GatewayCertificateRotation {
            enrollment_token,
            enrollment_expires_at: rotation_expires_at,
        })
    }

    pub async fn gateway_revocation_snapshot(
        &self,
        gateway_id: Uuid,
        direct_endpoint: &str,
        certificate_fingerprint: &str,
        request_signature: &str,
    ) -> Result<GatewayRevocationSnapshot> {
        let mut tx = self.pool.begin().await?;
        let gateway = sqlx::query(
            "SELECT organization_id, direct_endpoint, certificate_fingerprint,
                    enrollment_public_key, status
             FROM gateways
             WHERE id = $1
             FOR UPDATE",
        )
        .bind(gateway_id)
        .fetch_optional(&mut *tx)
        .await?
        .context("Gateway revocation feed is not available")?;
        let organization_id: Uuid = gateway.try_get("organization_id")?;
        let stored_endpoint: String = gateway.try_get("direct_endpoint")?;
        let stored_fingerprint: Option<String> = gateway.try_get("certificate_fingerprint")?;
        let enrollment_public_key: Option<String> = gateway.try_get("enrollment_public_key")?;
        let status: String = gateway.try_get("status")?;
        let proof = gateway_revocation_snapshot_signing_message(
            gateway_id,
            direct_endpoint,
            certificate_fingerprint,
        );
        if status != "active"
            || stored_endpoint != direct_endpoint
            || stored_fingerprint.as_deref() != Some(certificate_fingerprint)
            || !verify_gateway_signature(
                enrollment_public_key.as_deref(),
                request_signature,
                &proof,
            )
        {
            anyhow::bail!("Gateway revocation feed proof was rejected");
        }
        sqlx::query("UPDATE gateways SET last_seen_at = now() WHERE id = $1")
            .bind(gateway_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            "DELETE FROM revoked_access_nonces
             WHERE organization_id = $1 AND expires_at <= now()",
        )
        .bind(organization_id)
        .execute(&mut *tx)
        .await?;
        let fingerprints = sqlx::query_scalar::<_, String>(
            "SELECT certificate_fingerprint
             FROM (
                SELECT d.certificate_fingerprint
                FROM managed_devices d
                JOIN organization_memberships m
                  ON m.organization_id = d.organization_id AND m.user_id = d.user_id
                WHERE d.organization_id = $1
                  AND (d.status = 'revoked' OR m.status <> 'active')
                UNION
                SELECT r.certificate_fingerprint
                FROM retired_device_certificates r
                WHERE r.organization_id = $1
             ) revoked_certificates
             ORDER BY certificate_fingerprint",
        )
        .bind(organization_id)
        .fetch_all(&mut *tx)
        .await?;
        let nonces = sqlx::query_scalar::<_, Uuid>(
            "SELECT nonce FROM revoked_access_nonces
             WHERE organization_id = $1 AND expires_at > now()
             ORDER BY expires_at, nonce",
        )
        .bind(organization_id)
        .fetch_all(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(GatewayRevocationSnapshot {
            revoked_device_certificate_fingerprints: fingerprints,
            revoked_access_nonces: nonces,
        })
    }

    pub async fn revoke_gateway(
        &self,
        organization_id: Uuid,
        actor_user_id: Uuid,
        gateway_id: Uuid,
    ) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        let result = sqlx::query(
            "UPDATE gateways
             SET status = 'revoked'
             WHERE id = $1 AND organization_id = $2 AND status IN ('pending', 'active')",
        )
        .bind(gateway_id)
        .bind(organization_id)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() != 1 {
            anyhow::bail!("Gateway is not active or pending in this organization");
        }
        write_management_audit(
            &mut tx,
            organization_id,
            actor_user_id,
            None,
            None,
            &["gateways".into(), gateway_id.to_string()],
            "gateway.revoke",
            serde_json::json!({}),
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn gateway_for_source(
        &self,
        organization_id: Uuid,
        project_id: Uuid,
        data_source_id: Uuid,
    ) -> Result<(Uuid, String, String, String, String)> {
        let row = sqlx::query(
            "SELECT d.gateway_id, d.policy_revision, d.driver, d.target_binding, g.direct_endpoint, g.last_seen_at
             FROM data_sources d
             JOIN gateways g ON g.id = d.gateway_id
             WHERE d.id = $1 AND d.organization_id = $2 AND d.project_id = $3
               AND g.status = 'active'",
        )
        .bind(data_source_id)
        .bind(organization_id)
        .bind(project_id)
        .fetch_optional(&self.pool)
        .await?
        .context("managed data source is not available")?;
        let last_seen_at: Option<chrono::DateTime<chrono::Utc>> = row.try_get("last_seen_at")?;
        if !gateway_heartbeat_is_fresh(last_seen_at, chrono::Utc::now()) {
            anyhow::bail!(
                "Gateway signed heartbeat is stale; new access tickets are temporarily unavailable"
            );
        }
        let target_binding: Option<String> = row.try_get("target_binding")?;
        let target_binding = target_binding.context(
            "managed data source requires a target binding renewal before issuing access tickets",
        )?;
        Ok((
            row.try_get("gateway_id")?,
            row.try_get("direct_endpoint")?,
            row.try_get("policy_revision")?,
            row.try_get("driver")?,
            target_binding,
        ))
    }
}
