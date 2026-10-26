use super::{
    access::allowed_paths_for_action, audit::write_management_audit, models::ControlPlaneStore,
};
use anyhow::{Context, Result};
use oxide_enterprise_contracts::{
    AccessAction, AccessGrant, ManagedDataSourceDescriptor, ManagedProject,
};
use sqlx::Row;
use std::collections::BTreeSet;
use uuid::Uuid;

impl ControlPlaneStore {
    #[allow(
        clippy::too_many_arguments,
        reason = "Store boundary keeps registration fields and the audit actor explicit for existing callers"
    )]
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

    pub async fn renew_data_source_target_binding(
        &self,
        organization_id: Uuid,
        actor_user_id: Uuid,
        data_source_id: Uuid,
        target_binding: &str,
    ) -> Result<String> {
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query(
            "SELECT project_id FROM data_sources WHERE id = $1 AND organization_id = $2 FOR UPDATE",
        )
        .bind(data_source_id)
        .bind(organization_id)
        .fetch_optional(&mut *tx)
        .await?
        .context("managed data source is not available")?;
        let project_id: Uuid = row.try_get("project_id")?;
        let revision = Uuid::new_v4().to_string();
        sqlx::query("UPDATE data_sources SET target_binding = $1, policy_revision = $2, updated_at = now() WHERE id = $3")
            .bind(target_binding).bind(&revision).bind(data_source_id).execute(&mut *tx).await?;
        sqlx::query("UPDATE managed_projects SET policy_revision = $1, updated_at = now() WHERE id = $2 AND organization_id = $3")
            .bind(&revision).bind(project_id).bind(organization_id).execute(&mut *tx).await?;
        write_management_audit(
            &mut tx,
            organization_id,
            actor_user_id,
            Some(project_id),
            Some(data_source_id),
            &["data-sources".into(), data_source_id.to_string()],
            "data-source.target-binding.renew",
            serde_json::json!({ "targetBinding": target_binding, "policyRevision": revision }),
        )
        .await?;
        tx.commit().await?;
        Ok(revision)
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
            descriptor.capabilities = granted_source_capabilities(
                user_id,
                descriptor.data_source_id,
                &descriptor.capabilities,
                &grants,
            );
            true
        });
        Ok(descriptors)
    }
}

// This summary enables connection-level UI controls only. Every operation still
// requires a fresh ticket for its concrete table and action.
fn granted_source_capabilities(
    user_id: Uuid,
    source_id: Uuid,
    advertised: &BTreeSet<String>,
    grants: &[AccessGrant],
) -> BTreeSet<String> {
    [
        AccessAction::ResourceDiscover,
        AccessAction::MetadataRead,
        AccessAction::QueryRead,
        AccessAction::DataWrite,
        AccessAction::SchemaDdl,
    ]
    .into_iter()
    .filter(|action| {
        advertised.contains(action.as_str())
            && !allowed_paths_for_action(user_id, source_id, grants, *action).is_empty()
    })
    .map(|action| action.as_str().to_string())
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use oxide_enterprise_contracts::GrantEffect;

    fn grant(user: Uuid, source: Uuid, action: AccessAction, table: &str) -> AccessGrant {
        AccessGrant {
            id: Uuid::new_v4(),
            principal_id: user,
            organization_id: Uuid::nil(),
            project_id: Uuid::nil(),
            data_source_id: Some(source),
            resource_path: vec!["fixture".into(), "validation".into(), table.into()],
            actions: BTreeSet::from([action]),
            effect: GrantEffect::Permit,
        }
    }

    #[test]
    fn project_sync_includes_table_scoped_mutations_and_honors_forbids() {
        let user = Uuid::new_v4();
        let source = Uuid::new_v4();
        let advertised = BTreeSet::from(["data.write".into(), "schema.ddl".into()]);
        let mut grants = vec![
            grant(user, source, AccessAction::DataWrite, "notes"),
            grant(user, source, AccessAction::SchemaDdl, "sandbox"),
        ];
        assert_eq!(
            granted_source_capabilities(user, source, &advertised, &grants),
            advertised
        );
        let mut forbid = grants[0].clone();
        forbid.id = Uuid::new_v4();
        forbid.effect = GrantEffect::Forbid;
        grants.push(forbid);
        assert_eq!(
            granted_source_capabilities(user, source, &advertised, &grants),
            BTreeSet::from(["schema.ddl".into()])
        );
    }

    #[test]
    fn project_sync_never_expands_source_or_principal_capabilities() {
        let user = Uuid::new_v4();
        let source = Uuid::new_v4();
        let grants = vec![grant(user, source, AccessAction::DataWrite, "notes")];
        let readonly = BTreeSet::from(["query.read".into()]);
        assert!(granted_source_capabilities(user, source, &readonly, &grants).is_empty());
        let advertised = BTreeSet::from(["data.write".into()]);
        assert!(
            granted_source_capabilities(Uuid::new_v4(), source, &advertised, &grants).is_empty()
        );
        assert!(granted_source_capabilities(user, Uuid::new_v4(), &advertised, &grants).is_empty());
    }
}
