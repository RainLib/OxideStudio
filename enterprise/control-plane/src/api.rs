mod access;
mod admin;
mod gateway;
mod identity;
mod models;
mod support;
#[cfg(test)]
mod tests;

pub use models::AppState;

use access::create_access_session;
use admin::{
    activate_member, admin_audit_events, admin_overview, assign_project, create_access_grant,
    create_managed_project, create_organization, invite_member, register_data_source,
    register_managed_device, renew_data_source_target_binding, revoke_access_ticket,
    revoke_managed_device, set_minimum_desktop_version, suspend_member,
    transfer_organization_ownership,
};
use axum::{
    routing::{get, post},
    Router,
};
use gateway::{
    activate_gateway_enrollment, gateway_revocation_snapshot, register_gateway, revoke_gateway,
    rotate_gateway_certificate,
};
use identity::{managed_projects, me};

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
            "/v1/admin/organizations/{organization_id}/data-sources/{data_source_id}/target-binding",
            post(renew_data_source_target_binding),
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
