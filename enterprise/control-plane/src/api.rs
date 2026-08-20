use crate::{
    auth::OidcVerifier,
    store::{allowed_paths_for_action, ControlPlaneStore},
};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use oxide_enterprise_contracts::{
    AccessAction, AccessSessionClaims, AccessSessionTicket, AuthorizationRequest, GrantEffect,
    OrganizationMembership, PolicyEvaluator, TicketSigner, User, DEFAULT_ACCESS_TICKET_TTL_SECONDS,
    ENTERPRISE_CONTRACT_VERSION,
};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, sync::Arc, time::SystemTime};
use uuid::Uuid;

#[derive(Clone)]
pub struct AppState {
    pub store: ControlPlaneStore,
    pub verifier: Arc<OidcVerifier>,
    pub ticket_signer: Arc<TicketSigner>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MeResponse {
    user: User,
    memberships: Vec<OrganizationMembership>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AccessSessionRequest {
    device_id: Uuid,
    device_certificate_fingerprint: String,
    organization_id: Uuid,
    project_id: Uuid,
    data_source_id: Uuid,
    action: AccessAction,
    resource_path: Vec<String>,
    request_id: Uuid,
    source: String,
    desktop_version: String,
    max_rows: Option<u32>,
    max_result_bytes: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AccessSessionResponse {
    ticket: AccessSessionTicket,
    expires_at: i64,
    policy_revision: String,
    gateway_endpoint: String,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(health))
        .route("/v1/organizations", post(create_organization))
        .route("/v1/me", get(me))
        .route("/v1/managed-projects", get(managed_projects))
        .route("/v1/access-sessions", post(create_access_session))
        .route(
            "/v1/gateway-enrollments/activate",
            post(activate_gateway_enrollment),
        )
        .route(
            "/v1/gateway-revocations/snapshot",
            post(gateway_revocation_snapshot),
        )
        .route(
            "/v1/admin/organizations/{organization_id}/overview",
            get(admin_overview),
        )
        .route(
            "/v1/admin/organizations/{organization_id}/desktop-minimum-version",
            post(set_minimum_desktop_version),
        )
        .route(
            "/v1/admin/organizations/{organization_id}/audit-events",
            get(admin_audit_events),
        )
        .route(
            "/v1/admin/organizations/{organization_id}/invitations",
            post(invite_member),
        )
        .route(
            "/v1/admin/organizations/{organization_id}/managed-projects",
            post(create_managed_project),
        )
        .route(
            "/v1/admin/organizations/{organization_id}/gateways",
            post(register_gateway),
        )
        .route(
            "/v1/admin/organizations/{organization_id}/gateways/{gateway_id}/revoke",
            post(revoke_gateway),
        )
        .route(
            "/v1/admin/organizations/{organization_id}/gateways/{gateway_id}/rotate-certificate",
            post(rotate_gateway_certificate),
        )
        .route(
            "/v1/admin/organizations/{organization_id}/managed-devices",
            post(register_managed_device),
        )
        .route(
            "/v1/admin/organizations/{organization_id}/managed-devices/revoke",
            post(revoke_managed_device),
        )
        .route(
            "/v1/admin/organizations/{organization_id}/members/{member_id}/suspend",
            post(suspend_member),
        )
        .route(
            "/v1/admin/organizations/{organization_id}/members/{member_id}/activate",
            post(activate_member),
        )
        .route(
            "/v1/admin/organizations/{organization_id}/members/{member_id}/transfer-ownership",
            post(transfer_organization_ownership),
        )
        .route(
            "/v1/admin/organizations/{organization_id}/data-sources",
            post(register_data_source),
        )
        .route(
            "/v1/admin/organizations/{organization_id}/project-assignments",
            post(assign_project),
        )
        .route(
            "/v1/admin/organizations/{organization_id}/access-grants",
            post(create_access_grant),
        )
        .route(
            "/v1/admin/organizations/{organization_id}/access-tickets/revoke",
            post(revoke_access_ticket),
        )
        .with_state(state)
}

async fn health() -> &'static str {
    "ok"
}

async fn me(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<MeResponse>, ApiError> {
    let identity = state.verifier.authenticate(&headers).await?;
    let user = state.store.sync_identity(&identity).await?;
    let memberships = state.store.memberships(user.id).await?;
    Ok(Json(MeResponse { user, memberships }))
}

async fn managed_projects(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Vec<oxide_enterprise_contracts::ManagedProject>>, ApiError> {
    let identity = state.verifier.authenticate(&headers).await?;
    let user = state.store.sync_identity(&identity).await?;
    Ok(Json(state.store.managed_projects(user.id).await?))
}

async fn create_access_session(
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

    let (gateway_id, gateway_endpoint, policy_revision) = state
        .store
        .gateway_for_source(
            input.organization_id,
            input.project_id,
            input.data_source_id,
        )
        .await
        .map_err(|error| {
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

fn validate_access_session_request(input: &AccessSessionRequest) -> Result<(), ApiError> {
    if !input.action.is_stage_one_managed_action() {
        return Err(ApiError::bad_request(
            "the managed Gateway currently supports resource discovery, metadata reads, and read-only queries only",
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

fn validate_desktop_version(value: &str) -> Result<semver::Version, ApiError> {
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

fn validated_gateway_endpoint(value: &str) -> Result<String, ApiError> {
    let endpoint = reqwest::Url::parse(value)
        .map_err(|_| ApiError::internal("stored Gateway endpoint is invalid"))?;
    if endpoint.scheme() != "https"
        || !endpoint.username().is_empty()
        || endpoint.password().is_some()
        || endpoint.host_str().is_none()
    {
        return Err(ApiError::internal(
            "stored Gateway endpoint is not a credential-free HTTPS endpoint",
        ));
    }
    Ok(endpoint.as_str().trim_end_matches('/').to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InviteMemberRequest {
    email: String,
    role: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateOrganizationRequest {
    slug: String,
    display_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateManagedProjectRequest {
    display_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RegisterGatewayRequest {
    display_name: String,
    direct_endpoint: String,
    certificate_fingerprint: String,
    enrollment_public_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RotateGatewayCertificateRequest {
    certificate_fingerprint: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SetMinimumDesktopVersionRequest {
    minimum_desktop_version: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ActivateGatewayEnrollmentRequest {
    gateway_id: Uuid,
    direct_endpoint: String,
    certificate_fingerprint: String,
    enrollment_signature: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct GatewayRevocationSnapshotRequest {
    gateway_id: Uuid,
    direct_endpoint: String,
    certificate_fingerprint: String,
    request_signature: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RegisterDataSourceRequest {
    project_id: Uuid,
    gateway_id: Uuid,
    driver: String,
    display_name: String,
    capabilities: BTreeSet<AccessAction>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RegisterManagedDeviceRequest {
    user_id: Uuid,
    device_id: Uuid,
    certificate_fingerprint: String,
    display_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RevokeManagedDeviceRequest {
    user_id: Uuid,
    device_id: Uuid,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RevokeAccessTicketRequest {
    nonce: Uuid,
    reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProjectAssignmentRequest {
    project_id: Uuid,
    principal_kind: String,
    principal_id: Uuid,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateAccessGrantRequest {
    project_id: Uuid,
    principal_kind: String,
    principal_id: Uuid,
    data_source_id: Option<Uuid>,
    resource_path: Vec<String>,
    actions: BTreeSet<AccessAction>,
    effect: GrantEffect,
}

async fn create_organization(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<CreateOrganizationRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let slug = input.slug.trim().to_ascii_lowercase();
    let display_name = validate_display_name(&input.display_name)?;
    if slug.len() < 2
        || slug.len() > 64
        || !slug.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        })
        || slug.starts_with('-')
        || slug.ends_with('-')
    {
        return Err(ApiError::bad_request(
            "organization slug must use lowercase letters, numbers, and internal hyphens",
        ));
    }
    let identity = state.verifier.authenticate(&headers).await?;
    let user = state.store.sync_identity(&identity).await?;
    let organization_id = state
        .store
        .create_organization(user.id, &slug, &display_name)
        .await?;
    Ok(Json(serde_json::json!({
        "id": organization_id,
        "slug": slug,
        "displayName": display_name,
        "role": "owner",
    })))
}

async fn create_managed_project(
    State(state): State<AppState>,
    Path(organization_id): Path<Uuid>,
    headers: HeaderMap,
    Json(input): Json<CreateManagedProjectRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let display_name = validate_display_name(&input.display_name)?;
    let identity = state.verifier.authenticate(&headers).await?;
    let user = state.store.sync_identity(&identity).await?;
    require_admin(&state, user.id, organization_id).await?;
    let project_id = state
        .store
        .create_managed_project(organization_id, user.id, &display_name)
        .await?;
    Ok(Json(serde_json::json!({
        "id": project_id,
        "displayName": display_name,
    })))
}

async fn register_gateway(
    State(state): State<AppState>,
    Path(organization_id): Path<Uuid>,
    headers: HeaderMap,
    Json(input): Json<RegisterGatewayRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let display_name = validate_display_name(&input.display_name)?;
    let endpoint = validated_gateway_endpoint(&input.direct_endpoint)?;
    let certificate_fingerprint =
        normalize_certificate_fingerprint(&input.certificate_fingerprint)?;
    let enrollment_public_key = normalize_enrollment_public_key(&input.enrollment_public_key)?;
    let identity = state.verifier.authenticate(&headers).await?;
    let user = state.store.sync_identity(&identity).await?;
    require_admin(&state, user.id, organization_id).await?;
    let registration = state
        .store
        .register_gateway(
            organization_id,
            user.id,
            &display_name,
            &endpoint,
            &certificate_fingerprint,
            &enrollment_public_key,
        )
        .await?;
    Ok(Json(serde_json::json!({
        "id": registration.id,
        "displayName": display_name,
        "directEndpoint": endpoint,
        "status": "pending",
        "enrollment": {
            "token": registration.enrollment_token,
            "expiresAt": registration.enrollment_expires_at,
            "certificateFingerprint": certificate_fingerprint,
        },
    })))
}

async fn register_data_source(
    State(state): State<AppState>,
    Path(organization_id): Path<Uuid>,
    headers: HeaderMap,
    Json(input): Json<RegisterDataSourceRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let display_name = validate_display_name(&input.display_name)?;
    let driver = input.driver.trim().to_ascii_lowercase();
    if !matches!(
        driver.as_str(),
        "postgres" | "postgresql" | "mysql" | "mongodb" | "mongo" | "elasticsearch" | "elastic" | "redis"
    )
        || input.capabilities.is_empty()
        || !input
            .capabilities
            .iter()
            .all(|action| action.is_stage_one_managed_action())
    {
        return Err(ApiError::bad_request(
            "managed data sources support PostgreSQL, MySQL, MongoDB, Elasticsearch, and Redis with read-only Gateway capabilities only",
        ));
    }
    let identity = state.verifier.authenticate(&headers).await?;
    let user = state.store.sync_identity(&identity).await?;
    require_admin(&state, user.id, organization_id).await?;
    let data_source_id = state
        .store
        .register_data_source(
            organization_id,
            user.id,
            input.project_id,
            input.gateway_id,
            &driver,
            &display_name,
            &input.capabilities,
        )
        .await?;
    Ok(Json(serde_json::json!({
        "id": data_source_id,
        "displayName": display_name,
        "driver": driver,
    })))
}

async fn register_managed_device(
    State(state): State<AppState>,
    Path(organization_id): Path<Uuid>,
    headers: HeaderMap,
    Json(input): Json<RegisterManagedDeviceRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let fingerprint = normalize_certificate_fingerprint(&input.certificate_fingerprint)?;
    let display_name = input
        .display_name
        .as_deref()
        .map(validate_display_name)
        .transpose()?;
    let identity = state.verifier.authenticate(&headers).await?;
    let user = state.store.sync_identity(&identity).await?;
    require_admin(&state, user.id, organization_id).await?;
    state
        .store
        .register_managed_device(
            organization_id,
            user.id,
            input.user_id,
            input.device_id,
            &fingerprint,
            display_name.as_deref(),
        )
        .await?;
    Ok(Json(serde_json::json!({
        "deviceId": input.device_id,
        "status": "active",
    })))
}

async fn revoke_managed_device(
    State(state): State<AppState>,
    Path(organization_id): Path<Uuid>,
    headers: HeaderMap,
    Json(input): Json<RevokeManagedDeviceRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let identity = state.verifier.authenticate(&headers).await?;
    let user = state.store.sync_identity(&identity).await?;
    require_admin(&state, user.id, organization_id).await?;
    state
        .store
        .revoke_managed_device(organization_id, user.id, input.user_id, input.device_id)
        .await?;
    Ok(Json(serde_json::json!({
        "deviceId": input.device_id,
        "status": "revoked",
    })))
}

async fn suspend_member(
    State(state): State<AppState>,
    Path((organization_id, member_id)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let identity = state.verifier.authenticate(&headers).await?;
    let user = state.store.sync_identity(&identity).await?;
    require_admin(&state, user.id, organization_id).await?;
    state
        .store
        .suspend_member(organization_id, user.id, member_id)
        .await?;
    Ok(Json(serde_json::json!({
        "memberId": member_id,
        "status": "suspended",
    })))
}

async fn activate_member(
    State(state): State<AppState>,
    Path((organization_id, member_id)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let identity = state.verifier.authenticate(&headers).await?;
    let user = state.store.sync_identity(&identity).await?;
    require_admin(&state, user.id, organization_id).await?;
    state
        .store
        .activate_member(organization_id, user.id, member_id)
        .await?;
    Ok(Json(serde_json::json!({
        "memberId": member_id,
        "status": "active",
    })))
}

async fn transfer_organization_ownership(
    State(state): State<AppState>,
    Path((organization_id, member_id)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let identity = state.verifier.authenticate(&headers).await?;
    let user = state.store.sync_identity(&identity).await?;
    validate_ownership_transfer(user.id, member_id)?;
    state
        .store
        .transfer_organization_ownership(organization_id, user.id, member_id)
        .await
        .map_err(|_| ApiError::forbidden("active organization owner access is required"))?;
    Ok(Json(serde_json::json!({
        "memberId": member_id,
        "organizationRole": "owner",
    })))
}

async fn revoke_gateway(
    State(state): State<AppState>,
    Path((organization_id, gateway_id)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let identity = state.verifier.authenticate(&headers).await?;
    let user = state.store.sync_identity(&identity).await?;
    require_admin(&state, user.id, organization_id).await?;
    state
        .store
        .revoke_gateway(organization_id, user.id, gateway_id)
        .await?;
    Ok(Json(serde_json::json!({
        "gatewayId": gateway_id,
        "status": "revoked",
    })))
}

async fn rotate_gateway_certificate(
    State(state): State<AppState>,
    Path((organization_id, gateway_id)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
    Json(input): Json<RotateGatewayCertificateRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let certificate_fingerprint =
        normalize_certificate_fingerprint(&input.certificate_fingerprint)?;
    let identity = state.verifier.authenticate(&headers).await?;
    let user = state.store.sync_identity(&identity).await?;
    require_admin(&state, user.id, organization_id).await?;
    let rotation = state
        .store
        .rotate_gateway_certificate(
            organization_id,
            user.id,
            gateway_id,
            &certificate_fingerprint,
        )
        .await?;
    Ok(Json(serde_json::json!({
        "id": gateway_id,
        "status": "rotationPending",
        "enrollment": {
            "token": rotation.enrollment_token,
            "expiresAt": rotation.enrollment_expires_at,
            "certificateFingerprint": certificate_fingerprint,
        },
    })))
}

async fn set_minimum_desktop_version(
    State(state): State<AppState>,
    Path(organization_id): Path<Uuid>,
    headers: HeaderMap,
    Json(input): Json<SetMinimumDesktopVersionRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let minimum_desktop_version = validate_desktop_version(&input.minimum_desktop_version)?;
    let identity = state.verifier.authenticate(&headers).await?;
    let user = state.store.sync_identity(&identity).await?;
    require_admin(&state, user.id, organization_id).await?;
    state
        .store
        .set_minimum_desktop_version(organization_id, user.id, &minimum_desktop_version)
        .await?;
    Ok(Json(serde_json::json!({
        "minimumDesktopVersion": minimum_desktop_version.to_string(),
    })))
}

async fn revoke_access_ticket(
    State(state): State<AppState>,
    Path(organization_id): Path<Uuid>,
    headers: HeaderMap,
    Json(input): Json<RevokeAccessTicketRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let reason = input.reason.trim();
    if reason.is_empty() || reason.len() > 256 || reason.chars().any(char::is_control) {
        return Err(ApiError::bad_request(
            "ticket revocation reason must contain between 1 and 256 visible characters",
        ));
    }
    let identity = state.verifier.authenticate(&headers).await?;
    let user = state.store.sync_identity(&identity).await?;
    require_admin(&state, user.id, organization_id).await?;
    let expires_at = state
        .store
        .revoke_access_ticket(organization_id, user.id, input.nonce, reason)
        .await?;
    Ok(Json(serde_json::json!({
        "nonce": input.nonce,
        "expiresAt": expires_at,
        "status": "revoked",
    })))
}

async fn activate_gateway_enrollment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<ActivateGatewayEnrollmentRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let endpoint = validated_gateway_endpoint(&input.direct_endpoint)?;
    let certificate_fingerprint =
        normalize_certificate_fingerprint(&input.certificate_fingerprint)?;
    let enrollment_signature = normalize_enrollment_signature(&input.enrollment_signature)?;
    let enrollment_token = gateway_enrollment_token(&headers)?;
    state
        .store
        .activate_gateway_enrollment(
            input.gateway_id,
            &endpoint,
            &certificate_fingerprint,
            enrollment_token,
            &enrollment_signature,
        )
        .await?;
    Ok(Json(serde_json::json!({
        "id": input.gateway_id,
        "status": "active",
    })))
}

async fn gateway_revocation_snapshot(
    State(state): State<AppState>,
    Json(input): Json<GatewayRevocationSnapshotRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let endpoint = validated_gateway_endpoint(&input.direct_endpoint)?;
    let certificate_fingerprint =
        normalize_certificate_fingerprint(&input.certificate_fingerprint)?;
    let request_signature = normalize_enrollment_signature(&input.request_signature)?;
    let revoked = state
        .store
        .gateway_revocation_snapshot(
            input.gateway_id,
            &endpoint,
            &certificate_fingerprint,
            &request_signature,
        )
        .await
        .map_err(|_| ApiError::forbidden("Gateway revocation feed authentication failed"))?;
    Ok(Json(serde_json::json!({
        "revokedDeviceCertificateFingerprints": revoked.revoked_device_certificate_fingerprints,
        "revokedAccessNonces": revoked.revoked_access_nonces,
    })))
}

fn gateway_enrollment_token(headers: &HeaderMap) -> Result<Option<&str>, ApiError> {
    let token = headers
        .get("x-oxide-gateway-enrollment")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty());
    if token.is_some_and(|value| value.len() < 32 || value.len() > 256) {
        return Err(ApiError::forbidden(
            "a valid Gateway enrollment token is required",
        ));
    }
    Ok(token)
}

fn normalize_certificate_fingerprint(value: &str) -> Result<String, ApiError> {
    let value = value.trim().to_ascii_lowercase();
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(ApiError::bad_request(
            "certificateFingerprint must be a SHA-256 hexadecimal fingerprint",
        ));
    }
    Ok(value)
}

fn normalize_enrollment_public_key(value: &str) -> Result<String, ApiError> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use ed25519_dalek::VerifyingKey;
    let value = value.trim();
    let decoded = STANDARD
        .decode(value)
        .map_err(|_| ApiError::bad_request("enrollmentPublicKey must be base64-encoded"))?;
    if decoded.len() != 32 {
        return Err(ApiError::bad_request(
            "enrollmentPublicKey must encode a 32-byte Ed25519 public key",
        ));
    }
    let decoded: [u8; 32] = decoded.try_into().map_err(|_| {
        ApiError::bad_request("enrollmentPublicKey must be valid Ed25519 key material")
    })?;
    VerifyingKey::from_bytes(&decoded).map_err(|_| {
        ApiError::bad_request("enrollmentPublicKey must be a valid Ed25519 public key")
    })?;
    Ok(STANDARD.encode(decoded))
}

fn normalize_enrollment_signature(value: &str) -> Result<String, ApiError> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let value = value.trim();
    let decoded = STANDARD
        .decode(value)
        .map_err(|_| ApiError::forbidden("Gateway enrollment signature is invalid"))?;
    if decoded.len() != 64 {
        return Err(ApiError::forbidden(
            "Gateway enrollment signature is invalid",
        ));
    }
    Ok(STANDARD.encode(decoded))
}

async fn require_admin(
    state: &AppState,
    user_id: Uuid,
    organization_id: Uuid,
) -> Result<(), ApiError> {
    state
        .store
        .require_organization_admin(user_id, organization_id)
        .await
        .map_err(|_| ApiError::forbidden("organization administrator access is required"))
}

fn validate_display_name(value: &str) -> Result<String, ApiError> {
    let value = value.trim();
    if value.is_empty() || value.len() > 128 || value.chars().any(char::is_control) {
        return Err(ApiError::bad_request(
            "display name must contain between 1 and 128 visible characters",
        ));
    }
    Ok(value.to_string())
}

async fn admin_overview(
    State(state): State<AppState>,
    Path(organization_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let identity = state.verifier.authenticate(&headers).await?;
    let user = state.store.sync_identity(&identity).await?;
    state
        .store
        .require_organization_admin(user.id, organization_id)
        .await
        .map_err(|_| ApiError::forbidden("organization administrator access is required"))?;
    let viewer_role = state
        .store
        .organization_role(user.id, organization_id)
        .await?;
    let mut overview = state.store.admin_overview(organization_id).await?;
    overview["viewerRole"] = serde_json::json!(viewer_role);
    Ok(Json(overview))
}

async fn invite_member(
    State(state): State<AppState>,
    Path(organization_id): Path<Uuid>,
    headers: HeaderMap,
    Json(input): Json<InviteMemberRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let email = input.email.trim().to_ascii_lowercase();
    if !email.contains('@') || email.len() > 320 {
        return Err(ApiError::bad_request("a valid email address is required"));
    }
    if !matches!(input.role.as_str(), "member" | "administrator") {
        return Err(ApiError::bad_request("unsupported organization role"));
    }
    let identity = state.verifier.authenticate(&headers).await?;
    let user = state.store.sync_identity(&identity).await?;
    state
        .store
        .require_organization_admin(user.id, organization_id)
        .await
        .map_err(|_| ApiError::forbidden("organization administrator access is required"))?;
    let invitation_id = state
        .store
        .invite_member(organization_id, user.id, &email, &input.role)
        .await?;
    Ok(Json(serde_json::json!({
        "id": invitation_id,
        "status": "pending",
    })))
}

async fn assign_project(
    State(state): State<AppState>,
    Path(organization_id): Path<Uuid>,
    headers: HeaderMap,
    Json(input): Json<ProjectAssignmentRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    validate_principal_kind(&input.principal_kind)?;
    let identity = state.verifier.authenticate(&headers).await?;
    let user = state.store.sync_identity(&identity).await?;
    state
        .store
        .require_organization_admin(user.id, organization_id)
        .await
        .map_err(|_| ApiError::forbidden("organization administrator access is required"))?;
    state
        .store
        .assign_project(
            organization_id,
            user.id,
            input.project_id,
            &input.principal_kind,
            input.principal_id,
        )
        .await?;
    Ok(Json(serde_json::json!({ "status": "assigned" })))
}

async fn create_access_grant(
    State(state): State<AppState>,
    Path(organization_id): Path<Uuid>,
    headers: HeaderMap,
    Json(input): Json<CreateAccessGrantRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    validate_principal_kind(&input.principal_kind)?;
    if input.actions.is_empty()
        || !input
            .actions
            .iter()
            .all(|action| action.is_stage_one_managed_action())
        || input.resource_path.len() > 16
        || input
            .resource_path
            .iter()
            .any(|segment| segment.is_empty() || segment.len() > 256)
    {
        return Err(ApiError::bad_request("invalid access grant scope"));
    }
    let identity = state.verifier.authenticate(&headers).await?;
    let user = state.store.sync_identity(&identity).await?;
    state
        .store
        .require_organization_admin(user.id, organization_id)
        .await
        .map_err(|_| ApiError::forbidden("organization administrator access is required"))?;
    let grant_id = state
        .store
        .create_access_grant(
            organization_id,
            user.id,
            input.project_id,
            &input.principal_kind,
            input.principal_id,
            input.data_source_id,
            &input.resource_path,
            &input.actions,
            input.effect,
        )
        .await?;
    Ok(Json(serde_json::json!({
        "id": grant_id,
        "status": "created",
    })))
}

fn validate_principal_kind(value: &str) -> Result<(), ApiError> {
    if matches!(value, "user" | "group") {
        Ok(())
    } else {
        Err(ApiError::bad_request("principalKind must be user or group"))
    }
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    code: &'static str,
    message: String,
}

impl ApiError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            code: "INVALID_REQUEST",
            message: message.into(),
        }
    }

    fn forbidden(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            code: "ACCESS_DENIED",
            message: message.into(),
        }
    }

    fn gateway_unavailable() -> Self {
        Self {
            status: StatusCode::SERVICE_UNAVAILABLE,
            code: "GATEWAY_UNAVAILABLE",
            message: "The assigned Gateway is offline or has not completed a recent signed control-plane check. Try again shortly.".into(),
        }
    }

    fn desktop_upgrade_required() -> Self {
        Self {
            status: StatusCode::UPGRADE_REQUIRED,
            code: "DESKTOP_UPGRADE_REQUIRED",
            message: "This organization requires a newer OxideStudio desktop version before managed data access can continue.".into(),
        }
    }
}

impl ApiError {
    fn internal(error: impl std::fmt::Display) -> Self {
        tracing::warn!(error = %error, "control-plane request failed");
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code: "INTERNAL_ERROR",
            message: "The enterprise service could not complete the request.".into(),
        }
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(error: anyhow::Error) -> Self {
        Self::internal(error)
    }
}

impl From<oxide_enterprise_contracts::PolicyError> for ApiError {
    fn from(error: oxide_enterprise_contracts::PolicyError) -> Self {
        Self::internal(error)
    }
}

impl From<oxide_enterprise_contracts::TicketError> for ApiError {
    fn from(error: oxide_enterprise_contracts::TicketError) -> Self {
        Self::internal(error)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        (
            self.status,
            Json(serde_json::json!({
                "error": {
                    "code": self.code,
                    "message": self.message,
                }
            })),
        )
            .into_response()
    }
}

async fn admin_audit_events(
    State(state): State<AppState>,
    Path(organization_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let identity = state.verifier.authenticate(&headers).await?;
    let user = state.store.sync_identity(&identity).await?;
    require_admin(&state, user.id, organization_id).await?;
    Ok(Json(state.store.audit_events(organization_id, 200).await?))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn access_session_request(action: AccessAction, source: &str) -> AccessSessionRequest {
        AccessSessionRequest {
            device_id: Uuid::new_v4(),
            device_certificate_fingerprint: "a".repeat(64),
            organization_id: Uuid::new_v4(),
            project_id: Uuid::new_v4(),
            data_source_id: Uuid::new_v4(),
            action,
            resource_path: vec!["warehouse".into(), "public".into()],
            request_id: Uuid::new_v4(),
            source: source.into(),
            desktop_version: "0.1.13".into(),
            max_rows: None,
            max_result_bytes: None,
        }
    }

    #[test]
    fn access_sessions_reject_actions_without_a_gateway_rpc() {
        let input = access_session_request(AccessAction::DataWrite, "desktop");
        let error = validate_access_session_request(&input).unwrap_err();
        assert_eq!(error.status, StatusCode::BAD_REQUEST);
    }

    #[test]
    fn access_sessions_are_limited_to_the_desktop_client() {
        let input = access_session_request(AccessAction::QueryRead, "agent");
        let error = validate_access_session_request(&input).unwrap_err();
        assert_eq!(error.status, StatusCode::BAD_REQUEST);
    }

    #[test]
    fn access_sessions_accept_desktop_read_only_requests() {
        let input = access_session_request(AccessAction::QueryRead, "desktop");
        assert!(validate_access_session_request(&input).is_ok());
    }

    #[test]
    fn managed_access_requires_a_stable_desktop_semantic_version() {
        assert_eq!(
            validate_desktop_version("0.1.13").unwrap().to_string(),
            "0.1.13"
        );
        assert!(validate_desktop_version("0.1.13-beta.1").is_err());
        assert!(validate_desktop_version("not-a-version").is_err());
        let error = ApiError::desktop_upgrade_required();
        assert_eq!(error.status, StatusCode::UPGRADE_REQUIRED);
        assert_eq!(error.code, "DESKTOP_UPGRADE_REQUIRED");
    }

    #[test]
    fn ownership_transfer_rejects_a_self_transfer() {
        let user_id = Uuid::new_v4();
        let error = validate_ownership_transfer(user_id, user_id).unwrap_err();
        assert_eq!(error.status, StatusCode::BAD_REQUEST);
    }

    #[test]
    fn unavailable_gateway_errors_are_retryable_without_leaking_route_details() {
        let error = ApiError::gateway_unavailable();
        assert_eq!(error.status, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(error.code, "GATEWAY_UNAVAILABLE");
        assert!(!error.message.contains("gateway.example"));
    }

    #[test]
    fn enrollment_requires_a_sha256_certificate_fingerprint() {
        assert_eq!(
            normalize_certificate_fingerprint(&"AB".repeat(32)).unwrap(),
            "ab".repeat(32)
        );
        assert!(normalize_certificate_fingerprint("abc").is_err());
        assert!(normalize_certificate_fingerprint(&"x".repeat(64)).is_err());
    }

    #[test]
    fn enrollment_token_is_only_accepted_from_its_dedicated_header() {
        let mut headers = HeaderMap::new();
        assert_eq!(gateway_enrollment_token(&headers).unwrap(), None);
        headers.insert(
            "x-oxide-gateway-enrollment",
            "a_very_long_enrollment_token_value_123".parse().unwrap(),
        );
        assert!(gateway_enrollment_token(&headers).unwrap().is_some());
    }

    #[test]
    fn enrollment_identity_key_has_a_fixed_ed25519_size() {
        use base64::{engine::general_purpose::STANDARD, Engine};
        use ed25519_dalek::SigningKey;
        let signing_key = SigningKey::from_bytes(&[7; 32]);
        assert!(normalize_enrollment_public_key(
            &STANDARD.encode(signing_key.verifying_key().as_bytes())
        )
        .is_ok());
        assert!(normalize_enrollment_public_key(&STANDARD.encode([7; 31])).is_err());
    }
}

fn validate_ownership_transfer(actor_user_id: Uuid, target_user_id: Uuid) -> Result<(), ApiError> {
    if actor_user_id == target_user_id {
        return Err(ApiError::bad_request(
            "select another active member to receive organization ownership",
        ));
    }
    Ok(())
}
