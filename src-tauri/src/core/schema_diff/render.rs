use super::types::{
    SchemaChange, SchemaChangeRisk, SchemaDiffSummary, SchemaPreflightCheck, SchemaSnapshot,
};
use crate::core::dialect::DatabaseKind;

pub(super) fn summarize_changes(changes: &[SchemaChange]) -> SchemaDiffSummary {
    SchemaDiffSummary {
        total: changes.len(),
        safe: changes
            .iter()
            .filter(|change| change.risk == SchemaChangeRisk::Safe)
            .count(),
        review: changes
            .iter()
            .filter(|change| change.risk == SchemaChangeRisk::Review)
            .count(),
        destructive: changes
            .iter()
            .filter(|change| change.risk == SchemaChangeRisk::Destructive)
            .count(),
        blocked: changes
            .iter()
            .filter(|change| change.blocked_reason.is_some())
            .count(),
    }
}

pub(super) fn render_migration_sql(
    kind: DatabaseKind,
    source: &SchemaSnapshot,
    target: &SchemaSnapshot,
    changes: &[SchemaChange],
    warnings: &[String],
) -> String {
    let mut lines = vec![
        "-- OxideStudio schema migration preview".to_string(),
        format!(
            "-- Desired source: {} / {}",
            source.connection_name, source.schema_name
        ),
        format!(
            "-- Actual target: {} / {}",
            target.connection_name, target.schema_name
        ),
        "-- Generated only for review; nothing has been executed.".to_string(),
    ];
    if kind == DatabaseKind::Mysql {
        lines.push(
            "-- MySQL DDL may auto-commit; review every statement before running.".to_string(),
        );
    }
    for warning in warnings {
        lines.push(format!("-- WARNING: {warning}"));
    }
    let blocked_count = changes
        .iter()
        .filter(|change| change.blocked_reason.is_some())
        .count();
    if blocked_count > 0 {
        lines.push(format!(
            "-- PLAN BLOCKED: {blocked_count} change(s) require resolution; do not execute this script as a migration."
        ));
    }
    lines.push(String::new());
    if kind == DatabaseKind::Postgres && !changes.is_empty() {
        lines.push("BEGIN;".to_string());
        lines.push(String::new());
    }
    if changes.is_empty() {
        lines.push("-- No schema differences detected.".to_string());
    }
    for change in changes {
        lines.push(format!(
            "-- Step {} · {:?} · {:?}: {}",
            change.order, change.phase, change.risk, change.summary
        ));
        if !change.depends_on.is_empty() {
            lines.push(format!("-- Depends on: {}", change.depends_on.join(", ")));
        }
        if let Some(reason) = change.blocked_reason.as_deref() {
            lines.push(format!("-- BLOCKED: {reason}"));
        }
        if change.sql.is_empty() {
            lines.push("-- MANUAL REVIEW REQUIRED: no safe SQL was generated.".to_string());
        } else {
            lines.extend(change.sql.iter().cloned());
        }
        lines.push(String::new());
    }
    if kind == DatabaseKind::Postgres && !changes.is_empty() {
        lines.push("-- Replace ROLLBACK with COMMIT only after review and validation.".to_string());
        lines.push("ROLLBACK;".to_string());
    }
    lines.join("\n")
}

pub(super) fn render_preflight_sql(
    source: &SchemaSnapshot,
    target: &SchemaSnapshot,
    checks: &[SchemaPreflightCheck],
) -> String {
    let mut lines = vec![
        "-- OxideStudio schema migration preflight".to_string(),
        format!(
            "-- Desired source: {} / {}",
            source.connection_name, source.schema_name
        ),
        format!(
            "-- Actual target: {} / {}",
            target.connection_name, target.schema_name
        ),
        "-- Read-only checks only; inspect every expectation before migration execution."
            .to_string(),
        String::new(),
    ];
    if checks.is_empty() {
        lines.push("-- No generated preflight checks for this plan.".to_string());
    }
    for (index, check) in checks.iter().enumerate() {
        lines.push(format!("-- Check {}: {}", index + 1, check.label));
        lines.push(format!("-- Expectation: {}", check.expectation));
        lines.push(check.sql.clone());
        lines.push(String::new());
    }
    lines.join("\n")
}

#[derive(Default)]
pub(super) struct RelationFlags {
    pub(super) is_view: bool,
    pub(super) is_materialized_view: bool,
    pub(super) is_foreign_table: bool,
}

pub(super) fn relation_flags(object_type: Option<&str>) -> RelationFlags {
    let normalized = object_type.unwrap_or("").trim().to_ascii_uppercase();
    RelationFlags {
        is_view: normalized.contains("VIEW"),
        is_materialized_view: normalized.contains("MATERIALIZED"),
        is_foreign_table: normalized.contains("FOREIGN"),
    }
}
