use super::host_errors::SidecarRequestError;
use super::identity_helpers::now_millis;
use super::turn_state::ActiveTurn;
use crate::core::protocol::QueryResult;
use serde_json::json;
use std::time::Duration;

pub(super) const DEFAULT_TOOL_RESULT_BYTES: usize = 256 * 1024;
pub(super) const MAX_TOOL_RESULT_BYTES: usize = 1024 * 1024;
pub(super) const MAX_TOOL_RESULT_ROWS: usize = 10_000;

pub(super) fn strip_transaction_results(results: &mut Vec<QueryResult>) {
    let first = results
        .first()
        .and_then(|result| result.statement_type.as_deref());
    let last = results
        .last()
        .and_then(|result| result.statement_type.as_deref());
    if first.is_some_and(|kind| {
        kind.eq_ignore_ascii_case("BEGIN") || kind.eq_ignore_ascii_case("START")
    }) && last.is_some_and(|kind| kind.eq_ignore_ascii_case("ROLLBACK"))
    {
        results.remove(0);
        results.pop();
    }
}

pub(super) fn truncate_query_rows(results: &mut [QueryResult], max_rows: usize) {
    let mut remaining = max_rows;
    for result in results {
        if result.rows.len() > remaining {
            result.rows.truncate(remaining);
        }
        remaining = remaining.saturating_sub(result.rows.len());
        if remaining == 0 {
            break;
        }
    }
}

pub(super) fn tool_deadline_duration(
    turn: &ActiveTurn,
    tool_name: &str,
    request_deadline: i64,
) -> std::result::Result<Duration, SidecarRequestError> {
    let remaining = request_deadline
        .min(turn.deadline)
        .saturating_sub(now_millis());
    if remaining <= 0 {
        return Err(SidecarRequestError {
            code: -32_008,
            message: "agent request deadline has expired".to_string(),
            data: Some(json!({"kind":"deadline_exceeded","recoverable":true})),
        });
    }
    let configured = turn
        .tools
        .get(tool_name)
        .and_then(|tool| tool.timeout_ms)
        .unwrap_or(30_000)
        .clamp(100, 120_000);
    Ok(Duration::from_millis(configured.min(remaining as u64)))
}

pub(super) fn non_empty(value: &str) -> Option<&str> {
    (!value.trim().is_empty()).then_some(value)
}

pub(super) fn tool_requires_approval(tool_name: &str, permissions: &[String]) -> bool {
    let reviewable_workspace_write =
        tool_name == "project.writeFile" && permissions.len() == 1 && permissions[0] == "write";
    !reviewable_workspace_write
        && permissions
            .iter()
            .any(|permission| matches!(permission.as_str(), "write" | "destructive" | "external"))
}
