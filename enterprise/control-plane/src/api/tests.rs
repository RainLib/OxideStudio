use super::{
    access::{validate_access_session_request, validate_desktop_version},
    admin::validate_ownership_transfer,
    models::{AccessSessionRequest, ApiError},
    support::{
        gateway_enrollment_token, normalize_certificate_fingerprint,
        normalize_enrollment_public_key,
    },
};
use axum::http::{HeaderMap, StatusCode};
use oxide_enterprise_contracts::AccessAction;
use uuid::Uuid;

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
fn target_binding_renewal_is_actionable_and_not_retryable() {
    let error = ApiError::target_binding_required();
    assert_eq!(error.status, StatusCode::CONFLICT);
    assert_eq!(error.code, "TARGET_BINDING_REQUIRED");
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
