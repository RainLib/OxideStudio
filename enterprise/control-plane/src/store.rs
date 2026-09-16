//! The control-plane persistence facade. Domain modules own their SQL and
//! transactions while this path remains stable for API callers.

mod access;
mod administration;
mod audit;
mod crypto;
mod data_sources;
mod devices;
mod gateways;
mod identity;
mod memberships;
mod models;
mod organization;
mod support;

pub(crate) use access::allowed_paths_for_action;
pub use models::ControlPlaneStore;

const GATEWAY_ENROLLMENT_TTL_MINUTES: i64 = 15;
/// Gate new desktop tickets on the Gateway's signed revocation-feed heartbeat.
///
/// Gateways refresh the feed every five seconds and fail their own data plane
/// closed after twenty seconds without a successful refresh. The control plane
/// uses a slightly larger window so short scheduling or network jitter does not
/// interrupt healthy clients, while an offline Gateway cannot receive fresh
/// tickets indefinitely.
const GATEWAY_TICKET_HEARTBEAT_MAX_AGE_SECONDS: i64 = 30;
