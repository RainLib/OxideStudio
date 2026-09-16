//! Reviewed MySQL/MariaDB EVENT administration.
//!
//! The renderer selects a closed action/schedule vocabulary. The Host verifies
//! the live bundled driver, event identity and current metadata before it
//! returns or executes one generated statement.

use super::identity::confirmed_admin_kind;
use super::support::{
    database_admin_error_response, mysql_identifier, primary_result, result_row, sql_string,
    validate_text, value_string,
};
use crate::core::{
    dialect::DatabaseKind,
    manager::ConnectionManager,
    protocol::{QueryParameter, Response},
    statement::{
        execution_statement_kind, split_sql_statements, StatementKind, StatementScanDialect,
    },
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;

const EVENT_RESULT_LIMIT: usize = 200;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseAdminEvent {
    pub schema: String,
    pub name: String,
    pub definer: Option<String>,
    pub time_zone: Option<String>,
    pub event_type: Option<String>,
    pub execute_at: Option<String>,
    pub interval_value: Option<String>,
    pub interval_field: Option<String>,
    pub starts: Option<String>,
    pub ends: Option<String>,
    pub status: Option<String>,
    pub on_completion: Option<String>,
    pub comment: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub last_executed: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseAdminEventCatalog {
    pub scheduler_status: Option<String>,
    pub events: Vec<DatabaseAdminEvent>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DatabaseAdminEventIntervalUnit {
    Second,
    Minute,
    Hour,
    Day,
    Week,
    Month,
    Quarter,
    Year,
}

impl DatabaseAdminEventIntervalUnit {
    const fn sql(self) -> &'static str {
        match self {
            Self::Second => "SECOND",
            Self::Minute => "MINUTE",
            Self::Hour => "HOUR",
            Self::Day => "DAY",
            Self::Week => "WEEK",
            Self::Month => "MONTH",
            Self::Quarter => "QUARTER",
            Self::Year => "YEAR",
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DatabaseAdminEventSchedule {
    Once {
        execute_at: String,
    },
    Interval {
        interval_value: u32,
        interval_unit: DatabaseAdminEventIntervalUnit,
        starts: Option<String>,
        ends: Option<String>,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreateDatabaseAdminEvent {
    pub schema: String,
    pub name: String,
    pub schedule: DatabaseAdminEventSchedule,
    #[serde(default)]
    pub preserve_after_completion: bool,
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub comment: Option<String>,
    pub body: String,
}

const fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum DatabaseAdminEventMutation {
    Create {
        event: CreateDatabaseAdminEvent,
    },
    SetEnabled {
        schema: String,
        name: String,
        enabled: bool,
    },
    Delete {
        schema: String,
        name: String,
    },
}

impl DatabaseAdminEventMutation {
    const fn action_name(&self) -> &'static str {
        match self {
            Self::Create { .. } => "create",
            Self::SetEnabled { enabled: true, .. } => "enable",
            Self::SetEnabled { enabled: false, .. } => "disable",
            Self::Delete { .. } => "delete",
        }
    }

    fn target(&self) -> (&str, &str) {
        match self {
            Self::Create { event } => (&event.schema, &event.name),
            Self::SetEnabled { schema, name, .. } | Self::Delete { schema, name } => (schema, name),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteDatabaseAdminEventMutation {
    pub mutation: DatabaseAdminEventMutation,
    pub confirmation_token: String,
    pub confirmation_text: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseAdminEventPlan {
    pub action: String,
    pub target: String,
    pub summary: String,
    pub risk: String,
    pub sql_preview: String,
    pub confirmation_text: String,
    pub confirmation_token: String,
    pub server_version: Option<String>,
}

fn event_list_sql() -> &'static str {
    "SELECT EVENT_SCHEMA, EVENT_NAME, DEFINER, TIME_ZONE, EVENT_TYPE, EXECUTE_AT, \
     INTERVAL_VALUE, INTERVAL_FIELD, STARTS, ENDS, STATUS, ON_COMPLETION, EVENT_COMMENT, \
     CREATED, LAST_ALTERED, LAST_EXECUTED \
     FROM information_schema.EVENTS \
     WHERE EVENT_SCHEMA = ? ORDER BY EVENT_NAME LIMIT 200"
}

fn event_identity_sql() -> &'static str {
    "SELECT EVENT_SCHEMA, EVENT_NAME, DEFINER, TIME_ZONE, EVENT_TYPE, EXECUTE_AT, \
     INTERVAL_VALUE, INTERVAL_FIELD, STARTS, ENDS, STATUS, ON_COMPLETION, EVENT_COMMENT, \
     CREATED, LAST_ALTERED, LAST_EXECUTED \
     FROM information_schema.EVENTS \
     WHERE EVENT_SCHEMA = ? AND EVENT_NAME = ? LIMIT 1"
}

fn event_from_row(
    result: &crate::core::protocol::QueryResult,
    row: &[serde_json::Value],
) -> DatabaseAdminEvent {
    DatabaseAdminEvent {
        schema: value_string(result_row(result, row, "EVENT_SCHEMA")).unwrap_or_default(),
        name: value_string(result_row(result, row, "EVENT_NAME")).unwrap_or_default(),
        definer: value_string(result_row(result, row, "DEFINER")),
        time_zone: value_string(result_row(result, row, "TIME_ZONE")),
        event_type: value_string(result_row(result, row, "EVENT_TYPE")),
        execute_at: value_string(result_row(result, row, "EXECUTE_AT")),
        interval_value: value_string(result_row(result, row, "INTERVAL_VALUE")),
        interval_field: value_string(result_row(result, row, "INTERVAL_FIELD")),
        starts: value_string(result_row(result, row, "STARTS")),
        ends: value_string(result_row(result, row, "ENDS")),
        status: value_string(result_row(result, row, "STATUS")),
        on_completion: value_string(result_row(result, row, "ON_COMPLETION")),
        comment: value_string(result_row(result, row, "EVENT_COMMENT")),
        created_at: value_string(result_row(result, row, "CREATED")),
        updated_at: value_string(result_row(result, row, "LAST_ALTERED")),
        last_executed: value_string(result_row(result, row, "LAST_EXECUTED")),
    }
}

fn parameter(value: &str) -> QueryParameter {
    QueryParameter {
        value: serde_json::Value::String(value.to_string()),
        data_type: Some("TEXT".to_string()),
    }
}

async fn confirm_mysql_event_admin(
    manager: &ConnectionManager,
    connection_id: &str,
    requested_driver: &str,
) -> Result<Option<String>, String> {
    let (kind, _) = confirmed_admin_kind(manager, connection_id, requested_driver).await?;
    if kind != DatabaseKind::Mysql {
        return Err(
            "Event administration is available only for MySQL and MariaDB connections".to_string(),
        );
    }
    manager
        .server_version(connection_id)
        .await
        .map_err(|error| error.to_string())
}

async fn resolve_event(
    manager: &ConnectionManager,
    connection_id: &str,
    schema: &str,
    name: &str,
) -> Result<Option<DatabaseAdminEvent>, String> {
    let result = primary_result(
        manager
            .query_parameterized(
                connection_id,
                event_identity_sql(),
                &[parameter(schema), parameter(name)],
            )
            .await
            .map_err(|error| error.to_string())?,
    )?;
    Ok(result.rows.first().map(|row| event_from_row(&result, row)))
}

fn qualified_event(schema: &str, name: &str) -> String {
    format!("{}.{}", mysql_identifier(schema), mysql_identifier(name))
}

fn timestamp_literal(value: &str, field: &str) -> Result<String, String> {
    let value = validate_text(value, field, 64)?;
    Ok(sql_string(value))
}

fn validated_event_body(body: &str) -> Result<&str, String> {
    let body = validate_text(body, "Event body", 16 * 1024)?;
    let statements = split_sql_statements(body, StatementScanDialect::Mysql);
    if statements.len() != 1 {
        return Err("Event body must contain exactly one SQL statement".to_string());
    }
    let statement = statements[0].trim().trim_end_matches(';').trim();
    let leading = statement
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    let allowed = matches!(
        execution_statement_kind(statement),
        StatementKind::Insert | StatementKind::Update | StatementKind::Delete
    ) || matches!(leading.as_str(), "CALL" | "REPLACE");
    if !allowed {
        return Err(
            "Event body may contain one INSERT, UPDATE, DELETE, REPLACE, or CALL statement"
                .to_string(),
        );
    }
    Ok(statement)
}

/// Reusable closed-vocabulary Event DDL builder. Schema-diff capture uses the
/// same validation as the administration surface, so a catalog row can never
/// become an unrestricted raw-DDL execution path.
pub(crate) fn create_event_sql(event: &CreateDatabaseAdminEvent) -> Result<String, String> {
    let schema = validate_text(&event.schema, "Event schema", 255)?;
    let name = validate_text(&event.name, "Event name", 255)?;
    let body = validated_event_body(&event.body)?;
    let schedule = match &event.schedule {
        DatabaseAdminEventSchedule::Once { execute_at } => {
            format!(
                "AT {}",
                timestamp_literal(execute_at, "Event execution time")?
            )
        }
        DatabaseAdminEventSchedule::Interval {
            interval_value,
            interval_unit,
            starts,
            ends,
        } => {
            if *interval_value == 0 || *interval_value > 1_000_000 {
                return Err("Invalid event interval; choose a value from 1 to 1000000".to_string());
            }
            let mut value = format!("EVERY {interval_value} {}", interval_unit.sql());
            if let Some(starts) = starts.as_deref().filter(|value| !value.trim().is_empty()) {
                value.push_str(" STARTS ");
                value.push_str(&timestamp_literal(starts, "Event start time")?);
            }
            if let Some(ends) = ends.as_deref().filter(|value| !value.trim().is_empty()) {
                value.push_str(" ENDS ");
                value.push_str(&timestamp_literal(ends, "Event end time")?);
            }
            value
        }
    };
    let mut sql = format!(
        "CREATE EVENT {} ON SCHEDULE {schedule} ON COMPLETION {} {}",
        qualified_event(schema, name),
        if event.preserve_after_completion {
            "PRESERVE"
        } else {
            "NOT PRESERVE"
        },
        if event.enabled { "ENABLE" } else { "DISABLE" }
    );
    if let Some(comment) = event.comment.as_deref() {
        let comment = validate_text(comment, "Event comment", 1024)?;
        sql.push_str(" COMMENT ");
        sql.push_str(&sql_string(comment));
    }
    sql.push_str(" DO ");
    sql.push_str(body);
    sql.push(';');
    Ok(sql)
}

fn event_snapshot_marker(event: Option<&DatabaseAdminEvent>) -> String {
    event.map_or_else(
        || "missing".to_string(),
        |event| {
            [
                event.schema.as_str(),
                event.name.as_str(),
                event.status.as_deref().unwrap_or(""),
                event.updated_at.as_deref().unwrap_or(""),
                event.last_executed.as_deref().unwrap_or(""),
            ]
            .join("\0")
        },
    )
}

fn event_plan_token(
    connection_id: &str,
    server_version: Option<&str>,
    mutation: &DatabaseAdminEventMutation,
    sql: &str,
    marker: &str,
) -> String {
    let mut digest = Sha256::new();
    for value in [
        "oxide-database-admin-event-v1",
        connection_id,
        server_version.unwrap_or("unknown"),
        mutation.action_name(),
        sql,
        marker,
    ] {
        digest.update(value.as_bytes());
        digest.update([0]);
    }
    format!("{:x}", digest.finalize())
}

async fn build_event_plan(
    manager: &ConnectionManager,
    connection_id: &str,
    requested_driver: &str,
    mutation: &DatabaseAdminEventMutation,
) -> Result<DatabaseAdminEventPlan, String> {
    let server_version =
        confirm_mysql_event_admin(manager, connection_id, requested_driver).await?;
    let (schema, name) = mutation.target();
    let schema = validate_text(schema, "Event schema", 255)?;
    let name = validate_text(name, "Event name", 255)?;
    let current = resolve_event(manager, connection_id, schema, name).await?;
    let target = format!("{schema}.{name}");
    let (summary, risk, confirmation_text, sql) = match mutation {
        DatabaseAdminEventMutation::Create { event } => {
            if current.is_some() {
                return Err(
                    "Event target already exists; refresh and choose another name".to_string(),
                );
            }
            (
                "Create a scheduled database event",
                "high",
                format!("CREATE EVENT {target}"),
                create_event_sql(event)?,
            )
        }
        DatabaseAdminEventMutation::SetEnabled { enabled, .. } => {
            if current.is_none() {
                return Err("Event target no longer exists; refresh the event list".to_string());
            }
            let action = if *enabled { "ENABLE" } else { "DISABLE" };
            (
                if *enabled {
                    "Enable future executions of this database event"
                } else {
                    "Disable future executions of this database event"
                },
                if *enabled { "high" } else { "medium" },
                format!("{action} EVENT {target}"),
                format!("ALTER EVENT {} {action};", qualified_event(schema, name)),
            )
        }
        DatabaseAdminEventMutation::Delete { .. } => {
            if current.is_none() {
                return Err("Event target no longer exists; refresh the event list".to_string());
            }
            (
                "Permanently remove this scheduled database event",
                "high",
                format!("DROP EVENT {target}"),
                format!("DROP EVENT {};", qualified_event(schema, name)),
            )
        }
    };
    let marker = event_snapshot_marker(current.as_ref());
    Ok(DatabaseAdminEventPlan {
        action: mutation.action_name().to_string(),
        target,
        summary: summary.to_string(),
        risk: risk.to_string(),
        sql_preview: sql.clone(),
        confirmation_text,
        confirmation_token: event_plan_token(
            connection_id,
            server_version.as_deref(),
            mutation,
            &sql,
            &marker,
        ),
        server_version,
    })
}

#[tauri::command]
pub async fn list_database_admin_events(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    schema: String,
) -> Result<Response<DatabaseAdminEventCatalog>, String> {
    let result: Result<DatabaseAdminEventCatalog, String> = async {
        confirm_mysql_event_admin(&manager, &connection_id, &driver).await?;
        let schema = validate_text(&schema, "Event schema", 255)?;
        let result = primary_result(
            manager
                .query_parameterized(&connection_id, event_list_sql(), &[parameter(schema)])
                .await
                .map_err(|error| error.to_string())?,
        )?;
        let events = result
            .rows
            .iter()
            .take(EVENT_RESULT_LIMIT)
            .map(|row| event_from_row(&result, row))
            .collect();
        // Global scheduler visibility is advisory. An account may have EVENT
        // metadata access without permission to inspect global variables, so
        // a missing status must not hide an otherwise valid event list.
        let scheduler_status = manager
            .query(
                &connection_id,
                "SELECT @@GLOBAL.event_scheduler AS EVENT_SCHEDULER",
                None,
                None,
                None,
            )
            .await
            .ok()
            .and_then(|results| primary_result(results).ok())
            .and_then(|result| {
                result
                    .rows
                    .first()
                    .and_then(|row| value_string(result_row(&result, row, "EVENT_SCHEDULER")))
            });
        Ok(DatabaseAdminEventCatalog {
            scheduler_status,
            events,
        })
    }
    .await;
    Ok(match result {
        Ok(events) => Response::ok(events),
        Err(error) => database_admin_error_response("DATABASE_ADMIN_EVENTS_LIST_ERROR", &error),
    })
}

#[tauri::command]
pub async fn preview_database_admin_event_mutation(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    mutation: DatabaseAdminEventMutation,
) -> Result<Response<DatabaseAdminEventPlan>, String> {
    Ok(
        match build_event_plan(&manager, &connection_id, &driver, &mutation).await {
            Ok(plan) => Response::ok(plan),
            Err(error) => {
                database_admin_error_response("DATABASE_ADMIN_EVENT_PREVIEW_ERROR", &error)
            }
        },
    )
}

#[tauri::command]
pub async fn execute_database_admin_event_mutation(
    manager: State<'_, ConnectionManager>,
    connection_id: String,
    driver: String,
    request: ExecuteDatabaseAdminEventMutation,
) -> Result<Response<String>, String> {
    let result: Result<String, String> = async {
        let plan = build_event_plan(&manager, &connection_id, &driver, &request.mutation).await?;
        if request.confirmation_token.trim() != plan.confirmation_token {
            return Err("Event plan changed; preview the selected event again".to_string());
        }
        if request.confirmation_text.trim() != plan.confirmation_text {
            return Err(
                "Event confirmation text does not match the reviewed operation".to_string(),
            );
        }
        manager
            .query(&connection_id, &plan.sql_preview, None, None, None)
            .await
            .map_err(|error| error.to_string())?;
        Ok(format!(
            "Event {} completed for {}",
            plan.action, plan.target
        ))
    }
    .await;
    Ok(match result {
        Ok(message) => Response::ok(message),
        Err(error) => database_admin_error_response("DATABASE_ADMIN_EVENT_EXECUTE_ERROR", &error),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn interval_event() -> CreateDatabaseAdminEvent {
        CreateDatabaseAdminEvent {
            schema: "shop".to_string(),
            name: "daily`sync".to_string(),
            schedule: DatabaseAdminEventSchedule::Interval {
                interval_value: 1,
                interval_unit: DatabaseAdminEventIntervalUnit::Day,
                starts: Some("2026-01-01 00:00:00".to_string()),
                ends: None,
            },
            preserve_after_completion: true,
            enabled: false,
            comment: Some("owner's job".to_string()),
            body: "CALL refresh_cache()".to_string(),
        }
    }

    #[test]
    fn builds_only_the_reviewed_mysql_event_vocabulary() {
        assert_eq!(
            create_event_sql(&interval_event()).unwrap(),
            "CREATE EVENT `shop`.`daily``sync` ON SCHEDULE EVERY 1 DAY STARTS '2026-01-01 00:00:00' ON COMPLETION PRESERVE DISABLE COMMENT 'owner''s job' DO CALL refresh_cache();"
        );
        let once = CreateDatabaseAdminEvent {
            schedule: DatabaseAdminEventSchedule::Once {
                execute_at: "2026-02-01 10:00:00".to_string(),
            },
            ..interval_event()
        };
        assert!(create_event_sql(&once)
            .unwrap()
            .contains("ON SCHEDULE AT '2026-02-01 10:00:00'"));
    }

    #[test]
    fn rejects_multi_statement_ddl_and_transaction_event_bodies() {
        for body in [
            "DELETE FROM jobs; DROP TABLE jobs",
            "DROP TABLE jobs",
            "BEGIN",
            "SELECT 1",
        ] {
            let event = CreateDatabaseAdminEvent {
                body: body.to_string(),
                ..interval_event()
            };
            assert!(create_event_sql(&event).is_err(), "accepted {body:?}");
        }
    }

    #[test]
    fn event_tokens_bind_live_metadata_and_generated_sql() {
        let mutation = DatabaseAdminEventMutation::SetEnabled {
            schema: "shop".to_string(),
            name: "daily".to_string(),
            enabled: true,
        };
        let first = event_plan_token(
            "connection-1",
            Some("8.0.36"),
            &mutation,
            "ALTER EVENT `shop`.`daily` ENABLE;",
            "shop\0daily\0DISABLED\0before\0",
        );
        let changed = event_plan_token(
            "connection-1",
            Some("8.0.36"),
            &mutation,
            "ALTER EVENT `shop`.`daily` ENABLE;",
            "shop\0daily\0ENABLED\0after\0",
        );
        assert_ne!(first, changed);
    }

    #[test]
    fn schedule_contract_accepts_frontend_camel_case_fields() {
        let schedule: DatabaseAdminEventSchedule = serde_json::from_value(serde_json::json!({
            "kind": "interval",
            "intervalValue": 5,
            "intervalUnit": "minute",
            "starts": "2026-01-01 00:00:00"
        }))
        .unwrap();
        assert!(matches!(
            schedule,
            DatabaseAdminEventSchedule::Interval {
                interval_value: 5,
                interval_unit: DatabaseAdminEventIntervalUnit::Minute,
                ..
            }
        ));
    }
}
