use super::journal_model::{SchemaMigrationPreflightResult, SchemaMigrationPreflightStatus};
use crate::core::manager::ConnectionManager;
use crate::core::protocol::QueryResult;
use crate::core::schema_diff::{SchemaPreflightAssertion, SchemaPreflightCheck, SchemaSnapshot};

pub(super) async fn run_preflight_check(
    manager: &ConnectionManager,
    target: &SchemaSnapshot,
    check: &SchemaPreflightCheck,
) -> SchemaMigrationPreflightResult {
    let query_result = match target.database_name.as_deref() {
        Some(database) => {
            manager
                .query_database_with_context(
                    &target.connection_id,
                    database,
                    &check.sql,
                    Some(&target.schema_name),
                    None,
                )
                .await
        }
        None => {
            manager
                .query(
                    &target.connection_id,
                    &check.sql,
                    Some(target.schema_name.clone()),
                    None,
                    None,
                )
                .await
        }
    };
    match query_result {
        Ok(results) => evaluate_preflight_result(check, &results),
        Err(error) => SchemaMigrationPreflightResult {
            check_id: check.id.clone(),
            change_id: check.change_id.clone(),
            label: check.label.clone(),
            expectation: check.expectation.clone(),
            status: SchemaMigrationPreflightStatus::Error,
            observed: "Query failed".to_string(),
            blocks_execution: true,
            error: Some(error.to_string()),
        },
    }
}

pub(super) fn evaluate_preflight_result(
    check: &SchemaPreflightCheck,
    results: &[QueryResult],
) -> SchemaMigrationPreflightResult {
    let result = results.first();
    let evaluation = match check.assertion {
        SchemaPreflightAssertion::EmptyRows => result
            .map(|result| {
                let row_count = result.rows.len();
                (
                    if row_count == 0 {
                        SchemaMigrationPreflightStatus::Passed
                    } else {
                        SchemaMigrationPreflightStatus::Blocked
                    },
                    format!("{row_count} blocking row(s) returned"),
                    row_count > 0,
                )
            })
            .ok_or_else(|| "Preflight returned no result set".to_string()),
        SchemaPreflightAssertion::ZeroValue | SchemaPreflightAssertion::Advisory => {
            preflight_numeric_observation(check, result).map(|value| {
                let non_zero = value != 0.0;
                let status = match check.assertion {
                    SchemaPreflightAssertion::ZeroValue if non_zero => {
                        SchemaMigrationPreflightStatus::Blocked
                    }
                    SchemaPreflightAssertion::Advisory if non_zero => {
                        SchemaMigrationPreflightStatus::Warning
                    }
                    _ => SchemaMigrationPreflightStatus::Passed,
                };
                (
                    status,
                    format_number_observation(value, check.result_column.as_deref()),
                    check.assertion == SchemaPreflightAssertion::ZeroValue && non_zero,
                )
            })
        }
    };

    match evaluation {
        Ok((status, observed, blocks_execution)) => SchemaMigrationPreflightResult {
            check_id: check.id.clone(),
            change_id: check.change_id.clone(),
            label: check.label.clone(),
            expectation: check.expectation.clone(),
            status,
            observed,
            blocks_execution,
            error: None,
        },
        Err(error) => SchemaMigrationPreflightResult {
            check_id: check.id.clone(),
            change_id: check.change_id.clone(),
            label: check.label.clone(),
            expectation: check.expectation.clone(),
            status: SchemaMigrationPreflightStatus::Error,
            observed: "Unexpected result shape".to_string(),
            blocks_execution: true,
            error: Some(error),
        },
    }
}

pub(super) fn preflight_numeric_observation(
    check: &SchemaPreflightCheck,
    result: Option<&QueryResult>,
) -> Result<f64, String> {
    let result = result.ok_or_else(|| "Preflight returned no result set".to_string())?;
    let column_name = check
        .result_column
        .as_deref()
        .ok_or_else(|| "Preflight numeric result column is not declared".to_string())?;
    let column_index = result
        .columns
        .iter()
        .position(|column| column.name.eq_ignore_ascii_case(column_name))
        .ok_or_else(|| format!("Preflight result did not include {column_name}"))?;
    let value = result
        .rows
        .first()
        .and_then(|row| row.get(column_index))
        .ok_or_else(|| format!("Preflight result did not return a value for {column_name}"))?;
    json_number(value).ok_or_else(|| format!("Preflight result {column_name} was not numeric"))
}

pub(super) fn json_number(value: &serde_json::Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|value| value.parse::<f64>().ok()))
}

pub(super) fn format_number_observation(value: f64, column: Option<&str>) -> String {
    let value = if value.fract() == 0.0 {
        format!("{value:.0}")
    } else {
        value.to_string()
    };
    match column {
        Some(column) => format!("{column} = {value}"),
        None => value,
    }
}
