use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProjectOrigin {
    Local,
    Managed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: Uuid,
    pub display_name: String,
    pub verified_emails: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IdentityKind {
    Password,
    Passkey,
    Oidc,
    Saml,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserIdentity {
    pub user_id: Uuid,
    pub issuer: String,
    pub subject: String,
    pub kind: IdentityKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MembershipStatus {
    Invited,
    Active,
    Suspended,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizationSummary {
    pub id: Uuid,
    pub display_name: String,
    pub slug: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizationMembership {
    pub organization: OrganizationSummary,
    pub user_id: Uuid,
    pub status: MembershipStatus,
    pub organization_role: String,
    pub auth_policy_revision: String,
    pub requires_enterprise_sso: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedDataSourceDescriptor {
    pub organization_id: Uuid,
    pub project_id: Uuid,
    pub data_source_id: Uuid,
    pub gateway_id: Uuid,
    pub driver: String,
    pub display_name: String,
    pub capabilities: BTreeSet<String>,
    pub allowed_resource_summary: Vec<String>,
    pub policy_revision: String,
}

impl ManagedDataSourceDescriptor {
    /// Defense-in-depth check used by every producer before serialization.
    pub fn validate_secret_free(&self) -> Result<(), ContractValidationError> {
        let forbidden_fragments = [
            "://",
            "password",
            "passwd",
            "secret",
            "private_key",
            "access_key",
            "vault:",
        ];
        let values = [
            self.driver.as_str(),
            self.display_name.as_str(),
            self.policy_revision.as_str(),
        ]
        .into_iter()
        .chain(self.capabilities.iter().map(String::as_str))
        .chain(self.allowed_resource_summary.iter().map(String::as_str));
        if values
            .flat_map(|value| {
                forbidden_fragments
                    .iter()
                    .map(move |needle| (value, needle))
            })
            .any(|(value, needle)| value.to_ascii_lowercase().contains(needle))
        {
            return Err(ContractValidationError::SecretLikeDescriptor);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedProject {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub organization_name: String,
    pub display_name: String,
    pub policy_revision: String,
    pub data_sources: Vec<ManagedDataSourceDescriptor>,
}

impl ManagedProject {
    pub fn validate(&self) -> Result<(), ContractValidationError> {
        if self.display_name.trim().is_empty() || self.organization_name.trim().is_empty() {
            return Err(ContractValidationError::MissingDisplayName);
        }
        for source in &self.data_sources {
            if source.project_id != self.id || source.organization_id != self.organization_id {
                return Err(ContractValidationError::ScopeMismatch);
            }
            source.validate_secret_free()?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserProjectPreference {
    pub project_id: Uuid,
    pub alias: Option<String>,
    pub color: Option<String>,
    pub icon: Option<String>,
    pub sort_order: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AccessAction {
    ResourceDiscover,
    MetadataRead,
    QueryRead,
    DataWrite,
    SchemaDdl,
    DataExport,
    AiUse,
    McpUse,
}

impl AccessAction {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ResourceDiscover => "resource.discover",
            Self::MetadataRead => "metadata.read",
            Self::QueryRead => "query.read",
            Self::DataWrite => "data.write",
            Self::SchemaDdl => "schema.ddl",
            Self::DataExport => "data.export",
            Self::AiUse => "ai.use",
            Self::McpUse => "mcp.use",
        }
    }

    /// Actions implemented by the current managed Gateway data plane.
    ///
    /// Export, AI and MCP remain unavailable until their RPCs enforce them.
    pub const fn is_managed_gateway_action(self) -> bool {
        matches!(
            self,
            Self::ResourceDiscover
                | Self::MetadataRead
                | Self::QueryRead
                | Self::DataWrite
                | Self::SchemaDdl
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GrantEffect {
    Permit,
    Forbid,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessGrant {
    pub id: Uuid,
    pub principal_id: Uuid,
    pub organization_id: Uuid,
    pub project_id: Uuid,
    pub data_source_id: Option<Uuid>,
    /// Canonical slash-separated resource path. A grant applies to this path
    /// and its descendants; segments are compared exactly, never by raw prefix.
    pub resource_path: Vec<String>,
    pub actions: BTreeSet<AccessAction>,
    pub effect: GrantEffect,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorizationRequest {
    pub principal_id: Uuid,
    pub organization_id: Uuid,
    pub project_id: Uuid,
    pub data_source_id: Uuid,
    pub resource_path: Vec<String>,
    pub action: AccessAction,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditContext {
    pub request_id: Uuid,
    pub device_id: Uuid,
    pub source: String,
}

#[derive(Debug, thiserror::Error)]
pub enum ContractValidationError {
    #[error("managed descriptors must not contain credential-like values")]
    SecretLikeDescriptor,
    #[error("managed project and data source scopes do not match")]
    ScopeMismatch,
    #[error("managed project display names cannot be empty")]
    MissingDisplayName,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn descriptor() -> ManagedDataSourceDescriptor {
        let organization_id = Uuid::new_v4();
        let project_id = Uuid::new_v4();
        ManagedDataSourceDescriptor {
            organization_id,
            project_id,
            data_source_id: Uuid::new_v4(),
            gateway_id: Uuid::new_v4(),
            driver: "postgres".into(),
            display_name: "Analytics".into(),
            capabilities: ["metadata.read".into(), "query.read".into()]
                .into_iter()
                .collect(),
            allowed_resource_summary: vec!["warehouse/public/orders".into()],
            policy_revision: "policy-7".into(),
        }
    }

    #[test]
    fn managed_descriptors_are_secret_free() {
        let source = descriptor();
        source.validate_secret_free().unwrap();
        let serialized = serde_json::to_string(&source).unwrap().to_ascii_lowercase();
        for forbidden in ["password", "connectionurl", "ssh", "secretref"] {
            assert!(!serialized.contains(forbidden));
        }
    }

    #[test]
    fn gateway_actions_match_implemented_operations() {
        assert!(AccessAction::ResourceDiscover.is_managed_gateway_action());
        assert!(AccessAction::MetadataRead.is_managed_gateway_action());
        assert!(AccessAction::QueryRead.is_managed_gateway_action());
        assert!(AccessAction::DataWrite.is_managed_gateway_action());
        assert!(AccessAction::SchemaDdl.is_managed_gateway_action());
        for action in [
            AccessAction::DataExport,
            AccessAction::AiUse,
            AccessAction::McpUse,
        ] {
            assert!(!action.is_managed_gateway_action());
        }
    }

    #[test]
    fn credential_like_values_are_rejected() {
        let mut source = descriptor();
        source.display_name = "postgres://user:password@example.test/db".into();
        assert!(matches!(
            source.validate_secret_free(),
            Err(ContractValidationError::SecretLikeDescriptor)
        ));
    }
}
