use super::models::ControlPlaneStore;
use crate::auth::AuthenticatedIdentity;
use anyhow::Result;
use oxide_enterprise_contracts::User;
use sqlx::Row;
use uuid::Uuid;

impl ControlPlaneStore {
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
}
