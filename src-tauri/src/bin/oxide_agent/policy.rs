use serde_json::Value;
use thiserror::Error;

const MAX_SCOPE_ID_CHARS: usize = 128;
const APPROVAL_KEYS: &[&str] = &[
    "approved",
    "approval",
    "approvallease",
    "approvaltoken",
    "isapproved",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Grant {
    project_id: String,
    connection_id: Option<String>,
    max_rows: usize,
    max_result_bytes: usize,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum PolicyError {
    #[error("{0} is required")]
    MissingScope(&'static str),
    #[error("{0} contains invalid control characters or exceeds {MAX_SCOPE_ID_CHARS} characters")]
    InvalidScope(&'static str),
    #[error("connection '{0}' is outside the granted connection scope")]
    ConnectionOutsideGrant(String),
    #[error("connection '{0}' is not part of the granted project")]
    ConnectionOutsideProject(String),
    #[error("multiple connections are available; select one explicitly")]
    ConnectionSelectionRequired,
    #[error("no saved connection is available inside the granted scope")]
    ConnectionUnavailable,
    #[error("caller-reported approval is not accepted; OxideStudio never trusts approved/approvalLease input fields")]
    SelfReportedApproval,
}

impl Grant {
    pub fn new(
        project_id: String,
        connection_id: Option<String>,
        max_rows: usize,
        max_result_bytes: usize,
    ) -> Result<Self, PolicyError> {
        let project_id = validate_scope(project_id, "project")?;
        let connection_id = connection_id
            .map(|value| validate_scope(value, "connection"))
            .transpose()?;
        Ok(Self {
            project_id,
            connection_id,
            max_rows: max_rows.clamp(1, 1_000),
            max_result_bytes: max_result_bytes.clamp(4_096, 1_048_576),
        })
    }

    pub fn project_id(&self) -> &str {
        &self.project_id
    }

    pub fn connection_id(&self) -> Option<&str> {
        self.connection_id.as_deref()
    }

    pub fn max_rows(&self) -> usize {
        self.max_rows
    }

    pub fn max_result_bytes(&self) -> usize {
        self.max_result_bytes
    }

    pub fn resolve_connection<'a, I>(
        &self,
        requested: Option<&str>,
        project_connections: I,
    ) -> Result<String, PolicyError>
    where
        I: IntoIterator<Item = &'a str>,
    {
        let project_connections: Vec<&str> = project_connections.into_iter().collect();
        if let Some(granted) = self.connection_id() {
            if requested.is_some_and(|requested| requested != granted) {
                return Err(PolicyError::ConnectionOutsideGrant(
                    requested.unwrap_or_default().to_string(),
                ));
            }
            if project_connections.contains(&granted) {
                return Ok(granted.to_string());
            }
            return Err(PolicyError::ConnectionUnavailable);
        }

        if let Some(requested) = requested {
            if project_connections.contains(&requested) {
                return Ok(requested.to_string());
            }
            return Err(PolicyError::ConnectionOutsideProject(requested.to_string()));
        }

        match project_connections.as_slice() {
            [] => Err(PolicyError::ConnectionUnavailable),
            [only] => Ok((*only).to_string()),
            _ => Err(PolicyError::ConnectionSelectionRequired),
        }
    }
}

pub fn reject_self_reported_approval(value: &Value) -> Result<(), PolicyError> {
    if has_self_reported_approval(value) {
        Err(PolicyError::SelfReportedApproval)
    } else {
        Ok(())
    }
}

fn has_self_reported_approval(value: &Value) -> bool {
    match value {
        Value::Object(object) => object.iter().any(|(key, value)| {
            let normalized: String = key
                .chars()
                .filter(|character| character.is_ascii_alphanumeric())
                .flat_map(char::to_lowercase)
                .collect();
            APPROVAL_KEYS.contains(&normalized.as_str()) || has_self_reported_approval(value)
        }),
        Value::Array(values) => values.iter().any(has_self_reported_approval),
        _ => false,
    }
}

fn validate_scope(value: String, label: &'static str) -> Result<String, PolicyError> {
    let value = value.trim().to_string();
    if value.is_empty() {
        return Err(PolicyError::MissingScope(label));
    }
    if value.chars().count() > MAX_SCOPE_ID_CHARS
        || value.chars().any(|character| character.is_control())
    {
        return Err(PolicyError::InvalidScope(label));
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn project_grant(connection: Option<&str>) -> Grant {
        Grant::new(
            "project-a".to_string(),
            connection.map(ToString::to_string),
            200,
            256 * 1024,
        )
        .unwrap()
    }

    #[test]
    fn connection_grant_cannot_be_expanded_by_tool_input() {
        let grant = project_grant(Some("connection-a"));
        let error = grant
            .resolve_connection(Some("connection-b"), ["connection-a", "connection-b"])
            .unwrap_err();
        assert_eq!(
            error,
            PolicyError::ConnectionOutsideGrant("connection-b".to_string())
        );
    }

    #[test]
    fn project_grant_requires_selection_when_multiple_connections_exist() {
        let grant = project_grant(None);
        assert_eq!(
            grant
                .resolve_connection(None, ["connection-a", "connection-b"])
                .unwrap_err(),
            PolicyError::ConnectionSelectionRequired
        );
    }

    #[test]
    fn caller_approval_claims_are_rejected_even_inside_meta() {
        for value in [
            json!({"approved": true}),
            json!({"_meta": {"approved": true}}),
            json!({"approvalLease": "caller-made"}),
        ] {
            assert_eq!(
                reject_self_reported_approval(&value).unwrap_err(),
                PolicyError::SelfReportedApproval
            );
        }
    }
}
