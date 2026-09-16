use super::connection_types::ResolvedAgentConnection;
use super::host_errors::SidecarRequestError;
use super::identity_helpers::{bounded_text, input_digest};
use super::native_read_only::{
    contains_native_transaction_control, validate_native_read_only_query,
};
use super::review_types::ApprovedQueryReview;
use crate::core::dialect::canonical_driver_name;
use crate::core::dialect::DatabaseKind;
use crate::core::statement::execution_statement_kind;
use crate::core::statement::split_sql_statements;
use crate::core::statement::validate_read_only_sql;
use crate::core::statement::StatementKind;
use crate::core::statement::StatementScanDialect;
use crate::core::store::SavedConnection as StoreSavedConnection;
use serde_json::json;
use serde_json::Value;

pub(super) fn required_input_text(
    input: &Value,
    field: &str,
    max_chars: usize,
) -> std::result::Result<String, SidecarRequestError> {
    let value = input
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| SidecarRequestError::invalid_params(format!("{field} is required")))?;
    if value.chars().count() > max_chars {
        return Err(SidecarRequestError::invalid_params(format!(
            "{field} exceeds {max_chars} characters"
        )));
    }
    Ok(value.to_string())
}

pub(super) fn resolve_prompt_connection<'a>(
    connections: &'a [StoreSavedConnection],
    prompt: &str,
) -> Option<&'a StoreSavedConnection> {
    let normalized_prompt = prompt.to_lowercase();
    let name_matches = connections
        .iter()
        .filter(|connection| {
            let name = connection.name.trim().to_lowercase();
            name.chars().count() >= 3 && normalized_prompt.contains(&name)
        })
        .collect::<Vec<_>>();
    let hinted_drivers = [
        ("elasticsearch", ["elasticsearch", "elastic", "es", "", ""]),
        ("mongodb", ["mongodb", "mongo", "", "", ""]),
        ("postgres", ["postgresql", "postgres", "pgsql", "pg", ""]),
        ("mysql", ["mysql", "", "", "", ""]),
        ("sqlite", ["sqlite", "sqlite3", "", "", ""]),
        ("redis", ["redis", "", "", "", ""]),
    ]
    .into_iter()
    .filter_map(|(driver, aliases)| {
        aliases
            .iter()
            .filter(|alias| !alias.is_empty())
            .any(|alias| contains_ascii_bounded_alias(&normalized_prompt, alias))
            .then_some(driver)
    })
    .collect::<Vec<_>>();
    if hinted_drivers.len() > 1 {
        return None;
    }
    let Some(driver) = hinted_drivers.first() else {
        return match name_matches.as_slice() {
            [connection] => Some(*connection),
            _ => None,
        };
    };
    let driver_matches = connections
        .iter()
        .filter(|connection| connection.driver.eq_ignore_ascii_case(driver))
        .collect::<Vec<_>>();
    if let [connection] = name_matches.as_slice() {
        if connection.driver.eq_ignore_ascii_case(driver) {
            return Some(*connection);
        }
    }
    match driver_matches.as_slice() {
        [connection] => Some(*connection),
        _ => None,
    }
}

pub(super) fn contains_ascii_bounded_alias(value: &str, alias: &str) -> bool {
    value.match_indices(alias).any(|(start, matched)| {
        let before = value[..start].chars().next_back();
        let end = start + matched.len();
        let after = value[end..].chars().next();
        !before.is_some_and(is_ascii_identifier_character)
            && !after.is_some_and(is_ascii_identifier_character)
    })
}

pub(super) fn is_ascii_identifier_character(value: char) -> bool {
    value.is_ascii_alphanumeric() || value == '_'
}

pub(super) fn database_kind_for_dialect(dialect: StatementScanDialect) -> Option<DatabaseKind> {
    match dialect {
        StatementScanDialect::Postgres => Some(DatabaseKind::Postgres),
        StatementScanDialect::Mysql => Some(DatabaseKind::Mysql),
        StatementScanDialect::SqlServer => None,
    }
}

pub(super) fn read_only_transaction_script(kind: DatabaseKind, sql: &str) -> String {
    let begin = match kind {
        DatabaseKind::Postgres => "BEGIN READ ONLY;",
        DatabaseKind::Mysql => "START TRANSACTION READ ONLY;",
    };
    format!("{begin}\n{}\n;\nROLLBACK;", sql.trim())
}

pub(super) fn review_approved_query_input(
    driver: &str,
    dialect: Option<StatementScanDialect>,
    query: &str,
    connection_id: &str,
) -> std::result::Result<ApprovedQueryReview, String> {
    let query = query.trim();
    if query.is_empty() {
        return Err("query is required".to_string());
    }
    let canonical = canonical_driver_name(driver)
        .unwrap_or(driver.trim())
        .to_ascii_lowercase();
    let (operation_type, destructive) = if let Some(dialect) = dialect {
        let statements = split_sql_statements(query, dialect);
        if statements.len() != 1 {
            return Err(
                "query.executeApproved requires exactly one complete SQL statement".to_string(),
            );
        }
        if validate_read_only_sql(statements[0], dialect).is_ok() {
            return Err("Read-only SQL must use query.runReadOnly".to_string());
        }
        let kind = execution_statement_kind(statements[0]);
        if matches!(
            kind,
            StatementKind::Begin
                | StatementKind::Start
                | StatementKind::Commit
                | StatementKind::Rollback
                | StatementKind::Savepoint
                | StatementKind::Release
                | StatementKind::Set
                | StatementKind::Use
        ) {
            return Err(
                "Transaction and session control statements are forbidden for Agent execution"
                    .to_string(),
            );
        }
        let destructive = matches!(
            kind,
            StatementKind::Create
                | StatementKind::Alter
                | StatementKind::Drop
                | StatementKind::Truncate
                | StatementKind::Comment
                | StatementKind::Rename
        );
        (kind.as_str().to_string(), destructive)
    } else {
        if validate_native_read_only_query(&canonical, query).is_ok() {
            return Err("Read-only native operations must use query.runReadOnly".to_string());
        }
        match canonical.as_str() {
            "mongodb" => review_mongodb_mutation(query)?,
            "redis" => review_redis_mutation(query)?,
            "elasticsearch" => review_elasticsearch_mutation(query)?,
            _ => {
                return Err(format!(
                    "query.executeApproved is unsupported for driver {}",
                    bounded_text(&canonical, 80)
                ));
            }
        }
    };
    let confirmation_phrase = destructive.then(|| format!("EXECUTE {operation_type}"));
    Ok(ApprovedQueryReview {
        summary: format!(
            "Approve one {operation_type} operation on connection {}. The exact input is digest-bound and can be executed once.",
            bounded_text(connection_id, 80)
        ),
        operation_type,
        destructive,
        confirmation_phrase,
    })
}

pub(super) fn mutation_policy_digest(
    target: &ResolvedAgentConnection,
    input_digest_value: &str,
    operation_type: &str,
) -> String {
    input_digest(&json!({
        "policy":"oxide-agent-approved-query-v1",
        "projectId":target.config.project_id,
        "connectionId":target.id,
        "connectionConfigDigest":target.config_digest,
        "database":target.database,
        "namespace":target.namespace,
        "environment":target.config.environment,
        "protectedDatabases":target.config.production_databases,
        "inputDigest":input_digest_value,
        "operationType":operation_type,
    }))
}

pub(super) fn review_mongodb_mutation(query: &str) -> std::result::Result<(String, bool), String> {
    let value: Value = serde_json::from_str(query)
        .map_err(|_| "MongoDB mutation must be one valid JSON object".to_string())?;
    let object = value.as_object().ok_or_else(|| {
        "MongoDB mutation must contain exactly one JSON command object".to_string()
    })?;
    if contains_native_transaction_control(&value) {
        return Err("MongoDB transaction and session controls are forbidden".to_string());
    }
    let operations = object
        .keys()
        .filter_map(|key| {
            let normalized = key.to_ascii_lowercase();
            matches!(
                normalized.as_str(),
                "insertone"
                    | "insertmany"
                    | "updateone"
                    | "updatemany"
                    | "replaceone"
                    | "deleteone"
                    | "deletemany"
                    | "findoneandupdate"
                    | "findoneandreplace"
                    | "findoneanddelete"
                    | "drop"
                    | "dropdatabase"
                    | "create"
                    | "createindexes"
                    | "dropindexes"
                    | "renamecollection"
                    | "command"
            )
            .then_some(normalized)
        })
        .collect::<Vec<_>>();
    if operations.len() != 1 {
        return Err("MongoDB mutation must contain exactly one recognized operation".to_string());
    }
    let operation = operations[0].to_ascii_uppercase();
    let destructive = matches!(
        operations[0].as_str(),
        "deleteone"
            | "deletemany"
            | "findoneanddelete"
            | "drop"
            | "dropdatabase"
            | "dropindexes"
            | "renamecollection"
    );
    Ok((operation, destructive))
}

pub(super) fn review_redis_mutation(query: &str) -> std::result::Result<(String, bool), String> {
    let commands = query
        .split(['\n', '\r', ';'])
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .collect::<Vec<_>>();
    if commands.len() != 1 {
        return Err("Redis Agent execution requires exactly one command".to_string());
    }
    let operation = commands[0]
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    if operation.is_empty()
        || matches!(
            operation.as_str(),
            "MULTI" | "EXEC" | "DISCARD" | "WATCH" | "UNWATCH" | "SELECT"
        )
    {
        return Err(
            "Redis transaction, watch, and database-selection commands are forbidden".to_string(),
        );
    }
    let destructive = matches!(
        operation.as_str(),
        "DEL" | "UNLINK" | "FLUSHALL" | "FLUSHDB" | "RENAME" | "RENAMENX"
    );
    Ok((operation, destructive))
}

pub(super) fn review_elasticsearch_mutation(
    query: &str,
) -> std::result::Result<(String, bool), String> {
    let request_lines = query
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let method = parts.next()?.to_ascii_uppercase();
            matches!(
                method.as_str(),
                "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE"
            )
            .then(|| (method, parts.next().unwrap_or_default().to_string()))
        })
        .collect::<Vec<_>>();
    if request_lines.len() != 1 || request_lines[0].1.trim().is_empty() {
        return Err(
            "Elasticsearch Agent execution requires exactly one Kibana-style request".to_string(),
        );
    }
    if request_lines[0].1.contains("://") {
        return Err("Elasticsearch request paths must be relative".to_string());
    }
    let (method, path) = &request_lines[0];
    let normalized_path = path.to_ascii_lowercase();
    let destructive = method == "DELETE"
        || normalized_path.contains("_delete_by_query")
        || normalized_path.contains("_close")
        || normalized_path.contains("_forcemerge");
    Ok((format!("{method} REQUEST"), destructive))
}
