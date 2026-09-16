use serde::{Deserialize, Serialize};

pub(super) const ADMIN_RESULT_LIMIT: usize = 200;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseAdminSession {
    pub id: String,
    pub user: Option<String>,
    pub host: Option<String>,
    pub database: Option<String>,
    pub state: Option<String>,
    pub statement: Option<String>,
    pub wait: Option<String>,
    pub duration_seconds: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseAdminUser {
    pub name: String,
    pub host: Option<String>,
    pub can_login: Option<bool>,
    pub is_superuser: Option<bool>,
    pub authentication_plugin: Option<String>,
}

/// A read-only role-to-member edge. Account host qualifiers are retained only
/// where the server itself exposes them, so MySQL-family role names remain
/// unambiguous without returning grants, passwords, or SQL text.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseAdminRoleMembership {
    pub role: String,
    pub member: String,
}

/// A bounded, read-only table privilege row. This is visibility only: grant
/// changes remain unavailable until a reviewed diff/confirmation contract is
/// introduced.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseAdminTablePrivilege {
    pub grantee: String,
    pub schema: String,
    pub table: String,
    pub privilege: String,
}

/// A deliberately small, read-only server metric. Values remain strings so a
/// driver cannot lose precision when returning counters larger than a JS safe
/// integer. `available: false` is an explicit capability/permission downgrade,
/// not a zero value.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseAdminMetric {
    pub key: String,
    pub label: String,
    pub value: Option<String>,
    pub unit: String,
    pub description: Option<String>,
    pub available: bool,
}

/// One edge in a server's visible blocking graph. Query text is intentionally
/// omitted: the Sessions view remains the explicit place to inspect a
/// statement, while this endpoint is safe to refresh frequently.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseAdminLockWait {
    pub waiting_session_id: String,
    pub blocking_session_id: String,
    pub waiting_user: Option<String>,
    pub blocking_user: Option<String>,
    pub database: Option<String>,
    pub wait: Option<String>,
    pub duration_seconds: Option<u64>,
}

/// Identity read from the same live session used by the administration
/// commands. The renderer may display a connection name, but it must not be
/// trusted to choose a vendor SQL dialect or to describe the server targeted
/// by a mutation.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseAdminServerIdentity {
    pub driver: String,
    pub database: Option<String>,
    pub account: Option<String>,
    pub server_version: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDatabaseAdminUserRequest {
    pub name: String,
    pub password: Option<String>,
    pub host: Option<String>,
    #[serde(default = "default_true")]
    pub can_login: bool,
    pub confirmed: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDatabaseAdminPasswordRequest {
    pub name: String,
    pub password: String,
    pub host: Option<String>,
    pub confirmed: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetDatabaseAdminLoginRequest {
    pub name: String,
    pub host: Option<String>,
    pub can_login: bool,
    pub confirmed: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteDatabaseAdminUserRequest {
    pub name: String,
    pub host: Option<String>,
    pub confirmed: bool,
}

pub(super) fn default_true() -> bool {
    true
}
