use super::models::ControlPlaneStore;
use anyhow::{Context, Result};
use oxide_enterprise_contracts::AccessAction;
use sqlx::Row;
use std::collections::HashMap;
use uuid::Uuid;

impl ControlPlaneStore {
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
            "SELECT d.id, d.project_id, d.display_name, d.driver,
                    d.target_binding, d.capabilities, d.allowed_resource_summary,
                    g.id AS gateway_id, g.display_name AS gateway_name,
                    g.status AS gateway_status
             FROM data_sources d
             JOIN gateways g ON g.id = d.gateway_id
             WHERE d.organization_id = $1
             ORDER BY d.display_name",
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
                    "targetBinding": row.try_get::<Option<String>, _>("target_binding")?,
                    "capabilities": row.try_get::<serde_json::Value, _>("capabilities")?,
                    "allowedResourceSummary": row.try_get::<serde_json::Value, _>("allowed_resource_summary")?,
                    "gatewayId": row.try_get::<Uuid, _>("gateway_id")?,
                    "gatewayName": row.try_get::<String, _>("gateway_name")?,
                    "gatewayStatus": row.try_get::<String, _>("gateway_status")?,
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
