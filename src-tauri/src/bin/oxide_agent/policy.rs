use serde_json::Value;
use thiserror::Error;

const MAX_SCOPE_ID_CHARS: usize = 128;
const MAX_DATABASE_NAME_CHARS: usize = 256;
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
    database_scope: DatabaseScope,
    tool_scope: ToolScope,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum DatabaseScope {
    #[default]
    All,
    Selected(Vec<String>),
    None,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum ToolScope {
    #[default]
    All,
    Selected(Vec<String>),
    None,
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
    #[error("database access is disabled for this grant")]
    DatabaseAccessDisabled,
    #[error("database '{0}' is outside the granted database scope")]
    DatabaseOutsideGrant(String),
    #[error("multiple databases are granted; select one explicitly")]
    DatabaseSelectionRequired,
    #[error("tool access is disabled for this grant")]
    ToolAccessDisabled,
    #[error("tool '{0}' is outside the granted tool scope")]
    ToolOutsideGrant(String),
    #[error("caller-reported approval is not accepted; OxideStudio never trusts approved/approvalLease input fields")]
    SelfReportedApproval,
}

impl Grant {
    #[cfg(test)]
    pub fn new_with_database_scope(
        project_id: String,
        connection_id: Option<String>,
        max_rows: usize,
        max_result_bytes: usize,
        database_scope: DatabaseScope,
    ) -> Result<Self, PolicyError> {
        Self::new_with_scopes(
            project_id,
            connection_id,
            max_rows,
            max_result_bytes,
            database_scope,
            ToolScope::All,
        )
    }

    pub fn new_with_scopes(
        project_id: String,
        connection_id: Option<String>,
        max_rows: usize,
        max_result_bytes: usize,
        database_scope: DatabaseScope,
        tool_scope: ToolScope,
    ) -> Result<Self, PolicyError> {
        let project_id = validate_scope(project_id, "project")?;
        let connection_id = connection_id
            .map(|value| validate_scope(value, "connection"))
            .transpose()?;
        let database_scope = database_scope.normalized()?;
        let tool_scope = tool_scope.normalized()?;
        Ok(Self {
            project_id,
            connection_id,
            max_rows: max_rows.clamp(1, 1_000),
            max_result_bytes: max_result_bytes.clamp(4_096, 1_048_576),
            database_scope,
            tool_scope,
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

    pub fn resolve_database(
        &self,
        requested: Option<&str>,
        connection_default: Option<&str>,
    ) -> Result<Option<String>, PolicyError> {
        let requested = requested.map(str::trim).filter(|value| !value.is_empty());
        let connection_default = connection_default
            .map(str::trim)
            .filter(|value| !value.is_empty());
        match &self.database_scope {
            DatabaseScope::All => Ok(requested.or(connection_default).map(ToOwned::to_owned)),
            DatabaseScope::None => Err(PolicyError::DatabaseAccessDisabled),
            DatabaseScope::Selected(allowed) => {
                let selected = if let Some(requested) = requested {
                    requested
                } else if let Some(default) = connection_default.filter(|default| {
                    allowed
                        .iter()
                        .any(|allowed| database_names_match(default, allowed))
                }) {
                    default
                } else if let [only] = allowed.as_slice() {
                    only
                } else {
                    return Err(PolicyError::DatabaseSelectionRequired);
                };
                allowed
                    .iter()
                    .find(|allowed| database_names_match(selected, allowed))
                    .cloned()
                    .map(Some)
                    .ok_or_else(|| PolicyError::DatabaseOutsideGrant(selected.to_string()))
            }
        }
    }

    pub fn allowed_databases(&self) -> Option<&[String]> {
        match &self.database_scope {
            DatabaseScope::All => None,
            DatabaseScope::Selected(databases) => Some(databases),
            DatabaseScope::None => Some(&[]),
        }
    }

    pub fn allows_tool(&self, tool_name: &str) -> bool {
        match &self.tool_scope {
            ToolScope::All => true,
            ToolScope::Selected(tools) => tools.iter().any(|tool| tool == tool_name),
            ToolScope::None => false,
        }
    }

    pub fn require_tool(&self, tool_name: &str) -> Result<(), PolicyError> {
        match &self.tool_scope {
            ToolScope::All => Ok(()),
            ToolScope::Selected(tools) if tools.iter().any(|tool| tool == tool_name) => Ok(()),
            ToolScope::Selected(_) => Err(PolicyError::ToolOutsideGrant(tool_name.to_string())),
            ToolScope::None => Err(PolicyError::ToolAccessDisabled),
        }
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

impl DatabaseScope {
    fn normalized(self) -> Result<Self, PolicyError> {
        let Self::Selected(databases) = self else {
            return Ok(self);
        };
        let mut normalized = Vec::<String>::new();
        for database in databases {
            let database = validate_database_name(database)?;
            if !normalized
                .iter()
                .any(|existing| database_names_match(existing, &database))
            {
                normalized.push(database);
            }
        }
        normalized.sort_by_key(|database| database.to_ascii_lowercase());
        if normalized.is_empty() {
            Ok(Self::None)
        } else {
            Ok(Self::Selected(normalized))
        }
    }
}

impl ToolScope {
    fn normalized(self) -> Result<Self, PolicyError> {
        let Self::Selected(tools) = self else {
            return Ok(self);
        };
        let mut normalized = Vec::<String>::new();
        for tool in tools {
            let tool = validate_tool_name(tool)?;
            if !normalized.iter().any(|existing| existing == &tool) {
                normalized.push(tool);
            }
        }
        normalized.sort();
        if normalized.is_empty() {
            Ok(Self::None)
        } else {
            Ok(Self::Selected(normalized))
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

fn validate_database_name(value: String) -> Result<String, PolicyError> {
    let value = value.trim().to_string();
    if value.is_empty() {
        return Err(PolicyError::MissingScope("database"));
    }
    if value.chars().count() > MAX_DATABASE_NAME_CHARS
        || value.chars().any(|character| character.is_control())
    {
        return Err(PolicyError::InvalidScope("database"));
    }
    Ok(value)
}

fn validate_tool_name(value: String) -> Result<String, PolicyError> {
    let value = value.trim().to_string();
    if value.is_empty() {
        return Err(PolicyError::MissingScope("tool"));
    }
    if value.chars().count() > MAX_SCOPE_ID_CHARS
        || value
            .chars()
            .any(|character| character.is_control() || character.is_whitespace())
    {
        return Err(PolicyError::InvalidScope("tool"));
    }
    Ok(value)
}

fn database_names_match(left: &str, right: &str) -> bool {
    left.trim()
        .trim_matches(|character| matches!(character, '`' | '"' | '[' | ']'))
        .eq_ignore_ascii_case(
            right
                .trim()
                .trim_matches(|character| matches!(character, '`' | '"' | '[' | ']')),
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn project_grant(connection: Option<&str>) -> Grant {
        Grant::new_with_database_scope(
            "project-a".to_string(),
            connection.map(ToString::to_string),
            200,
            256 * 1024,
            DatabaseScope::All,
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

    #[test]
    fn selected_database_grant_defaults_and_rejects_scope_expansion() {
        let grant = Grant::new_with_database_scope(
            "project-a".to_string(),
            Some("connection-a".to_string()),
            200,
            256 * 1024,
            DatabaseScope::Selected(vec!["reporting".to_string()]),
        )
        .unwrap();
        assert_eq!(
            grant.resolve_database(None, Some("production")).unwrap(),
            Some("reporting".to_string())
        );
        assert_eq!(
            grant
                .resolve_database(Some("production"), Some("reporting"))
                .unwrap_err(),
            PolicyError::DatabaseOutsideGrant("production".to_string())
        );
        assert_eq!(
            grant.allowed_databases(),
            Some(["reporting".to_string()].as_slice())
        );
    }

    #[test]
    fn empty_selected_database_scope_denies_query_access() {
        let grant = Grant::new_with_database_scope(
            "project-a".to_string(),
            None,
            200,
            256 * 1024,
            DatabaseScope::Selected(Vec::new()),
        )
        .unwrap();
        assert_eq!(
            grant.resolve_database(None, Some("reporting")).unwrap_err(),
            PolicyError::DatabaseAccessDisabled
        );
    }

    #[test]
    fn selected_tool_scope_is_normalized_and_cannot_be_expanded() {
        let grant = Grant::new_with_scopes(
            "project-a".to_string(),
            None,
            200,
            256 * 1024,
            DatabaseScope::All,
            ToolScope::Selected(vec![
                "query.runReadOnly".to_string(),
                "metadata.listObjects".to_string(),
                "query.runReadOnly".to_string(),
            ]),
        )
        .unwrap();
        assert!(grant.allows_tool("query.runReadOnly"));
        assert!(grant.allows_tool("metadata.listObjects"));
        assert!(!grant.allows_tool("connection.listSummaries"));
        assert_eq!(
            grant.require_tool("connection.listSummaries").unwrap_err(),
            PolicyError::ToolOutsideGrant("connection.listSummaries".to_string())
        );
    }
}
