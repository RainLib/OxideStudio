use super::{
    audit::write_management_audit, crypto::rotated_device_certificate, models::ControlPlaneStore,
};
use anyhow::{Context, Result};
use uuid::Uuid;

impl ControlPlaneStore {
    pub async fn require_active_device_certificate(
        &self,
        user_id: Uuid,
        organization_id: Uuid,
        device_id: Uuid,
        certificate_fingerprint: &str,
    ) -> Result<()> {
        let enrolled: bool = sqlx::query_scalar(
            "SELECT EXISTS (
               SELECT 1
               FROM managed_devices
               WHERE organization_id = $1 AND user_id = $2 AND device_id = $3
                 AND certificate_fingerprint = $4 AND status = 'active'
             )",
        )
        .bind(organization_id)
        .bind(user_id)
        .bind(device_id)
        .bind(certificate_fingerprint)
        .fetch_one(&self.pool)
        .await?;
        if !enrolled {
            anyhow::bail!("managed device certificate is not enrolled");
        }
        Ok(())
    }

    pub async fn require_minimum_desktop_version(
        &self,
        organization_id: Uuid,
        desktop_version: &semver::Version,
    ) -> Result<()> {
        let minimum = sqlx::query_scalar::<_, String>(
            "SELECT minimum_desktop_version FROM organizations WHERE id = $1",
        )
        .bind(organization_id)
        .fetch_optional(&self.pool)
        .await?
        .context("organization is not available")?;
        let minimum = semver::Version::parse(&minimum)
            .context("organization minimum desktop version is invalid")?;
        if desktop_version < &minimum {
            anyhow::bail!("desktop version is below the organization minimum");
        }
        Ok(())
    }

    pub async fn register_managed_device(
        &self,
        organization_id: Uuid,
        actor_user_id: Uuid,
        user_id: Uuid,
        device_id: Uuid,
        certificate_fingerprint: &str,
        display_name: Option<&str>,
    ) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        let member: bool = sqlx::query_scalar(
            "SELECT EXISTS (
               SELECT 1 FROM organization_memberships
               WHERE organization_id = $1 AND user_id = $2 AND status = 'active'
             )",
        )
        .bind(organization_id)
        .bind(user_id)
        .fetch_one(&mut *tx)
        .await?;
        if !member {
            anyhow::bail!("device owner is not an active organization member");
        }
        let retired: bool = sqlx::query_scalar(
            "SELECT EXISTS (
               SELECT 1 FROM retired_device_certificates
               WHERE organization_id = $1 AND certificate_fingerprint = $2
             )",
        )
        .bind(organization_id)
        .bind(certificate_fingerprint)
        .fetch_one(&mut *tx)
        .await?;
        if retired {
            anyhow::bail!(
                "a rotated or revoked device certificate cannot be enrolled again; issue a new certificate"
            );
        }
        let previous_certificate_fingerprint = sqlx::query_scalar::<_, String>(
            "SELECT certificate_fingerprint
             FROM managed_devices
             WHERE organization_id = $1 AND user_id = $2 AND device_id = $3
             FOR UPDATE",
        )
        .bind(organization_id)
        .bind(user_id)
        .bind(device_id)
        .fetch_optional(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO managed_devices
             (organization_id, user_id, device_id, certificate_fingerprint, display_name, enrolled_by)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (organization_id, user_id, device_id)
             DO UPDATE SET certificate_fingerprint = EXCLUDED.certificate_fingerprint,
                           display_name = EXCLUDED.display_name,
                           status = 'active', revoked_at = NULL,
                           enrolled_by = EXCLUDED.enrolled_by, enrolled_at = now()",
        )
        .bind(organization_id)
        .bind(user_id)
        .bind(device_id)
        .bind(certificate_fingerprint)
        .bind(display_name)
        .bind(actor_user_id)
        .execute(&mut *tx)
        .await?;
        let rotated_certificate_fingerprint = rotated_device_certificate(
            previous_certificate_fingerprint.as_deref(),
            certificate_fingerprint,
        );
        if let Some(previous_certificate_fingerprint) = rotated_certificate_fingerprint {
            sqlx::query(
                "INSERT INTO retired_device_certificates
                 (organization_id, certificate_fingerprint, reason)
                 VALUES ($1, $2, 'certificate_rotated')
                 ON CONFLICT (organization_id, certificate_fingerprint) DO NOTHING",
            )
            .bind(organization_id)
            .bind(previous_certificate_fingerprint)
            .execute(&mut *tx)
            .await?;
        }
        write_management_audit(
            &mut tx,
            organization_id,
            actor_user_id,
            None,
            None,
            &["managed-devices".into(), device_id.to_string()],
            if rotated_certificate_fingerprint.is_some() {
                "managed-device.certificate-rotate"
            } else {
                "managed-device.enroll"
            },
            serde_json::json!({
                "principalId": user_id,
                "certificateFingerprint": certificate_fingerprint,
                "replacedCertificateFingerprint": rotated_certificate_fingerprint,
            }),
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn revoke_managed_device(
        &self,
        organization_id: Uuid,
        actor_user_id: Uuid,
        user_id: Uuid,
        device_id: Uuid,
    ) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        let certificate_fingerprint = sqlx::query_scalar::<_, String>(
            "UPDATE managed_devices
             SET status = 'revoked', revoked_at = now()
             WHERE organization_id = $1 AND user_id = $2 AND device_id = $3
               AND status = 'active'
             RETURNING certificate_fingerprint",
        )
        .bind(organization_id)
        .bind(user_id)
        .bind(device_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(certificate_fingerprint) = certificate_fingerprint else {
            anyhow::bail!("managed device is not active or does not belong to this organization");
        };
        sqlx::query(
            "INSERT INTO retired_device_certificates
             (organization_id, certificate_fingerprint, reason)
             VALUES ($1, $2, 'device_revoked')
             ON CONFLICT (organization_id, certificate_fingerprint) DO NOTHING",
        )
        .bind(organization_id)
        .bind(&certificate_fingerprint)
        .execute(&mut *tx)
        .await?;
        write_management_audit(
            &mut tx,
            organization_id,
            actor_user_id,
            None,
            None,
            &["managed-devices".into(), device_id.to_string()],
            "managed-device.revoke",
            serde_json::json!({
                "principalId": user_id,
                "certificateFingerprint": certificate_fingerprint,
            }),
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }
}
