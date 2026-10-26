use super::{
    models::*,
    support::{normalize_certificate_fingerprint, validated_gateway_endpoint},
};
use crate::store::{allowed_paths_for_action, ControlPlaneStore};
use axum::{extract::State, http::HeaderMap, Json};
use oxide_enterprise_contracts::{
    AccessAction, AccessSessionClaims, AuthorizationRequest, PolicyEvaluator,
    DEFAULT_ACCESS_TICKET_TTL_SECONDS, ENTERPRISE_CONTRACT_VERSION,
};
use std::{collections::BTreeSet, time::SystemTime};
use uuid::Uuid;

pub(super) async fn create_access_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<AccessSessionRequest>,
) -> Result<Json<AccessSessionResponse>, ApiError> {
    validate_access_session_request(&input)?;
    let desktop_version = validate_desktop_version(&input.desktop_version)?;
    let device_certificate_fingerprint =
        normalize_certificate_fingerprint(&input.device_certificate_fingerprint)?;
    let identity = state.verifier.authenticate(&headers).await?;
    let user = state.store.sync_identity(&identity).await?;
    state
        .store
        .require_project_assignment(user.id, input.organization_id, input.project_id)
        .await
        .map_err(|_| ApiError::forbidden("managed project access is not assigned"))?;
    state
        .store
        .require_active_device_certificate(
            user.id,
            input.organization_id,
            input.device_id,
            &device_certificate_fingerprint,
        )
        .await
        .map_err(|_| ApiError::forbidden("this managed device certificate is not enrolled"))?;
    state
        .store
        .require_minimum_desktop_version(input.organization_id, &desktop_version)
        .await
        .map_err(|_| ApiError::desktop_upgrade_required())?;
    let request = AuthorizationRequest {
        principal_id: user.id,
        organization_id: input.organization_id,
        project_id: input.project_id,
        data_source_id: input.data_source_id,
        resource_path: input.resource_path.clone(),
        action: input.action,
    };
    let grants = state
        .store
        .grants_for_user(user.id, input.organization_id, input.project_id)
        .await?;
    let allowed = if input.action == AccessAction::ResourceDiscover {
        PolicyEvaluator::can_discover(&request, &grants)?
    } else {
        PolicyEvaluator::is_allowed(&request, &grants)?
    };
    let forbidden_resource_paths =
        ControlPlaneStore::forbidden_paths_for_action(&grants, input.data_source_id, input.action);
    let allowed_resource_paths =
        allowed_paths_for_action(user.id, input.data_source_id, &grants, input.action);
    if !allowed {
        state
            .store
            .write_audit(
                input.organization_id,
                user.id,
                input.device_id,
                input.project_id,
                input.data_source_id,
                &input.resource_path,
                input.action,
                "deny",
                "POLICY_DENIED",
                input.request_id,
                &input.source,
                serde_json::json!({}),
            )
            .await?;
        return Err(ApiError::forbidden(
            "the assigned enterprise policy does not allow this operation",
        ));
    }

    let (gateway_id, gateway_endpoint, policy_revision, driver, target_binding) = state
        .store
        .gateway_for_source(
            input.organization_id,
            input.project_id,
            input.data_source_id,
        )
        .await
        .map_err(|error| {
            if error
                .to_string()
                .contains("target binding renewal before issuing access tickets")
            {
                return ApiError::target_binding_required();
            }
            tracing::warn!(error = %error, "managed access ticket was blocked by Gateway availability");
            ApiError::gateway_unavailable()
        })?;
    let gateway_endpoint = validated_gateway_endpoint(&gateway_endpoint)?;
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|value| value.as_secs() as i64)
        .unwrap_or(0);
    let expires_at = now + DEFAULT_ACCESS_TICKET_TTL_SECONDS;
    let claims = AccessSessionClaims {
        version: ENTERPRISE_CONTRACT_VERSION,
        issuer: "oxide-control-plane".into(),
        audience: gateway_id,
        principal_id: user.id,
        device_id: input.device_id,
        device_certificate_fingerprint,
        organization_id: input.organization_id,
        project_id: input.project_id,
        data_source_id: input.data_source_id,
        driver,
        target_binding,
        actions: BTreeSet::from([input.action]),
        resource_path: input.resource_path,
        allowed_resource_paths,
        forbidden_resource_paths,
        policy_revision: policy_revision.clone(),
        nonce: Uuid::new_v4(),
        issued_at: now,
        expires_at,
        max_rows: input.max_rows.unwrap_or(200).clamp(1, 1_000),
        max_result_bytes: input
            .max_result_bytes
            .unwrap_or(262_144)
            .clamp(4_096, 1_048_576),
    };
    let ticket = state.ticket_signer.sign(&claims)?;
    state
        .store
        .write_audit(
            claims.organization_id,
            claims.principal_id,
            claims.device_id,
            claims.project_id,
            claims.data_source_id,
            &claims.resource_path,
            input.action,
            "allow",
            "POLICY_ALLOWED",
            input.request_id,
            &input.source,
            serde_json::json!({
                "ticketNonce": claims.nonce,
                "ticketExpiresAt": claims.expires_at,
            }),
        )
        .await?;
    Ok(Json(AccessSessionResponse {
        ticket,
        expires_at,
        policy_revision,
        gateway_endpoint,
    }))
}

pub(super) fn validate_access_session_request(
    input: &AccessSessionRequest,
) -> Result<(), ApiError> {
    if !input.action.is_managed_gateway_action() {
        return Err(ApiError::bad_request(
            "the managed Gateway does not implement this permission action",
        ));
    }
    if input.source != "desktop" {
        return Err(ApiError::bad_request("unsupported managed access source"));
    }
    if input.resource_path.len() > 16
        || input
            .resource_path
            .iter()
            .any(|segment| segment.is_empty() || segment.len() > 256)
    {
        return Err(ApiError::bad_request("invalid resource path"));
    }
    normalize_certificate_fingerprint(&input.device_certificate_fingerprint)?;
    Ok(())
}

pub(super) fn validate_desktop_version(value: &str) -> Result<semver::Version, ApiError> {
    let value = value.trim();
    let version = semver::Version::parse(value)
        .map_err(|_| ApiError::bad_request("desktopVersion must be a valid semantic version"))?;
    if !version.pre.is_empty() || !version.build.is_empty() {
        return Err(ApiError::bad_request(
            "desktopVersion must be a stable semantic version",
        ));
    }
    Ok(version)
}
