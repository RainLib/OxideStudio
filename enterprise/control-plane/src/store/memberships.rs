use super::{
    audit::write_management_audit, models::ControlPlaneStore, support::parse_membership_status,
};
use anyhow::{Context, Result};
use oxide_enterprise_contracts::{OrganizationMembership, OrganizationSummary};
use sqlx::Row;
use uuid::Uuid;

impl ControlPlaneStore {
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
}
