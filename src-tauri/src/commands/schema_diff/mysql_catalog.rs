use super::capture_identity::{schema_object_definition_key, sql_string_literal};
use crate::commands::database_admin::events::{
    create_event_sql, CreateDatabaseAdminEvent, DatabaseAdminEventIntervalUnit,
    DatabaseAdminEventSchedule,
};
use crate::core::manager::ConnectionManager;
use std::collections::HashMap;

pub(super) fn mysql_quote_identifier(identifier: &str) -> String {
    format!("`{}`", identifier.replace('`', "``"))
}

pub(super) fn mysql_event_interval_unit(value: &str) -> Option<DatabaseAdminEventIntervalUnit> {
    match value.trim().to_ascii_uppercase().as_str() {
        "SECOND" => Some(DatabaseAdminEventIntervalUnit::Second),
        "MINUTE" => Some(DatabaseAdminEventIntervalUnit::Minute),
        "HOUR" => Some(DatabaseAdminEventIntervalUnit::Hour),
        "DAY" => Some(DatabaseAdminEventIntervalUnit::Day),
        "WEEK" => Some(DatabaseAdminEventIntervalUnit::Week),
        "MONTH" => Some(DatabaseAdminEventIntervalUnit::Month),
        "QUARTER" => Some(DatabaseAdminEventIntervalUnit::Quarter),
        "YEAR" => Some(DatabaseAdminEventIntervalUnit::Year),
        _ => None,
    }
}

pub(super) fn optional_catalog_string(value: Option<&serde_json::Value>) -> Option<String> {
    value
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

/// This intentionally selects structured schedule/body fields instead of
/// `SHOW CREATE EVENT`: the latter copies source DEFINER and session-specific
/// clauses. The resulting definition is rebuilt through the already-reviewed
/// Event administration vocabulary below.
pub(super) fn mysql_event_definition_query(schema: &str) -> String {
    let schema = sql_string_literal(schema);
    format!(
        "SELECT EVENT_NAME AS event_name, EVENT_TYPE AS event_type, EXECUTE_AT AS execute_at, \
         INTERVAL_VALUE AS interval_value, INTERVAL_FIELD AS interval_field, STARTS AS starts, \
         ENDS AS ends, STATUS AS status, ON_COMPLETION AS on_completion, \
         EVENT_COMMENT AS event_comment, EVENT_DEFINITION AS event_definition, TIME_ZONE AS time_zone \
         FROM information_schema.EVENTS WHERE EVENT_SCHEMA = {schema} ORDER BY EVENT_NAME;"
    )
}

pub(super) fn mysql_event_definition_from_row(
    schema: &str,
    row: &[serde_json::Value],
) -> Option<String> {
    let name = optional_catalog_string(row.first())?;
    let event_type = optional_catalog_string(row.get(1))?.to_ascii_uppercase();
    let status = optional_catalog_string(row.get(7))?.to_ascii_uppercase();
    let on_completion = optional_catalog_string(row.get(8))?.to_ascii_uppercase();
    let body = optional_catalog_string(row.get(10))?;
    // CREATE EVENT does not have a portable TIME ZONE clause. Only SYSTEM is
    // faithfully representable by the bounded administration grammar.
    if !optional_catalog_string(row.get(11))
        .as_deref()
        .is_none_or(|time_zone| time_zone.eq_ignore_ascii_case("SYSTEM"))
    {
        return None;
    }
    let schedule = match event_type.as_str() {
        "ONE TIME" => DatabaseAdminEventSchedule::Once {
            execute_at: optional_catalog_string(row.get(2))?,
        },
        "RECURRING" => DatabaseAdminEventSchedule::Interval {
            interval_value: optional_catalog_string(row.get(3))?.parse().ok()?,
            interval_unit: mysql_event_interval_unit(&optional_catalog_string(row.get(4))?)?,
            starts: optional_catalog_string(row.get(5)),
            ends: optional_catalog_string(row.get(6)),
        },
        _ => return None,
    };
    let event = CreateDatabaseAdminEvent {
        schema: schema.to_string(),
        name,
        schedule,
        preserve_after_completion: matches!(on_completion.as_str(), "PRESERVE"),
        enabled: match status.as_str() {
            "ENABLED" => true,
            "DISABLED" => false,
            _ => return None,
        },
        comment: optional_catalog_string(row.get(9)),
        body,
    };
    // An unexpected completion spelling must not silently become NOT PRESERVE.
    if !matches!(on_completion.as_str(), "PRESERVE" | "NOT PRESERVE") {
        return None;
    }
    create_event_sql(&event).ok()
}

pub(super) async fn capture_mysql_event_definitions(
    manager: &ConnectionManager,
    connection_id: &str,
    database: Option<&str>,
    driver: &str,
    schema: &str,
) -> Result<HashMap<String, String>, String> {
    if !driver.trim().eq_ignore_ascii_case("mysql") {
        return Ok(HashMap::new());
    }
    let sql = mysql_event_definition_query(schema);
    let results = match database {
        Some(database) => manager.query_database(connection_id, database, &sql).await,
        None => {
            manager
                .query(connection_id, &sql, Some(schema.to_string()), None, None)
                .await
        }
    }
    .map_err(|error| error.to_string())?;
    let mut definitions = HashMap::new();
    for row in results.iter().flat_map(|result| result.rows.iter()) {
        let Some(name) = optional_catalog_string(row.first()) else {
            continue;
        };
        if let Some(definition) = mysql_event_definition_from_row(schema, row) {
            definitions.insert(schema_object_definition_key(None, &name), definition);
        }
    }
    Ok(definitions)
}

/// MySQL's information_schema trigger catalog avoids copying source DEFINER
/// accounts. Only simple action statements are later eligible for execution;
/// compound BEGIN/END bodies retain review-only status because they require a
/// delimiter-aware execution contract.
pub(super) fn mysql_trigger_definition_query(schema: &str) -> String {
    let schema = sql_string_literal(schema);
    format!(
        "SELECT TRIGGER_NAME AS trigger_name, EVENT_OBJECT_TABLE AS parent_name, \
         ACTION_TIMING AS action_timing, EVENT_MANIPULATION AS event_manipulation, \
         ACTION_STATEMENT AS action_statement \
         FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = {schema} \
         ORDER BY EVENT_OBJECT_TABLE, TRIGGER_NAME;"
    )
}

pub(super) async fn capture_mysql_trigger_definitions(
    manager: &ConnectionManager,
    connection_id: &str,
    database: Option<&str>,
    driver: &str,
    schema: &str,
) -> Result<HashMap<String, String>, String> {
    if !driver.trim().eq_ignore_ascii_case("mysql") {
        return Ok(HashMap::new());
    }
    let sql = mysql_trigger_definition_query(schema);
    let results = match database {
        Some(database) => manager.query_database(connection_id, database, &sql).await,
        None => {
            manager
                .query(connection_id, &sql, Some(schema.to_string()), None, None)
                .await
        }
    }
    .map_err(|error| error.to_string())?;
    let mut definitions = HashMap::new();
    for row in results.iter().flat_map(|result| result.rows.iter()) {
        let (Some(name), Some(parent_name), Some(timing), Some(event), Some(statement)) = (
            row.first().and_then(serde_json::Value::as_str),
            row.get(1).and_then(serde_json::Value::as_str),
            row.get(2).and_then(serde_json::Value::as_str),
            row.get(3).and_then(serde_json::Value::as_str),
            row.get(4).and_then(serde_json::Value::as_str),
        ) else {
            continue;
        };
        let statement = statement.trim();
        if name.trim().is_empty()
            || parent_name.trim().is_empty()
            || timing.trim().is_empty()
            || event.trim().is_empty()
            || statement.is_empty()
        {
            continue;
        }
        definitions.insert(
            schema_object_definition_key(Some(parent_name), name),
            format!(
                "CREATE TRIGGER {} {} {} ON {}.{} FOR EACH ROW {}",
                mysql_quote_identifier(name),
                timing.to_ascii_uppercase(),
                event.to_ascii_uppercase(),
                mysql_quote_identifier(schema),
                mysql_quote_identifier(parent_name),
                statement,
            ),
        );
    }
    Ok(definitions)
}
