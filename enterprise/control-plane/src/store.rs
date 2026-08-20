use crate::auth::AuthenticatedIdentity;
use anyhow::{Context, Result};
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use oxide_enterprise_contracts::{
    gateway_enrollment_signing_message, gateway_revocation_snapshot_signing_message, AccessAction,
    AccessGrant, AuthorizationRequest, GrantEffect, ManagedDataSourceDescriptor, ManagedProject,
    MembershipStatus, OrganizationMembership, OrganizationSummary, PolicyEvaluator, User,
};
use rand::RngCore;
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction};
use std::collections::{BTreeSet, HashMap};
use uuid::Uuid;

const GATEWAY_ENROLLMENT_TTL_MINUTES: i64 = 15;
/// Gate new desktop tickets on the Gateway's signed revocation-feed heartbeat.
///
/// Gateways refresh the feed every five seconds and fail their own data plane
/// closed after twenty seconds without a successful refresh. The control plane
/// uses a slightly larger window so short scheduling or network jitter does not
/// interrupt healthy clients, while an offline Gateway cannot receive fresh
/// tickets indefinitely.
const GATEWAY_TICKET_HEARTBEAT_MAX_AGE_SECONDS: i64 = 30;

/// The plaintext enrollment token is deliberately returned only at creation
/// time. The database receives its SHA-256 digest, never the token itself.
#[derive(Debug)]
pub struct GatewayRegistration {
    pub id: Uuid,
    pub enrollment_token: String,
    pub enrollment_expires_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug)]
pub struct GatewayCertificateRotation {
    pub enrollment_token: String,
    pub enrollment_expires_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug)]
pub struct GatewayRevocationSnapshot {
    pub revoked_device_certificate_fingerprints: Vec<String>,
    pub revoked_access_nonces: Vec<Uuid>,
}

#[derive(Clone)]
pub struct ControlPlaneStore {
    pool: PgPool,
}

impl ControlPlaneStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn create_organization(
        &self,
        owner_user_id: Uuid,
        slug: &str,
        display_name: &str,
    ) -> Result<Uuid> {
        let organization_id = Uuid::new_v4();
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO organizations (id, slug, display_name)
             VALUES ($1, $2, $3)",
        )
        .bind(organization_id)
        .bind(slug)
        .bind(display_name)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO organization_memberships
             (organization_id, user_id, status, organization_role)
             VALUES ($1, $2, 'active', 'owner')",
        )
        .bind(organization_id)
        .bind(owner_user_id)
        .execute(&mut *tx)
        .await?;
        write_management_audit(
            &mut tx,
            organization_id,
            owner_user_id,
            None,
            None,
            &["organizations".into(), organization_id.to_string()],
            "organization.create",
            serde_json::json!({ "slug": slug }),
        )
        .await?;
        tx.commit().await?;
        Ok(organization_id)
    }

    pub async fn create_managed_project(
        &self,
        organization_id: Uuid,
        actor_user_id: Uuid,
        display_name: &str,
    ) -> Result<Uuid> {
        let project_id = Uuid::new_v4();
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO managed_projects (id, organization_id, display_name)
             VALUES ($1, $2, $3)",
        )
        .bind(project_id)
        .bind(organization_id)
        .bind(display_name)
        .execute(&mut *tx)
        .await?;
        write_management_audit(
            &mut tx,
            organization_id,
            actor_user_id,
            Some(project_id),
            None,
            &["managed-projects".into(), project_id.to_string()],
            "managed-project.create",
            serde_json::json!({ "displayName": display_name }),
        )
        .await?;
        tx.commit().await?;
        Ok(project_id)
    }

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

    #[allow(clippy::too_many_arguments)]
    pub async fn register_data_source(
        &self,
        organization_id: Uuid,
        actor_user_id: Uuid,
        project_id: Uuid,
        gateway_id: Uuid,
        driver: &str,
        target_binding: &str,
        display_name: &str,
        capabilities: &BTreeSet<AccessAction>,
    ) -> Result<Uuid> {
        let mut tx = self.pool.begin().await?;
        let valid_scope: bool = sqlx::query_scalar(
            "SELECT EXISTS (
               SELECT 1
               FROM managed_projects p
               JOIN gateways g ON g.organization_id = p.organization_id
               WHERE p.id = $1 AND p.organization_id = $2 AND g.id = $3
                 AND g.status = 'active'
             )",
        )
        .bind(project_id)
        .bind(organization_id)
        .bind(gateway_id)
        .fetch_one(&mut *tx)
        .await?;
        if !valid_scope {
            anyhow::bail!("managed project and Gateway must belong to this organization");
        }
        let data_source_id = Uuid::new_v4();
        let capabilities = capabilities
            .iter()
            .map(|action| action.as_str())
            .collect::<Vec<_>>();
        sqlx::query(
            "INSERT INTO data_sources
             (id, organization_id, project_id, gateway_id, driver, target_binding, display_name, capabilities)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
        )
        .bind(data_source_id)
        .bind(organization_id)
        .bind(project_id)
        .bind(gateway_id)
        .bind(driver)
        .bind(target_binding)
        .bind(display_name)
        .bind(serde_json::to_value(capabilities)?)
        .execute(&mut *tx)
        .await?;
        write_management_audit(
            &mut tx,
            organization_id,
            actor_user_id,
            Some(project_id),
            Some(data_source_id),
            &["data-sources".into(), data_source_id.to_string()],
            "data-source.register",
            serde_json::json!({ "driver": driver, "targetBinding": target_binding, "displayName": display_name }),
        )
        .await?;
        tx.commit().await?;
        Ok(data_source_id)
    }

    pub async fn sync_identity(&self, identity: &AuthenticatedIdentity) -> Result<User> {
        if let Some(row) = sqlx::query(
            "SELECT u.id, u.display_name
             FROM user_identities i JOIN users u ON u.id = i.user_id
             WHERE i.issuer = $1 AND i.subject = $2",
        )
        .bind(&identity.issuer)
        .bind(&identity.subject)
        .fetch_optional(&self.pool)
        .await?
        {
            let id: Uuid = row.try_get("id")?;
            sqlx::query("UPDATE users SET display_name = $1, updated_at = now() WHERE id = $2")
                .bind(&identity.display_name)
                .bind(id)
                .execute(&self.pool)
                .await?;
            self.accept_verified_invitations(id, identity).await?;
            return Ok(User {
                id,
                display_name: identity.display_name.clone(),
                verified_emails: identity.verified_email.clone().into_iter().collect(),
            });
        }

        let mut tx = self.pool.begin().await?;
        let id = Uuid::new_v4();
        sqlx::query("INSERT INTO users (id, display_name) VALUES ($1, $2)")
            .bind(id)
            .bind(&identity.display_name)
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            "INSERT INTO user_identities
             (issuer, subject, user_id, kind, verified_email)
             VALUES ($1, $2, $3, 'oidc', $4)",
        )
        .bind(&identity.issuer)
        .bind(&identity.subject)
        .bind(id)
        .bind(&identity.verified_email)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        self.accept_verified_invitations(id, identity).await?;
        Ok(User {
            id,
            display_name: identity.display_name.clone(),
            verified_emails: identity.verified_email.clone().into_iter().collect(),
        })
    }

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

    pub async fn set_minimum_desktop_version(
        &self,
        organization_id: Uuid,
        actor_user_id: Uuid,
        minimum_desktop_version: &semver::Version,
    ) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        let updated = sqlx::query(
            "UPDATE organizations
             SET minimum_desktop_version = $1
             WHERE id = $2",
        )
        .bind(minimum_desktop_version.to_string())
        .bind(organization_id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
        if updated != 1 {
            anyhow::bail!("organization is not available");
        }
        write_management_audit(
            &mut tx,
            organization_id,
            actor_user_id,
            None,
            None,
            &[
                "organizations".into(),
                organization_id.to_string(),
                "desktop-minimum-version".into(),
            ],
            "organization.desktop-minimum-version.set",
            serde_json::json!({ "minimumDesktopVersion": minimum_desktop_version.to_string() }),
        )
        .await?;
        tx.commit().await?;
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

    pub async fn suspend_member(
        &self,
        organization_id: Uuid,
        actor_user_id: Uuid,
        member_id: Uuid,
    ) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtext($1::text))")
            .bind(organization_id)
            .execute(&mut *tx)
            .await?;
        let role = sqlx::query_scalar::<_, String>(
            "SELECT organization_role
             FROM organization_memberships
             WHERE organization_id = $1 AND user_id = $2 AND status = 'active'
             FOR UPDATE",
        )
        .bind(organization_id)
        .bind(member_id)
        .fetch_optional(&mut *tx)
        .await?
        .context("organization member is not active")?;
        if role == "owner" {
            let active_owner_count: i64 = sqlx::query_scalar(
                "SELECT count(*)
                 FROM organization_memberships
                 WHERE organization_id = $1 AND organization_role = 'owner' AND status = 'active'",
            )
            .bind(organization_id)
            .fetch_one(&mut *tx)
            .await?;
            if active_owner_count <= 1 {
                anyhow::bail!("the last active organization owner cannot be suspended");
            }
        }
        sqlx::query(
            "UPDATE organization_memberships
             SET status = 'suspended'
             WHERE organization_id = $1 AND user_id = $2 AND status = 'active'",
        )
        .bind(organization_id)
        .bind(member_id)
        .execute(&mut *tx)
        .await?;
        write_management_audit(
            &mut tx,
            organization_id,
            actor_user_id,
            None,
            None,
            &["members".into(), member_id.to_string()],
            "member.suspend",
            serde_json::json!({ "principalId": member_id }),
        )
        .await?;
        tx.commit().await?;
        Ok(())
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

    pub async fn activate_member(
        &self,
        organization_id: Uuid,
        actor_user_id: Uuid,
        member_id: Uuid,
    ) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        let result = sqlx::query(
            "UPDATE organization_memberships
             SET status = 'active'
             WHERE organization_id = $1 AND user_id = $2 AND status = 'suspended'",
        )
        .bind(organization_id)
        .bind(member_id)
        .execute(&mut *tx)
        .await?;
        if result.rows_affected() != 1 {
            anyhow::bail!("organization member is not suspended");
        }
        write_management_audit(
            &mut tx,
            organization_id,
            actor_user_id,
            None,
            None,
            &["members".into(), member_id.to_string()],
            "member.activate",
            serde_json::json!({ "principalId": member_id }),
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn transfer_organization_ownership(
        &self,
        organization_id: Uuid,
        actor_user_id: Uuid,
        target_user_id: Uuid,
    ) -> Result<()> {
        if actor_user_id == target_user_id {
            anyhow::bail!("organization ownership cannot be transferred to the current owner");
        }
        let mut tx = self.pool.begin().await?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtext($1::text))")
            .bind(organization_id)
            .execute(&mut *tx)
            .await?;
        let actor_is_owner: bool = sqlx::query_scalar(
            "SELECT EXISTS (
               SELECT 1 FROM organization_memberships
               WHERE organization_id = $1 AND user_id = $2
                 AND status = 'active' AND organization_role = 'owner'
             )",
        )
        .bind(organization_id)
        .bind(actor_user_id)
        .fetch_one(&mut *tx)
        .await?;
        if !actor_is_owner {
            anyhow::bail!("active organization owner access is required");
        }
        let target_is_active: bool = sqlx::query_scalar(
            "SELECT EXISTS (
               SELECT 1 FROM organization_memberships
               WHERE organization_id = $1 AND user_id = $2 AND status = 'active'
             )",
        )
        .bind(organization_id)
        .bind(target_user_id)
        .fetch_one(&mut *tx)
        .await?;
        if !target_is_active {
            anyhow::bail!("organization ownership can only be transferred to an active member");
        }
        sqlx::query(
            "UPDATE organization_memberships
             SET organization_role = 'administrator', updated_at = now()
             WHERE organization_id = $1 AND user_id = $2
               AND status = 'active' AND organization_role = 'owner'",
        )
        .bind(organization_id)
        .bind(actor_user_id)
        .execute(&mut *tx)
        .await?;
        let updated = sqlx::query(
            "UPDATE organization_memberships
             SET organization_role = 'owner', updated_at = now()
             WHERE organization_id = $1 AND user_id = $2 AND status = 'active'",
        )
        .bind(organization_id)
        .bind(target_user_id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
        if updated != 1 {
            anyhow::bail!("organization ownership transfer was not applied");
        }
        write_management_audit(
            &mut tx,
            organization_id,
            actor_user_id,
            None,
            None,
            &[
                "organizations".into(),
                organization_id.to_string(),
                "owners".into(),
                target_user_id.to_string(),
            ],
            "organization.owner.transfer",
            serde_json::json!({
                "previousOwnerId": actor_user_id,
                "newOwnerId": target_user_id,
            }),
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn revoke_access_ticket(
        &self,
        organization_id: Uuid,
        actor_user_id: Uuid,
        nonce: Uuid,
        reason: &str,
    ) -> Result<i64> {
        let mut tx = self.pool.begin().await?;
        let expires_at = sqlx::query_scalar::<_, String>(
            "SELECT metadata ->> 'ticketExpiresAt'
             FROM audit_events
             WHERE organization_id = $1 AND metadata ->> 'ticketNonce' = $2
             ORDER BY occurred_at DESC
             LIMIT 1",
        )
        .bind(organization_id)
        .bind(nonce.to_string())
        .fetch_optional(&mut *tx)
        .await?
        .context("access ticket nonce is not available in this organization")?
        .parse::<i64>()
        .context("access ticket audit record has an invalid expiry")?;
        let now = chrono::Utc::now().timestamp();
        if expires_at <= now {
            anyhow::bail!("access ticket has already expired");
        }
        sqlx::query(
            "INSERT INTO revoked_access_nonces (nonce, organization_id, expires_at, reason)
             VALUES ($1, $2, to_timestamp($3), $4)
             ON CONFLICT (nonce) DO UPDATE SET reason = EXCLUDED.reason,
                                             organization_id = EXCLUDED.organization_id,
                                             expires_at = GREATEST(revoked_access_nonces.expires_at, EXCLUDED.expires_at)",
        )
        .bind(nonce)
        .bind(organization_id)
        .bind(expires_at as f64)
        .bind(reason)
        .execute(&mut *tx)
        .await?;
        write_management_audit(
            &mut tx,
            organization_id,
            actor_user_id,
            None,
            None,
            &["access-tickets".into(), nonce.to_string()],
            "access-ticket.revoke",
            serde_json::json!({ "reason": reason, "expiresAt": expires_at }),
        )
        .await?;
        tx.commit().await?;
        Ok(expires_at)
    }

    async fn accept_verified_invitations(
        &self,
        user_id: Uuid,
        identity: &AuthenticatedIdentity,
    ) -> Result<()> {
        let Some(email) = identity.verified_email.as_deref() else {
            return Ok(());
        };
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO organization_memberships
             (organization_id, user_id, status, organization_role)
             SELECT i.organization_id, $1, 'active', i.organization_role
             FROM organization_invitations i
             JOIN organizations o ON o.id = i.organization_id
             WHERE i.invited_email = lower($2)
               AND i.status = 'pending'
               AND i.expires_at > now()
               AND (
                 NOT o.requires_enterprise_sso
                 OR o.required_oidc_issuer = $3
               )
             ON CONFLICT (organization_id, user_id)
             DO UPDATE SET status = 'active',
                           organization_role = EXCLUDED.organization_role,
                           updated_at = now()",
        )
        .bind(user_id)
        .bind(email)
        .bind(&identity.issuer)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE organization_invitations i
             SET status = 'accepted'
             FROM organizations o
             WHERE o.id = i.organization_id
               AND i.invited_email = lower($1)
               AND i.status = 'pending'
               AND i.expires_at > now()
               AND (
                 NOT o.requires_enterprise_sso
                 OR o.required_oidc_issuer = $2
               )",
        )
        .bind(email)
        .bind(&identity.issuer)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn memberships(&self, user_id: Uuid) -> Result<Vec<OrganizationMembership>> {
        let rows = sqlx::query(
            "SELECT o.id, o.slug, o.display_name, o.requires_enterprise_sso,
                    o.auth_policy_revision, m.status, m.organization_role
             FROM organization_memberships m
             JOIN organizations o ON o.id = m.organization_id
             WHERE m.user_id = $1
             ORDER BY o.display_name",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok(OrganizationMembership {
                    organization: OrganizationSummary {
                        id: row.try_get("id")?,
                        slug: row.try_get("slug")?,
                        display_name: row.try_get("display_name")?,
                    },
                    user_id,
                    status: parse_membership_status(row.try_get("status")?)?,
                    organization_role: row.try_get("organization_role")?,
                    auth_policy_revision: row.try_get("auth_policy_revision")?,
                    requires_enterprise_sso: row.try_get("requires_enterprise_sso")?,
                })
            })
            .collect()
    }

    pub async fn require_organization_admin(
        &self,
        user_id: Uuid,
        organization_id: Uuid,
    ) -> Result<()> {
        let allowed: bool = sqlx::query_scalar(
            "SELECT EXISTS (
                SELECT 1 FROM organization_memberships
                WHERE organization_id = $1 AND user_id = $2
                  AND status = 'active'
                  AND organization_role IN ('owner', 'administrator')
             )",
        )
        .bind(organization_id)
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;
        if !allowed {
            anyhow::bail!("organization administrator access is required");
        }
        Ok(())
    }

    pub async fn organization_role(&self, user_id: Uuid, organization_id: Uuid) -> Result<String> {
        sqlx::query_scalar(
            "SELECT organization_role
             FROM organization_memberships
             WHERE organization_id = $1 AND user_id = $2 AND status = 'active'",
        )
        .bind(organization_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?
        .context("active organization membership is required")
    }

    pub async fn require_project_assignment(
        &self,
        user_id: Uuid,
        organization_id: Uuid,
        project_id: Uuid,
    ) -> Result<()> {
        let allowed: bool = sqlx::query_scalar(
            "SELECT EXISTS (
                SELECT 1
                FROM managed_projects p
                JOIN organization_memberships m
                  ON m.organization_id = p.organization_id
                 AND m.user_id = $1
                 AND m.status = 'active'
                JOIN project_assignments a ON a.project_id = p.id
                LEFT JOIN group_members gm
                  ON a.principal_kind = 'group'
                 AND gm.group_id = a.principal_id
                 AND gm.user_id = $1
                WHERE p.id = $2
                  AND p.organization_id = $3
                  AND (
                    (a.principal_kind = 'user' AND a.principal_id = $1)
                    OR gm.user_id = $1
                  )
             )",
        )
        .bind(user_id)
        .bind(project_id)
        .bind(organization_id)
        .fetch_one(&self.pool)
        .await?;
        if !allowed {
            anyhow::bail!("managed project is not assigned to this user");
        }
        Ok(())
    }

    pub async fn admin_overview(&self, organization_id: Uuid) -> Result<serde_json::Value> {
        let organization = sqlx::query(
            "SELECT id, display_name, minimum_desktop_version FROM organizations WHERE id = $1",
        )
        .bind(organization_id)
        .fetch_optional(&self.pool)
        .await?
        .context("organization is not available")?;
        let member_rows = sqlx::query(
            "SELECT u.id, u.display_name, m.status, m.organization_role,
                    COALESCE(
                      (SELECT verified_email FROM user_identities
                       WHERE user_id = u.id AND verified_email IS NOT NULL
                       ORDER BY created_at LIMIT 1),
                      ''
                    ) AS email
             FROM organization_memberships m
             JOIN users u ON u.id = m.user_id
             WHERE m.organization_id = $1
             ORDER BY u.display_name",
        )
        .bind(organization_id)
        .fetch_all(&self.pool)
        .await?;
        let project_rows = sqlx::query(
            "SELECT p.id, p.display_name, p.policy_revision,
                    (SELECT count(*) FROM data_sources d
                     WHERE d.project_id = p.id) AS data_source_count,
                    (SELECT count(*) FROM project_assignments a
                     WHERE a.project_id = p.id) AS member_count
             FROM managed_projects p
             WHERE p.organization_id = $1
             ORDER BY p.display_name",
        )
        .bind(organization_id)
        .fetch_all(&self.pool)
        .await?;
        let source_rows = sqlx::query(
            "SELECT id, project_id, display_name, driver
             FROM data_sources
             WHERE organization_id = $1
             ORDER BY display_name",
        )
        .bind(organization_id)
        .fetch_all(&self.pool)
        .await?;
        let mut sources_by_project = HashMap::<Uuid, Vec<serde_json::Value>>::new();
        for row in source_rows {
            sources_by_project
                .entry(row.try_get("project_id")?)
                .or_default()
                .push(serde_json::json!({
                    "id": row.try_get::<Uuid, _>("id")?,
                    "displayName": row.try_get::<String, _>("display_name")?,
                    "driver": row.try_get::<String, _>("driver")?,
                }));
        }
        let gateway_rows = sqlx::query(
            "SELECT id, display_name, status, last_seen_at
             FROM gateways WHERE organization_id = $1 ORDER BY display_name",
        )
        .bind(organization_id)
        .fetch_all(&self.pool)
        .await?;
        let device_rows = sqlx::query(
            "SELECT d.user_id, d.device_id, d.certificate_fingerprint, d.display_name,
                    d.status, d.enrolled_at, d.revoked_at, u.display_name AS user_display_name
             FROM managed_devices d
             JOIN users u ON u.id = d.user_id
             WHERE d.organization_id = $1
             ORDER BY d.status, d.enrolled_at DESC, d.device_id",
        )
        .bind(organization_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(serde_json::json!({
            "organization": {
                "id": organization.try_get::<Uuid, _>("id")?,
                "displayName": organization.try_get::<String, _>("display_name")?,
                "minimumDesktopVersion": organization.try_get::<String, _>("minimum_desktop_version")?,
            },
            "members": member_rows.into_iter().map(|row| {
                serde_json::json!({
                    "id": row.get::<Uuid, _>("id"),
                    "displayName": row.get::<String, _>("display_name"),
                    "email": row.get::<String, _>("email"),
                    "status": row.get::<String, _>("status"),
                    "role": row.get::<String, _>("organization_role"),
                })
            }).collect::<Vec<_>>(),
            "projects": project_rows.into_iter().map(|row| {
                let project_id = row.get::<Uuid, _>("id");
                serde_json::json!({
                    "id": project_id,
                    "displayName": row.get::<String, _>("display_name"),
                    "dataSourceCount": row.get::<i64, _>("data_source_count"),
                    "memberCount": row.get::<i64, _>("member_count"),
                    "policyRevision": row.get::<String, _>("policy_revision"),
                    "dataSources": sources_by_project.remove(&project_id).unwrap_or_default(),
                })
            }).collect::<Vec<_>>(),
            "gateways": gateway_rows.into_iter().map(|row| {
                serde_json::json!({
                    "id": row.get::<Uuid, _>("id"),
                    "displayName": row.get::<String, _>("display_name"),
                    "status": row.get::<String, _>("status"),
                    "lastSeenAt": row.try_get::<chrono::DateTime<chrono::Utc>, _>("last_seen_at").ok(),
                })
            }).collect::<Vec<_>>(),
            "managedDevices": device_rows.into_iter().map(|row| {
                serde_json::json!({
                    "userId": row.get::<Uuid, _>("user_id"),
                    "userDisplayName": row.get::<String, _>("user_display_name"),
                    "deviceId": row.get::<Uuid, _>("device_id"),
                    "certificateFingerprint": row.get::<String, _>("certificate_fingerprint"),
                    "displayName": row.try_get::<Option<String>, _>("display_name").ok().flatten(),
                    "status": row.get::<String, _>("status"),
                    "enrolledAt": row.get::<chrono::DateTime<chrono::Utc>, _>("enrolled_at"),
                    "revokedAt": row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("revoked_at").ok().flatten(),
                })
            }).collect::<Vec<_>>(),
        }))
    }

    pub async fn audit_events(
        &self,
        organization_id: Uuid,
        limit: i64,
    ) -> Result<serde_json::Value> {
        let rows = sqlx::query(
            "SELECT occurred_at, user_id, project_id, data_source_id, resource_path,
                    action, decision, reason_code, request_id, source, metadata
             FROM audit_events
             WHERE organization_id = $1
             ORDER BY occurred_at DESC, id DESC
             LIMIT $2",
        )
        .bind(organization_id)
        .bind(limit.clamp(1, 200))
        .fetch_all(&self.pool)
        .await?;
        Ok(serde_json::json!({
            "events": rows.into_iter().map(|row| serde_json::json!({
                "occurredAt": row.get::<chrono::DateTime<chrono::Utc>, _>("occurred_at"),
                "userId": row.try_get::<Option<Uuid>, _>("user_id").ok().flatten(),
                "projectId": row.try_get::<Option<Uuid>, _>("project_id").ok().flatten(),
                "dataSourceId": row.try_get::<Option<Uuid>, _>("data_source_id").ok().flatten(),
                "resourcePath": row.try_get::<serde_json::Value, _>("resource_path").ok(),
                "action": row.get::<String, _>("action"),
                "decision": row.get::<String, _>("decision"),
                "reasonCode": row.get::<String, _>("reason_code"),
                "requestId": row.get::<Uuid, _>("request_id"),
                "source": row.get::<String, _>("source"),
                "metadata": row.get::<serde_json::Value, _>("metadata"),
            })).collect::<Vec<_>>(),
        }))
    }

    pub async fn invite_member(
        &self,
        organization_id: Uuid,
        invited_by: Uuid,
        email: &str,
        role: &str,
    ) -> Result<Uuid> {
        let invitation_id = Uuid::new_v4();
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO organization_invitations
             (id, organization_id, invited_email, organization_role, invited_by, expires_at)
             VALUES ($1, $2, lower($3), $4, $5, now() + interval '7 days')
             ON CONFLICT (organization_id, invited_email, status)
             DO UPDATE SET organization_role = EXCLUDED.organization_role,
                           invited_by = EXCLUDED.invited_by,
                           expires_at = EXCLUDED.expires_at",
        )
        .bind(invitation_id)
        .bind(organization_id)
        .bind(email)
        .bind(role)
        .bind(invited_by)
        .execute(&mut *tx)
        .await?;
        write_management_audit(
            &mut tx,
            organization_id,
            invited_by,
            None,
            None,
            &["invitations".into(), invitation_id.to_string()],
            "member.invite",
            serde_json::json!({ "role": role }),
        )
        .await?;
        tx.commit().await?;
        Ok(invitation_id)
    }

    pub async fn assign_project(
        &self,
        organization_id: Uuid,
        actor_user_id: Uuid,
        project_id: Uuid,
        principal_kind: &str,
        principal_id: Uuid,
    ) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        let project_exists: bool = sqlx::query_scalar(
            "SELECT EXISTS (
               SELECT 1 FROM managed_projects
               WHERE id = $1 AND organization_id = $2
             )",
        )
        .bind(project_id)
        .bind(organization_id)
        .fetch_one(&mut *tx)
        .await?;
        if !project_exists {
            anyhow::bail!("managed project is not available");
        }
        sqlx::query(
            "INSERT INTO project_assignments
             (project_id, principal_kind, principal_id)
             VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING",
        )
        .bind(project_id)
        .bind(principal_kind)
        .bind(principal_id)
        .execute(&mut *tx)
        .await?;
        write_management_audit(
            &mut tx,
            organization_id,
            actor_user_id,
            Some(project_id),
            None,
            &[
                "project-assignments".into(),
                principal_kind.into(),
                principal_id.to_string(),
            ],
            "project.assignment.create",
            serde_json::json!({}),
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn create_access_grant(
        &self,
        organization_id: Uuid,
        actor_user_id: Uuid,
        project_id: Uuid,
        principal_kind: &str,
        principal_id: Uuid,
        data_source_id: Option<Uuid>,
        resource_path: &[String],
        actions: &BTreeSet<AccessAction>,
        effect: GrantEffect,
    ) -> Result<Uuid> {
        let mut tx = self.pool.begin().await?;
        let project_exists: bool = sqlx::query_scalar(
            "SELECT EXISTS (
               SELECT 1 FROM managed_projects
               WHERE id = $1 AND organization_id = $2
             )",
        )
        .bind(project_id)
        .bind(organization_id)
        .fetch_one(&mut *tx)
        .await?;
        if !project_exists {
            anyhow::bail!("managed project is not available");
        }
        if let Some(data_source_id) = data_source_id {
            let source_exists: bool = sqlx::query_scalar(
                "SELECT EXISTS (
                   SELECT 1 FROM data_sources
                   WHERE id = $1 AND project_id = $2 AND organization_id = $3
                 )",
            )
            .bind(data_source_id)
            .bind(project_id)
            .bind(organization_id)
            .fetch_one(&mut *tx)
            .await?;
            if !source_exists {
                anyhow::bail!("managed data source is not available");
            }
        }
        let id = Uuid::new_v4();
        let actions = actions
            .iter()
            .map(|action| action.as_str())
            .collect::<Vec<_>>();
        sqlx::query(
            "INSERT INTO access_grants
             (id, organization_id, project_id, principal_kind, principal_id,
              data_source_id, resource_path, actions, effect)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
        )
        .bind(id)
        .bind(organization_id)
        .bind(project_id)
        .bind(principal_kind)
        .bind(principal_id)
        .bind(data_source_id)
        .bind(serde_json::to_value(resource_path)?)
        .bind(serde_json::to_value(&actions)?)
        .bind(match effect {
            GrantEffect::Permit => "permit",
            GrantEffect::Forbid => "forbid",
        })
        .execute(&mut *tx)
        .await?;
        let revision = Uuid::new_v4().to_string();
        sqlx::query(
            "UPDATE managed_projects SET policy_revision = $1, updated_at = now()
             WHERE id = $2 AND organization_id = $3",
        )
        .bind(&revision)
        .bind(project_id)
        .bind(organization_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE data_sources SET policy_revision = $1, updated_at = now()
             WHERE project_id = $2 AND organization_id = $3
               AND ($4::uuid IS NULL OR id = $4)",
        )
        .bind(&revision)
        .bind(project_id)
        .bind(organization_id)
        .bind(data_source_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query("UPDATE organizations SET auth_policy_revision = $1 WHERE id = $2")
            .bind(&revision)
            .bind(organization_id)
            .execute(&mut *tx)
            .await?;
        write_management_audit(
            &mut tx,
            organization_id,
            actor_user_id,
            Some(project_id),
            data_source_id,
            &["access-grants".into(), id.to_string()],
            "access-grant.create",
            serde_json::json!({
                "principalKind": principal_kind,
                "principalId": principal_id,
                "effect": match effect { GrantEffect::Permit => "permit", GrantEffect::Forbid => "forbid" },
                "actions": actions,
            }),
        )
        .await?;
        tx.commit().await?;
        Ok(id)
    }

    pub async fn managed_projects(&self, user_id: Uuid) -> Result<Vec<ManagedProject>> {
        let project_rows = sqlx::query(
            "SELECT DISTINCT p.id, p.organization_id, p.display_name, p.policy_revision,
                    o.display_name AS organization_name
             FROM managed_projects p
             JOIN organizations o ON o.id = p.organization_id
             JOIN organization_memberships m
               ON m.organization_id = p.organization_id
              AND m.user_id = $1 AND m.status = 'active'
             LEFT JOIN group_members gm ON gm.user_id = $1
             JOIN project_assignments a ON a.project_id = p.id
              AND ((a.principal_kind = 'user' AND a.principal_id = $1)
                OR (a.principal_kind = 'group' AND a.principal_id = gm.group_id))
             ORDER BY o.display_name, p.display_name",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;
        let mut projects = Vec::with_capacity(project_rows.len());
        for row in project_rows {
            let project_id: Uuid = row.try_get("id")?;
            let organization_id: Uuid = row.try_get("organization_id")?;
            let sources = self
                .data_sources(user_id, organization_id, project_id)
                .await?;
            let project = ManagedProject {
                id: project_id,
                organization_id,
                organization_name: row.try_get("organization_name")?,
                display_name: row.try_get("display_name")?,
                policy_revision: row.try_get("policy_revision")?,
                data_sources: sources,
            };
            project.validate()?;
            projects.push(project);
        }
        Ok(projects)
    }

    async fn data_sources(
        &self,
        user_id: Uuid,
        organization_id: Uuid,
        project_id: Uuid,
    ) -> Result<Vec<ManagedDataSourceDescriptor>> {
        let rows = sqlx::query(
            "SELECT id, gateway_id, driver, display_name, capabilities,
                    allowed_resource_summary, policy_revision
             FROM data_sources
             WHERE organization_id = $1 AND project_id = $2
             ORDER BY display_name",
        )
        .bind(organization_id)
        .bind(project_id)
        .fetch_all(&self.pool)
        .await?;
        let mut descriptors = rows
            .into_iter()
            .map(|row| {
                let capabilities: Vec<String> =
                    serde_json::from_value(row.try_get("capabilities")?)?;
                let allowed_resource_summary: Vec<String> =
                    serde_json::from_value(row.try_get("allowed_resource_summary")?)?;
                let descriptor = ManagedDataSourceDescriptor {
                    organization_id,
                    project_id,
                    data_source_id: row.try_get("id")?,
                    gateway_id: row.try_get("gateway_id")?,
                    driver: row.try_get("driver")?,
                    display_name: row.try_get("display_name")?,
                    capabilities: capabilities.into_iter().collect(),
                    allowed_resource_summary,
                    policy_revision: row.try_get("policy_revision")?,
                };
                descriptor.validate_secret_free()?;
                Ok(descriptor)
            })
            .collect::<Result<Vec<_>>>()?;
        let grants = self
            .grants_for_user(user_id, organization_id, project_id)
            .await?;
        descriptors.retain_mut(|descriptor| {
            let discoverable_paths = allowed_paths_for_action(
                user_id,
                descriptor.data_source_id,
                &grants,
                AccessAction::ResourceDiscover,
            );
            if discoverable_paths.is_empty() {
                return false;
            }
            descriptor.allowed_resource_summary = discoverable_paths
                .iter()
                .map(|path| path.join("/"))
                .collect();
            descriptor.capabilities = [
                AccessAction::ResourceDiscover,
                AccessAction::MetadataRead,
                AccessAction::QueryRead,
            ]
            .into_iter()
            .filter(|action| {
                !allowed_paths_for_action(user_id, descriptor.data_source_id, &grants, *action)
                    .is_empty()
            })
            .map(|action| action.as_str().to_string())
            .collect();
            true
        });
        Ok(descriptors)
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

    pub async fn grants_for_user(
        &self,
        user_id: Uuid,
        organization_id: Uuid,
        project_id: Uuid,
    ) -> Result<Vec<AccessGrant>> {
        let rows = sqlx::query(
            "SELECT DISTINCT g.id, g.data_source_id, g.resource_path,
                    g.actions, g.effect
             FROM access_grants g
             LEFT JOIN group_members gm
               ON g.principal_kind = 'group' AND gm.group_id = g.principal_id
             WHERE g.organization_id = $1 AND g.project_id = $2
               AND ((g.principal_kind = 'user' AND g.principal_id = $3)
                 OR gm.user_id = $3)",
        )
        .bind(organization_id)
        .bind(project_id)
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                let actions: Vec<String> = serde_json::from_value(row.try_get("actions")?)?;
                Ok(AccessGrant {
                    id: row.try_get("id")?,
                    principal_id: user_id,
                    organization_id,
                    project_id,
                    data_source_id: row.try_get("data_source_id")?,
                    resource_path: serde_json::from_value(row.try_get("resource_path")?)?,
                    actions: actions
                        .into_iter()
                        .map(|action| parse_action(&action))
                        .collect::<Result<BTreeSet<_>>>()?,
                    effect: match row.try_get::<String, _>("effect")?.as_str() {
                        "permit" => GrantEffect::Permit,
                        "forbid" => GrantEffect::Forbid,
                        value => anyhow::bail!("invalid stored grant effect: {value}"),
                    },
                })
            })
            .collect()
    }

    pub fn forbidden_paths_for_action(
        grants: &[AccessGrant],
        data_source_id: Uuid,
        action: AccessAction,
    ) -> Vec<Vec<String>> {
        grants
            .iter()
            .filter(|grant| {
                grant.effect == GrantEffect::Forbid
                    && grant.actions.contains(&action)
                    && grant
                        .data_source_id
                        .is_none_or(|value| value == data_source_id)
            })
            .map(|grant| grant.resource_path.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .take(256)
            .collect()
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn write_audit(
        &self,
        organization_id: Uuid,
        user_id: Uuid,
        device_id: Uuid,
        project_id: Uuid,
        data_source_id: Uuid,
        resource_path: &[String],
        action: AccessAction,
        decision: &str,
        reason: &str,
        request_id: Uuid,
        source: &str,
        metadata: serde_json::Value,
    ) -> Result<()> {
        sqlx::query(
            "INSERT INTO audit_events
             (id, organization_id, user_id, device_id, project_id, data_source_id,
              resource_path, action, decision, reason_code, request_id, source, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)",
        )
        .bind(Uuid::new_v4())
        .bind(organization_id)
        .bind(user_id)
        .bind(device_id)
        .bind(project_id)
        .bind(data_source_id)
        .bind(serde_json::to_value(resource_path)?)
        .bind(action.as_str())
        .bind(decision)
        .bind(reason)
        .bind(request_id)
        .bind(source)
        .bind(metadata)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

fn generate_enrollment_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn digest_enrollment_token(token: &str) -> String {
    let digest = Sha256::digest(token.as_bytes());
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn constant_time_equals(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0u8, |difference, (left, right)| difference | (left ^ right))
        == 0
}

fn verify_enrollment_signature(
    public_key: Option<&str>,
    signature: &str,
    gateway_id: Uuid,
    direct_endpoint: &str,
    certificate_fingerprint: &str,
    enrollment_token: &str,
) -> bool {
    verify_gateway_signature(
        public_key,
        signature,
        &gateway_enrollment_signing_message(
            gateway_id,
            direct_endpoint,
            certificate_fingerprint,
            enrollment_token,
        ),
    )
}

fn verify_gateway_signature(public_key: Option<&str>, signature: &str, message: &[u8]) -> bool {
    let Some(public_key) = public_key else {
        return false;
    };
    let Ok(public_key) = STANDARD.decode(public_key) else {
        return false;
    };
    let Ok(public_key) = <[u8; 32]>::try_from(public_key.as_slice()) else {
        return false;
    };
    let Ok(verifying_key) = VerifyingKey::from_bytes(&public_key) else {
        return false;
    };
    let Ok(signature) = STANDARD.decode(signature) else {
        return false;
    };
    let Ok(signature) = Signature::try_from(signature.as_slice()) else {
        return false;
    };
    verifying_key.verify(message, &signature).is_ok()
}

fn gateway_heartbeat_is_fresh(
    last_seen_at: Option<chrono::DateTime<chrono::Utc>>,
    now: chrono::DateTime<chrono::Utc>,
) -> bool {
    let Some(last_seen_at) = last_seen_at else {
        return false;
    };
    last_seen_at <= now
        && last_seen_at >= now - chrono::Duration::seconds(GATEWAY_TICKET_HEARTBEAT_MAX_AGE_SECONDS)
}

fn rotated_device_certificate<'a>(
    previous_certificate_fingerprint: Option<&'a str>,
    next_certificate_fingerprint: &str,
) -> Option<&'a str> {
    previous_certificate_fingerprint.filter(|previous| *previous != next_certificate_fingerprint)
}

#[cfg(test)]
mod enrollment_tests {
    use super::*;

    #[test]
    fn enrollment_tokens_are_opaque_and_only_the_digest_is_stable() {
        let token = generate_enrollment_token();
        assert!(token.len() >= 43);
        assert_eq!(digest_enrollment_token(&token).len(), 64);
        assert_ne!(digest_enrollment_token(&token), token);
        assert!(constant_time_equals(
            digest_enrollment_token(&token).as_bytes(),
            digest_enrollment_token(&token).as_bytes()
        ));
        assert!(!constant_time_equals(b"expected", b"different"));
    }

    #[test]
    fn enrollment_requires_a_signature_from_the_registered_key() {
        use ed25519_dalek::{Signer, SigningKey};
        let signing_key = SigningKey::from_bytes(&[7; 32]);
        let gateway_id = Uuid::new_v4();
        let endpoint = "https://gateway.example.test";
        let fingerprint = "a".repeat(64);
        let token = "enrollment-token";
        let signature = signing_key.sign(&gateway_enrollment_signing_message(
            gateway_id,
            endpoint,
            &fingerprint,
            token,
        ));
        assert!(verify_enrollment_signature(
            Some(&STANDARD.encode(signing_key.verifying_key().as_bytes())),
            &STANDARD.encode(signature.to_bytes()),
            gateway_id,
            endpoint,
            &fingerprint,
            token,
        ));
        assert!(!verify_enrollment_signature(
            Some(&STANDARD.encode(signing_key.verifying_key().as_bytes())),
            &STANDARD.encode(signature.to_bytes()),
            gateway_id,
            "https://other.example.test",
            &fingerprint,
            token,
        ));
        let restart_signature = signing_key.sign(&gateway_enrollment_signing_message(
            gateway_id,
            endpoint,
            &fingerprint,
            "",
        ));
        assert!(verify_enrollment_signature(
            Some(&STANDARD.encode(signing_key.verifying_key().as_bytes())),
            &STANDARD.encode(restart_signature.to_bytes()),
            gateway_id,
            endpoint,
            &fingerprint,
            "",
        ));
    }

    #[test]
    fn gateway_signature_is_bound_to_the_revocation_snapshot_domain() {
        use ed25519_dalek::{Signer, SigningKey};
        let signing_key = SigningKey::from_bytes(&[3; 32]);
        let gateway_id = Uuid::new_v4();
        let endpoint = "https://gateway.example.test";
        let fingerprint = "b".repeat(64);
        let signature = signing_key.sign(&gateway_revocation_snapshot_signing_message(
            gateway_id,
            endpoint,
            &fingerprint,
        ));
        assert!(verify_gateway_signature(
            Some(&STANDARD.encode(signing_key.verifying_key().as_bytes())),
            &STANDARD.encode(signature.to_bytes()),
            &gateway_revocation_snapshot_signing_message(gateway_id, endpoint, &fingerprint),
        ));
        assert!(!verify_gateway_signature(
            Some(&STANDARD.encode(signing_key.verifying_key().as_bytes())),
            &STANDARD.encode(signature.to_bytes()),
            &gateway_enrollment_signing_message(gateway_id, endpoint, &fingerprint, ""),
        ));
    }

    #[test]
    fn gateway_ticket_issuance_requires_a_recent_signed_heartbeat() {
        let now = chrono::Utc::now();
        assert!(gateway_heartbeat_is_fresh(
            Some(now - chrono::Duration::seconds(GATEWAY_TICKET_HEARTBEAT_MAX_AGE_SECONDS)),
            now,
        ));
        assert!(!gateway_heartbeat_is_fresh(
            Some(now - chrono::Duration::seconds(GATEWAY_TICKET_HEARTBEAT_MAX_AGE_SECONDS + 1,)),
            now,
        ));
        assert!(!gateway_heartbeat_is_fresh(None, now));
        assert!(!gateway_heartbeat_is_fresh(
            Some(now + chrono::Duration::seconds(1)),
            now,
        ));
    }

    #[test]
    fn device_certificate_rotation_only_retires_a_replaced_fingerprint() {
        assert_eq!(rotated_device_certificate(None, "new"), None);
        assert_eq!(rotated_device_certificate(Some("same"), "same"), None);
        assert_eq!(
            rotated_device_certificate(Some("previous"), "replacement"),
            Some("previous")
        );
    }
}

async fn write_management_audit(
    tx: &mut Transaction<'_, Postgres>,
    organization_id: Uuid,
    user_id: Uuid,
    project_id: Option<Uuid>,
    data_source_id: Option<Uuid>,
    resource_path: &[String],
    action: &str,
    metadata: serde_json::Value,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO audit_events
         (id, organization_id, user_id, project_id, data_source_id,
          resource_path, action, decision, reason_code, request_id, source, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'allow', 'ADMIN_MUTATION', $8, 'control-plane.admin', $9)",
    )
    .bind(Uuid::new_v4())
    .bind(organization_id)
    .bind(user_id)
    .bind(project_id)
    .bind(data_source_id)
    .bind(serde_json::to_value(resource_path)?)
    .bind(action)
    .bind(Uuid::new_v4())
    .bind(metadata)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn write_gateway_enrollment_audit(
    tx: &mut Transaction<'_, Postgres>,
    organization_id: Uuid,
    gateway_id: Uuid,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO audit_events
         (id, organization_id, resource_path, action, decision, reason_code, request_id, source, metadata)
         VALUES ($1, $2, $3, 'gateway.enrollment.activate', 'allow', 'GATEWAY_PROOF_ACCEPTED', $4, 'gateway', $5)",
    )
    .bind(Uuid::new_v4())
    .bind(organization_id)
    .bind(serde_json::json!(["gateways", gateway_id.to_string()]))
    .bind(Uuid::new_v4())
    .bind(serde_json::json!({ "status": "active", "proof": "certificate-and-one-time-token" }))
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn write_gateway_certificate_rotation_audit(
    tx: &mut Transaction<'_, Postgres>,
    organization_id: Uuid,
    gateway_id: Uuid,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO audit_events
         (id, organization_id, resource_path, action, decision, reason_code, request_id, source, metadata)
         VALUES ($1, $2, $3, 'gateway.certificate-rotation.activate', 'allow', 'GATEWAY_ROTATION_PROOF_ACCEPTED', $4, 'gateway', $5)",
    )
    .bind(Uuid::new_v4())
    .bind(organization_id)
    .bind(serde_json::json!(["gateways", gateway_id.to_string()]))
    .bind(Uuid::new_v4())
    .bind(serde_json::json!({ "status": "active", "proof": "current-signing-key-and-one-time-token" }))
    .execute(&mut **tx)
    .await?;
    Ok(())
}

fn parse_membership_status(value: String) -> Result<MembershipStatus> {
    match value.as_str() {
        "invited" => Ok(MembershipStatus::Invited),
        "active" => Ok(MembershipStatus::Active),
        "suspended" => Ok(MembershipStatus::Suspended),
        _ => anyhow::bail!("invalid stored membership status: {value}"),
    }
}

pub(crate) fn allowed_paths_for_action(
    user_id: Uuid,
    data_source_id: Uuid,
    grants: &[AccessGrant],
    action: AccessAction,
) -> Vec<Vec<String>> {
    let mut candidates = grants
        .iter()
        .filter(|grant| {
            grant.effect == GrantEffect::Permit
                && grant.actions.contains(&action)
                && grant
                    .data_source_id
                    .is_none_or(|value| value == data_source_id)
        })
        .map(|grant| grant.resource_path.clone())
        .collect::<BTreeSet<_>>();
    candidates.retain(|resource_path| {
        let Some(grant) = grants.iter().find(|grant| {
            grant.effect == GrantEffect::Permit
                && grant.actions.contains(&action)
                && grant.resource_path == *resource_path
                && grant
                    .data_source_id
                    .is_none_or(|value| value == data_source_id)
        }) else {
            return false;
        };
        PolicyEvaluator::is_allowed(
            &AuthorizationRequest {
                principal_id: user_id,
                organization_id: grant.organization_id,
                project_id: grant.project_id,
                data_source_id,
                resource_path: resource_path.clone(),
                action,
            },
            grants,
        )
        .unwrap_or(false)
    });
    candidates.into_iter().collect()
}

fn parse_action(value: &str) -> Result<AccessAction> {
    match value {
        "resource.discover" => Ok(AccessAction::ResourceDiscover),
        "metadata.read" => Ok(AccessAction::MetadataRead),
        "query.read" => Ok(AccessAction::QueryRead),
        "data.write" => Ok(AccessAction::DataWrite),
        "schema.ddl" => Ok(AccessAction::SchemaDdl),
        "data.export" => Ok(AccessAction::DataExport),
        "ai.use" => Ok(AccessAction::AiUse),
        "mcp.use" => Ok(AccessAction::McpUse),
        _ => anyhow::bail!("invalid stored access action: {value}"),
    }
}
