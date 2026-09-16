use super::{audit::write_management_audit, models::ControlPlaneStore};
use anyhow::Result;
use uuid::Uuid;

impl ControlPlaneStore {
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
}
