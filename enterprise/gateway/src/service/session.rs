use super::{authorization::authorization_request, models::DataPlaneService};
use crate::proto::RequestScope;
use oxide_enterprise_contracts::{
    certificate_fingerprint, verify_ticket, AccessAction, AccessSessionTicket, AuthorizationRequest,
};
use std::time::{SystemTime, UNIX_EPOCH};
use tonic::{Request, Status};
impl DataPlaneService {
    pub(super) fn authorize(
        &self,
        ticket: &str,
        scope: Option<&RequestScope>,
        expected_action: AccessAction,
        peer_certificate_fingerprint: &str,
    ) -> Result<
        (
            oxide_enterprise_contracts::AccessSessionClaims,
            AuthorizationRequest,
        ),
        Status,
    > {
        let scope = scope.ok_or_else(|| Status::invalid_argument("request scope is required"))?;
        let request = authorization_request(scope, expected_action)?;
        let claims = verify_ticket(
            &AccessSessionTicket(ticket.to_string()),
            &self.verifying_key,
        )
        .map_err(|error| Status::permission_denied(error.to_string()))?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_secs() as i64)
            .unwrap_or(0);
        claims
            .authorizes(&request, self.gateway_id, now)
            .map_err(|error| Status::permission_denied(error.to_string()))?;
        claims
            .authorizes_device_certificate(peer_certificate_fingerprint)
            .map_err(|error| Status::permission_denied(error.to_string()))?;
        self.revocations
            .authorize_device_certificate(&claims.device_certificate_fingerprint)?;
        self.revocations.authorize_ticket_nonce(claims.nonce)?;
        if scope.action != expected_action.as_str() {
            return Err(Status::invalid_argument(
                "request action does not match the RPC operation",
            ));
        }
        Ok((claims, request))
    }

    pub(super) fn peer_certificate_fingerprint<T>(request: &Request<T>) -> Result<String, Status> {
        let certificate = request
            .peer_certs()
            .and_then(|certificates| certificates.first().cloned())
            .ok_or_else(|| {
                Status::unauthenticated("a managed Gateway device certificate is required")
            })?;
        Ok(certificate_fingerprint(certificate.as_ref()))
    }
}
