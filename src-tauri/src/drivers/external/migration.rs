use anyhow::{anyhow, Result};
use oxide_driver_protocol::{
    SchemaMigrationApplyResult, SchemaMigrationMode, SchemaMigrationPlanRequest,
    SchemaMigrationPlanResult, SchemaMigrationPreflightRequest, SchemaMigrationPreflightResult,
    SchemaMigrationVerifyResult, SemanticSchemaSnapshot,
};
use std::collections::HashSet;

pub(super) fn validate_bounded_migration_text(
    value: &str,
    label: &str,
    allow_empty: bool,
) -> Result<()> {
    if (!allow_empty && value.is_empty()) || value.len() > MAX_MIGRATION_TEXT_BYTES {
        return Err(anyhow!("External driver returned an invalid {label}"));
    }
    Ok(())
}

pub(super) fn validate_migration_token(value: &str, label: &str) -> Result<()> {
    if value.is_empty() || value.len() > MAX_MIGRATION_TOKEN_BYTES {
        return Err(anyhow!("External driver returned an invalid {label}"));
    }
    Ok(())
}

pub(super) fn validate_migration_fingerprint(value: &str, label: &str) -> Result<()> {
    if value.is_empty() || value.len() > MAX_MIGRATION_FINGERPRINT_BYTES {
        return Err(anyhow!("External driver returned an invalid {label}"));
    }
    Ok(())
}

pub(super) fn validate_migration_warnings(warnings: &[String]) -> Result<()> {
    if warnings.len() > MAX_MIGRATION_WARNINGS
        || warnings
            .iter()
            .any(|warning| warning.len() > MAX_MIGRATION_TEXT_BYTES)
    {
        return Err(anyhow!(
            "External driver returned invalid semantic migration warnings"
        ));
    }
    Ok(())
}

pub(super) fn validate_semantic_snapshot(
    snapshot: &SemanticSchemaSnapshot,
    label: &str,
) -> Result<()> {
    if snapshot.snapshot_version != 1 {
        return Err(anyhow!("{label} uses an unsupported snapshot version"));
    }
    validate_migration_fingerprint(&snapshot.fingerprint, &format!("{label} fingerprint"))?;
    if snapshot.namespace.is_empty() || snapshot.namespace.len() > 256 {
        return Err(anyhow!("{label} contains an invalid namespace"));
    }
    if snapshot
        .database
        .as_ref()
        .is_some_and(|database| database.is_empty() || database.len() > 256)
    {
        return Err(anyhow!("{label} contains an invalid database"));
    }
    if !snapshot.descriptor.is_object() {
        return Err(anyhow!("{label} descriptor must be an object"));
    }
    let serialized = serde_json::to_vec(snapshot)
        .map_err(|_| anyhow!("{label} cannot be encoded as a semantic snapshot"))?;
    if serialized.len() > MAX_MIGRATION_SNAPSHOT_BYTES {
        return Err(anyhow!("{label} exceeds the semantic snapshot size limit"));
    }

    let mut pending = vec![&snapshot.descriptor];
    let mut item_count = 0usize;
    while let Some(value) = pending.pop() {
        item_count = item_count.saturating_add(1);
        if item_count > MAX_MIGRATION_DESCRIPTOR_ITEMS {
            return Err(anyhow!("{label} descriptor contains too many items"));
        }
        match value {
            serde_json::Value::Array(items) => {
                if items.len() > 20_000 {
                    return Err(anyhow!("{label} descriptor array is too large"));
                }
                pending.extend(items);
            }
            serde_json::Value::Object(items) => {
                for (key, value) in items {
                    let normalized = key.replace('_', "").to_ascii_lowercase();
                    if matches!(
                        normalized.as_str(),
                        "ddl" | "sql" | "sourcesql" | "statement" | "statements"
                    ) {
                        return Err(anyhow!(
                            "{label} descriptor must not contain Host SQL or DDL"
                        ));
                    }
                    pending.push(value);
                }
            }
            _ => {}
        }
    }
    Ok(())
}

pub(super) fn validate_schema_migration_plan_result(
    request: &SchemaMigrationPlanRequest,
    expected_mode: SchemaMigrationMode,
    result: &SchemaMigrationPlanResult,
) -> Result<()> {
    validate_migration_token(&result.plan_id, "semantic migration plan id")?;
    validate_migration_token(&result.plan_token, "semantic migration plan token")?;
    validate_migration_fingerprint(
        &result.target_fingerprint,
        "semantic migration target fingerprint",
    )?;
    if result.target_fingerprint != request.target.fingerprint || result.mode != expected_mode {
        return Err(anyhow!(
            "External driver returned a semantic migration plan outside its signed target contract"
        ));
    }
    if result.change_count > MAX_MIGRATION_CHANGE_COUNT
        || result.blocked_change_count > result.change_count
        || result.preview.len() > MAX_MIGRATION_PREVIEW_ITEMS
        || result.preview.len() > result.change_count as usize
    {
        return Err(anyhow!(
            "External driver returned invalid semantic migration plan counts"
        ));
    }
    let mut preview_ids = HashSet::with_capacity(result.preview.len());
    let mut preview_requires_review = false;
    let mut preview_requires_destructive = false;
    for change in &result.preview {
        validate_migration_token(&change.id, "semantic migration preview id")?;
        validate_bounded_migration_text(&change.kind, "semantic migration preview kind", false)?;
        validate_bounded_migration_text(&change.label, "semantic migration preview label", false)?;
        validate_bounded_migration_text(
            &change.summary,
            "semantic migration preview summary",
            true,
        )?;
        if !matches!(change.risk.as_str(), "safe" | "review" | "destructive")
            || !preview_ids.insert(&change.id)
        {
            return Err(anyhow!(
                "External driver returned an invalid semantic migration preview"
            ));
        }
        preview_requires_review |= change.risk == "review";
        preview_requires_destructive |= change.risk == "destructive" || !change.reversible;
    }
    if (preview_requires_review && !result.requires_review)
        || (preview_requires_destructive && !result.requires_destructive)
    {
        return Err(anyhow!(
            "External driver migration approvals do not cover its preview risks"
        ));
    }
    validate_migration_warnings(&result.warnings)
}

pub(super) fn validate_schema_migration_preflight_result(
    request: &SchemaMigrationPreflightRequest,
    result: &SchemaMigrationPreflightResult,
) -> Result<()> {
    validate_migration_token(&result.plan_id, "semantic migration plan id")?;
    validate_migration_token(
        &result.preflight_token,
        "semantic migration preflight token",
    )?;
    validate_migration_fingerprint(
        &result.target_fingerprint,
        "semantic migration target fingerprint",
    )?;
    if result.target_fingerprint != request.target_fingerprint
        || result.checks.len() > MAX_MIGRATION_CHECK_ITEMS
    {
        return Err(anyhow!(
            "External driver returned an invalid semantic migration preflight"
        ));
    }
    let mut check_ids = HashSet::with_capacity(result.checks.len());
    for check in &result.checks {
        validate_migration_token(&check.id, "semantic migration preflight check id")?;
        validate_bounded_migration_text(
            &check.label,
            "semantic migration preflight check label",
            false,
        )?;
        validate_bounded_migration_text(
            &check.status,
            "semantic migration preflight check status",
            false,
        )?;
        validate_bounded_migration_text(
            &check.observed,
            "semantic migration preflight observation",
            true,
        )?;
        if !check_ids.insert(&check.id) {
            return Err(anyhow!(
                "External driver returned duplicate semantic migration preflight checks"
            ));
        }
    }
    Ok(())
}

pub(super) fn validate_schema_migration_apply_result(
    result: &SchemaMigrationApplyResult,
) -> Result<()> {
    validate_migration_token(&result.plan_id, "semantic migration plan id")?;
    validate_migration_token(&result.apply_token, "semantic migration apply token")?;
    if result.committed_change_count > MAX_MIGRATION_CHANGE_COUNT {
        return Err(anyhow!(
            "External driver returned an invalid semantic migration apply count"
        ));
    }
    validate_migration_warnings(&result.warnings)
}

pub(super) fn validate_schema_migration_verify_result(
    result: &SchemaMigrationVerifyResult,
) -> Result<()> {
    validate_migration_token(&result.plan_id, "semantic migration plan id")?;
    validate_migration_fingerprint(
        &result.target_fingerprint_after,
        "semantic migration verification fingerprint",
    )?;
    if result.remaining_change_count > MAX_MIGRATION_CHANGE_COUNT {
        return Err(anyhow!(
            "External driver returned an invalid semantic migration verification count"
        ));
    }
    validate_migration_warnings(&result.warnings)
}
use super::models::{
    MAX_MIGRATION_CHANGE_COUNT, MAX_MIGRATION_CHECK_ITEMS, MAX_MIGRATION_DESCRIPTOR_ITEMS,
    MAX_MIGRATION_FINGERPRINT_BYTES, MAX_MIGRATION_PREVIEW_ITEMS, MAX_MIGRATION_SNAPSHOT_BYTES,
    MAX_MIGRATION_TEXT_BYTES, MAX_MIGRATION_TOKEN_BYTES, MAX_MIGRATION_WARNINGS,
};
