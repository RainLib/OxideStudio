use super::models::*;
use axum::http::HeaderMap;
use uuid::Uuid;

pub(super) fn validated_gateway_endpoint(value: &str) -> Result<String, ApiError> {
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

pub(super) fn gateway_enrollment_token(headers: &HeaderMap) -> Result<Option<&str>, ApiError> {
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

pub(super) fn normalize_certificate_fingerprint(value: &str) -> Result<String, ApiError> {
    let value = value.trim().to_ascii_lowercase();
    if value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(ApiError::bad_request(
            "certificateFingerprint must be a SHA-256 hexadecimal fingerprint",
        ));
    }
    Ok(value)
}

pub(super) fn normalize_enrollment_public_key(value: &str) -> Result<String, ApiError> {
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

pub(super) fn normalize_enrollment_signature(value: &str) -> Result<String, ApiError> {
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

pub(super) async fn require_admin(
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

pub(super) fn validate_display_name(value: &str) -> Result<String, ApiError> {
    let value = value.trim();
    if value.is_empty() || value.len() > 128 || value.chars().any(char::is_control) {
        return Err(ApiError::bad_request(
            "display name must contain between 1 and 128 visible characters",
        ));
    }
    Ok(value.to_string())
}
