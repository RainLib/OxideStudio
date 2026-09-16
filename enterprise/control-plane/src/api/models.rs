use crate::{
    auth::{AuthenticationError, OidcVerifier},
    store::ControlPlaneStore,
};
use axum::{http::StatusCode, response::IntoResponse, Json};
use oxide_enterprise_contracts::{
    AccessAction, AccessSessionTicket, GrantEffect, OrganizationMembership, TicketSigner, User,
};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, sync::Arc};
use uuid::Uuid;

#[derive(Clone)]
pub struct AppState {
    pub store: ControlPlaneStore,
    pub verifier: Arc<OidcVerifier>,
    pub ticket_signer: Arc<TicketSigner>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct MeResponse {
    pub(super) user: User,
    pub(super) memberships: Vec<OrganizationMembership>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct AccessSessionRequest {
    pub(super) device_id: Uuid,
    pub(super) device_certificate_fingerprint: String,
    pub(super) organization_id: Uuid,
    pub(super) project_id: Uuid,
    pub(super) data_source_id: Uuid,
    pub(super) action: AccessAction,
    pub(super) resource_path: Vec<String>,
    pub(super) request_id: Uuid,
    pub(super) source: String,
    pub(super) desktop_version: String,
    pub(super) max_rows: Option<u32>,
    pub(super) max_result_bytes: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AccessSessionResponse {
    pub(super) ticket: AccessSessionTicket,
    pub(super) expires_at: i64,
    pub(super) policy_revision: String,
    pub(super) gateway_endpoint: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct InviteMemberRequest {
    pub(super) email: String,
    pub(super) role: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct CreateOrganizationRequest {
    pub(super) slug: String,
    pub(super) display_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct CreateManagedProjectRequest {
    pub(super) display_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct RegisterGatewayRequest {
    pub(super) display_name: String,
    pub(super) direct_endpoint: String,
    pub(super) certificate_fingerprint: String,
    pub(super) enrollment_public_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct RotateGatewayCertificateRequest {
    pub(super) certificate_fingerprint: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SetMinimumDesktopVersionRequest {
    pub(super) minimum_desktop_version: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ActivateGatewayEnrollmentRequest {
    pub(super) gateway_id: Uuid,
    pub(super) direct_endpoint: String,
    pub(super) certificate_fingerprint: String,
    pub(super) enrollment_signature: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct GatewayRevocationSnapshotRequest {
    pub(super) gateway_id: Uuid,
    pub(super) direct_endpoint: String,
    pub(super) certificate_fingerprint: String,
    pub(super) request_signature: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct RegisterDataSourceRequest {
    pub(super) project_id: Uuid,
    pub(super) gateway_id: Uuid,
    pub(super) driver: String,
    pub(super) target_binding: String,
    pub(super) display_name: String,
    pub(super) capabilities: BTreeSet<AccessAction>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct RenewDataSourceTargetBindingRequest {
    pub(super) target_binding: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct RegisterManagedDeviceRequest {
    pub(super) user_id: Uuid,
    pub(super) device_id: Uuid,
    pub(super) certificate_fingerprint: String,
    pub(super) display_name: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct RevokeManagedDeviceRequest {
    pub(super) user_id: Uuid,
    pub(super) device_id: Uuid,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct RevokeAccessTicketRequest {
    pub(super) nonce: Uuid,
    pub(super) reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ProjectAssignmentRequest {
    pub(super) project_id: Uuid,
    pub(super) principal_kind: String,
    pub(super) principal_id: Uuid,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct CreateAccessGrantRequest {
    pub(super) project_id: Uuid,
    pub(super) principal_kind: String,
    pub(super) principal_id: Uuid,
    pub(super) data_source_id: Option<Uuid>,
    pub(super) resource_path: Vec<String>,
    pub(super) actions: BTreeSet<AccessAction>,
    pub(super) effect: GrantEffect,
}

#[derive(Debug)]
pub(super) struct ApiError {
    pub(super) status: StatusCode,
    pub(super) code: &'static str,
    pub(super) message: String,
}

impl ApiError {
    pub(super) fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            code: "INVALID_REQUEST",
            message: message.into(),
        }
    }

    pub(super) fn forbidden(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            code: "ACCESS_DENIED",
            message: message.into(),
        }
    }

    pub(super) fn gateway_unavailable() -> Self {
        Self {
            status: StatusCode::SERVICE_UNAVAILABLE,
            code: "GATEWAY_UNAVAILABLE",
            message: "The assigned Gateway is offline or has not completed a recent signed control-plane check. Try again shortly.".into(),
        }
    }

    pub(super) fn target_binding_required() -> Self {
        Self {
            status: StatusCode::CONFLICT,
            code: "TARGET_BINDING_REQUIRED",
            message: "managed data source must be renewed with a target binding before access can be issued".into(),
        }
    }

    pub(super) fn desktop_upgrade_required() -> Self {
        Self {
            status: StatusCode::UPGRADE_REQUIRED,
            code: "DESKTOP_UPGRADE_REQUIRED",
            message: "This organization requires a newer OxideStudio desktop version before managed data access can continue.".into(),
        }
    }
}

impl ApiError {
    pub(super) fn internal(error: impl std::fmt::Display) -> Self {
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

impl From<AuthenticationError> for ApiError {
    fn from(error: AuthenticationError) -> Self {
        match error {
            AuthenticationError::Unauthorized(message) => Self {
                status: StatusCode::UNAUTHORIZED,
                code: "UNAUTHENTICATED",
                message: message.into(),
            },
            AuthenticationError::Internal(error) => Self::internal(error),
        }
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
