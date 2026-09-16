use super::{
    models::*,
    support::{
        gateway_enrollment_token, normalize_certificate_fingerprint,
        normalize_enrollment_public_key, normalize_enrollment_signature, require_admin,
        validate_display_name, validated_gateway_endpoint,
    },
};
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use uuid::Uuid;

pub(super) async fn register_gateway(
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

pub(super) async fn revoke_gateway(
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

pub(super) async fn rotate_gateway_certificate(
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

pub(super) async fn activate_gateway_enrollment(
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

pub(super) async fn gateway_revocation_snapshot(
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
