use super::{
    access::validate_desktop_version,
    models::*,
    support::{normalize_certificate_fingerprint, require_admin, validate_display_name},
};
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use uuid::Uuid;

pub(super) async fn create_organization(
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

pub(super) async fn create_managed_project(
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

pub(super) async fn register_data_source(
    State(state): State<AppState>,
    Path(organization_id): Path<Uuid>,
    headers: HeaderMap,
    Json(input): Json<RegisterDataSourceRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let display_name = validate_display_name(&input.display_name)?;
    let driver = input.driver.trim().to_ascii_lowercase();
    let target_binding = normalize_target_binding(&input.target_binding)?;
    if !matches!(
        driver.as_str(),
        "postgres"
            | "postgresql"
            | "mysql"
            | "mongodb"
            | "mongo"
            | "elasticsearch"
            | "elastic"
            | "redis"
    ) || input.capabilities.is_empty()
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
            &target_binding,
            &display_name,
            &input.capabilities,
        )
        .await?;
    Ok(Json(serde_json::json!({
        "id": data_source_id,
        "displayName": display_name,
        "driver": driver,
        "targetBinding": target_binding,
    })))
}

fn normalize_target_binding(value: &str) -> Result<String, ApiError> {
    let value = value.trim().to_ascii_lowercase();
    if value.len() != 64 || !value.chars().all(|character| character.is_ascii_hexdigit()) {
        return Err(ApiError::bad_request(
            "target binding must be a 64-character SHA-256 fingerprint",
        ));
    }
    Ok(value)
}

pub(super) async fn renew_data_source_target_binding(
    State(state): State<AppState>,
    Path((organization_id, data_source_id)): Path<(Uuid, Uuid)>,
    headers: HeaderMap,
    Json(input): Json<RenewDataSourceTargetBindingRequest>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let target_binding = normalize_target_binding(&input.target_binding)?;
    let identity = state.verifier.authenticate(&headers).await?;
    let user = state.store.sync_identity(&identity).await?;
    require_admin(&state, user.id, organization_id).await?;
    let policy_revision = state
        .store
        .renew_data_source_target_binding(organization_id, user.id, data_source_id, &target_binding)
        .await?;
    Ok(Json(
        serde_json::json!({ "id": data_source_id, "targetBinding": target_binding, "policyRevision": policy_revision }),
    ))
}

pub(super) async fn register_managed_device(
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

pub(super) async fn revoke_managed_device(
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

pub(super) async fn suspend_member(
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

pub(super) async fn activate_member(
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

pub(super) async fn transfer_organization_ownership(
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

pub(super) async fn set_minimum_desktop_version(
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

pub(super) async fn revoke_access_ticket(
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

pub(super) async fn admin_overview(
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

pub(super) async fn invite_member(
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

pub(super) async fn assign_project(
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

pub(super) async fn create_access_grant(
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

pub(super) async fn admin_audit_events(
    State(state): State<AppState>,
    Path(organization_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, ApiError> {
    let identity = state.verifier.authenticate(&headers).await?;
    let user = state.store.sync_identity(&identity).await?;
    require_admin(&state, user.id, organization_id).await?;
    Ok(Json(state.store.audit_events(organization_id, 200).await?))
}

pub(super) fn validate_ownership_transfer(
    actor_user_id: Uuid,
    target_user_id: Uuid,
) -> Result<(), ApiError> {
    if actor_user_id == target_user_id {
        return Err(ApiError::bad_request(
            "select another active member to receive organization ownership",
        ));
    }
    Ok(())
}
