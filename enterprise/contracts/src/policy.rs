use crate::{AccessGrant, AuthorizationRequest, GrantEffect};
use cedar_policy::{
    Authorizer, Context, Decision, Entities, EntityUid, PolicySet, Request, Response,
};
use std::str::FromStr;

#[derive(Debug, thiserror::Error)]
pub enum PolicyError {
    #[error("invalid authorization entity: {0}")]
    InvalidEntity(String),
    #[error("failed to construct Cedar policy: {0}")]
    InvalidPolicy(String),
    #[error("failed to construct Cedar request: {0}")]
    InvalidRequest(String),
}

/// Schema-bounded authorization adapter.
///
/// Resource ancestry is resolved from explicit path segments before policies
/// are emitted. Cedar still owns default-deny and forbid-overrides-permit
/// semantics for the final decision.
pub struct PolicyEvaluator;

impl PolicyEvaluator {
    pub fn authorize(
        request: &AuthorizationRequest,
        grants: &[AccessGrant],
    ) -> Result<Response, PolicyError> {
        let principal = entity_uid("User", &request.principal_id.to_string())?;
        let action = entity_uid("Action", request.action.as_str())?;
        let resource = entity_uid("Resource", &canonical_resource_id(request))?;
        let policy_source = grants
            .iter()
            .filter(|grant| grant_matches(grant, request))
            .map(|grant| {
                let effect = match grant.effect {
                    GrantEffect::Permit => "permit",
                    GrantEffect::Forbid => "forbid",
                };
                format!(
                    r#"{effect}(
                    principal == {principal},
                    action == {action},
                    resource == {resource}
                );"#,
                )
            })
            .collect::<Vec<_>>()
            .join("\n");
        let policies = PolicySet::from_str(&policy_source)
            .map_err(|error| PolicyError::InvalidPolicy(error.to_string()))?;

        let cedar_request = Request::new(principal, action, resource, Context::empty(), None)
            .map_err(|error| PolicyError::InvalidRequest(error.to_string()))?;
        Ok(Authorizer::new().is_authorized(&cedar_request, &policies, &Entities::empty()))
    }

    pub fn is_allowed(
        request: &AuthorizationRequest,
        grants: &[AccessGrant],
    ) -> Result<bool, PolicyError> {
        Ok(Self::authorize(request, grants)?.decision() == Decision::Allow)
    }

    /// Discovery is the only action that may walk from an assigned descendant
    /// toward its ancestors. This lets Explorer reveal the path to an allowed
    /// table without granting metadata or query access to its siblings.
    pub fn can_discover(
        request: &AuthorizationRequest,
        grants: &[AccessGrant],
    ) -> Result<bool, PolicyError> {
        if request.action != crate::AccessAction::ResourceDiscover {
            return Self::is_allowed(request, grants);
        }
        let matching = |grant: &&AccessGrant| {
            grant.principal_id == request.principal_id
                && grant.organization_id == request.organization_id
                && grant.project_id == request.project_id
                && grant
                    .data_source_id
                    .is_none_or(|id| id == request.data_source_id)
                && grant.actions.contains(&request.action)
        };
        let explicitly_forbidden = grants.iter().filter(matching).any(|grant| {
            grant.effect == GrantEffect::Forbid
                && resource_is_within(&request.resource_path, &grant.resource_path)
        });
        if explicitly_forbidden {
            return Ok(false);
        }
        Ok(grants.iter().filter(matching).any(|grant| {
            grant.effect == GrantEffect::Permit
                && (resource_is_within(&request.resource_path, &grant.resource_path)
                    || resource_is_within(&grant.resource_path, &request.resource_path))
        }))
    }
}

fn grant_matches(grant: &AccessGrant, request: &AuthorizationRequest) -> bool {
    grant.principal_id == request.principal_id
        && grant.organization_id == request.organization_id
        && grant.project_id == request.project_id
        && grant
            .data_source_id
            .is_none_or(|id| id == request.data_source_id)
        && grant.actions.contains(&request.action)
        && resource_is_within(&request.resource_path, &grant.resource_path)
}

fn resource_is_within(resource: &[String], scope: &[String]) -> bool {
    scope.len() <= resource.len()
        && scope
            .iter()
            .zip(resource.iter())
            .all(|(expected, actual)| expected == actual)
}

fn canonical_resource_id(request: &AuthorizationRequest) -> String {
    let path = request
        .resource_path
        .iter()
        .map(|segment| segment.replace(['/', '\0'], "_"))
        .collect::<Vec<_>>()
        .join("/");
    format!(
        "{}/{}/{}/{}",
        request.organization_id, request.project_id, request.data_source_id, path
    )
}

fn entity_uid(kind: &str, id: &str) -> Result<EntityUid, PolicyError> {
    let escaped = id.replace('\\', "\\\\").replace('"', "\\\"");
    EntityUid::from_str(&format!(r#"{kind}::"{escaped}""#))
        .map_err(|error| PolicyError::InvalidEntity(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AccessAction, GrantEffect};
    use std::collections::BTreeSet;
    use uuid::Uuid;

    fn request() -> AuthorizationRequest {
        AuthorizationRequest {
            principal_id: Uuid::new_v4(),
            organization_id: Uuid::new_v4(),
            project_id: Uuid::new_v4(),
            data_source_id: Uuid::new_v4(),
            resource_path: vec!["warehouse".into(), "public".into(), "orders".into()],
            action: AccessAction::QueryRead,
        }
    }

    fn grant(request: &AuthorizationRequest, effect: GrantEffect) -> AccessGrant {
        AccessGrant {
            id: Uuid::new_v4(),
            principal_id: request.principal_id,
            organization_id: request.organization_id,
            project_id: request.project_id,
            data_source_id: Some(request.data_source_id),
            resource_path: vec!["warehouse".into(), "public".into()],
            actions: BTreeSet::from([AccessAction::QueryRead]),
            effect,
        }
    }

    #[test]
    fn defaults_to_deny() {
        assert!(!PolicyEvaluator::is_allowed(&request(), &[]).unwrap());
    }

    #[test]
    fn parent_scope_grants_descendants() {
        let request = request();
        assert!(
            PolicyEvaluator::is_allowed(&request, &[grant(&request, GrantEffect::Permit)]).unwrap()
        );
    }

    #[test]
    fn forbid_overrides_permit() {
        let request = request();
        assert!(!PolicyEvaluator::is_allowed(
            &request,
            &[
                grant(&request, GrantEffect::Permit),
                grant(&request, GrantEffect::Forbid)
            ]
        )
        .unwrap());
    }

    #[test]
    fn raw_string_prefixes_do_not_expand_scope() {
        let request = request();
        let mut unrelated = grant(&request, GrantEffect::Permit);
        unrelated.resource_path = vec!["ware".into()];
        assert!(!PolicyEvaluator::is_allowed(&request, &[unrelated]).unwrap());
    }

    #[test]
    fn discovery_can_walk_to_ancestors_but_not_unrelated_paths() {
        let mut request = request();
        request.action = AccessAction::ResourceDiscover;
        request.resource_path = vec!["warehouse".into()];
        let mut table_grant = grant(&request, GrantEffect::Permit);
        table_grant.actions = BTreeSet::from([AccessAction::ResourceDiscover]);
        table_grant.resource_path = vec!["warehouse".into(), "public".into(), "orders".into()];
        assert!(PolicyEvaluator::can_discover(&request, &[table_grant.clone()]).unwrap());
        request.resource_path = vec!["other".into()];
        assert!(!PolicyEvaluator::can_discover(&request, &[table_grant]).unwrap());
    }
}
