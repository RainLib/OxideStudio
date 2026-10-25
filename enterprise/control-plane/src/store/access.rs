use super::{audit::write_management_audit, models::ControlPlaneStore};
use anyhow::{Context, Result};
use oxide_enterprise_contracts::{
    AccessAction, AccessGrant, AuthorizationRequest, GrantEffect, PolicyEvaluator,
};
use sqlx::Row;
use std::collections::BTreeSet;
use uuid::Uuid;

impl ControlPlaneStore {
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

    #[allow(
        clippy::too_many_arguments,
        reason = "Store boundary keeps the grant fields and audit actor explicit for existing callers"
    )]
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
