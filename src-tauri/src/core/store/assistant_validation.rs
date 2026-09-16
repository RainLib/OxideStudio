use super::models::AssistantTaskRecord;
use anyhow::Result;
use sqlx::Row;

pub(super) fn validate_assistant_task(task: &AssistantTaskRecord) -> Result<()> {
    const ALLOWED_STATUSES: [&str; 6] = [
        "running",
        "awaiting_approval",
        "completed",
        "failed",
        "cancelled",
        "interrupted",
    ];
    if task.id.trim().is_empty()
        || task.project_id.trim().is_empty()
        || task.request_id.trim().is_empty()
        || task.session_id.trim().is_empty()
    {
        anyhow::bail!("assistant task identity fields are required");
    }
    if task.id.chars().count() > 200
        || task.project_id.chars().count() > 200
        || task.request_id.chars().count() > 200
        || task.session_id.chars().count() > 200
    {
        anyhow::bail!("assistant task identity fields must not exceed 200 characters");
    }
    if !ALLOWED_STATUSES.contains(&task.status.as_str()) {
        anyhow::bail!("unsupported assistant task status: {}", task.status);
    }
    if task.title.trim().is_empty() || task.title.chars().count() > 200 {
        anyhow::bail!("assistant task title must contain 1 to 200 characters");
    }
    if task
        .detail
        .as_ref()
        .is_some_and(|value| value.chars().count() > 2_000)
    {
        anyhow::bail!("assistant task detail must not exceed 2,000 characters");
    }
    if ![1, 2, 3].contains(&task.checkpoint.version) || task.checkpoint.mode != "agent" {
        anyhow::bail!("unsupported assistant task checkpoint");
    }
    if task.checkpoint.version == 1 && !task.checkpoint.execution_receipts.is_empty() {
        anyhow::bail!("assistant task execution receipts require checkpoint version 2");
    }
    if task.checkpoint.version == 3 && task.checkpoint.context.is_none()
        || task.checkpoint.version < 3 && task.checkpoint.context.is_some()
    {
        anyhow::bail!("assistant task context requires checkpoint version 3");
    }
    if let Some(context) = &task.checkpoint.context {
        let optional_field_too_long = [
            context.active_connection_id.as_deref(),
            context.active_database_name.as_deref(),
            context.active_namespace.as_deref(),
            context.active_tab_id.as_deref(),
            context.document_revision.as_deref(),
            context.selection_revision.as_deref(),
        ]
        .into_iter()
        .flatten()
        .any(|value| value.chars().count() > 240);
        if context.version != 1
            || context.fingerprint.trim().is_empty()
            || context.fingerprint.chars().count() > 80
            || context.project_id != task.project_id
            || context.project_id.chars().count() > 200
            || context
                .active_driver
                .as_ref()
                .is_some_and(|value| value.chars().count() > 80)
            || optional_field_too_long
        {
            anyhow::bail!("assistant task context binding is invalid");
        }
    }
    if task.checkpoint.plan.len() > 100
        || task.checkpoint.completed_steps.len() > 100
        || task.checkpoint.execution_receipts.len() > 100
    {
        anyhow::bail!("assistant task checkpoint exceeds the 100-step limit");
    }
    for step in &task.checkpoint.plan {
        if step.id.trim().is_empty()
            || step.id.chars().count() > 120
            || step.title.trim().is_empty()
            || step.title.chars().count() > 200
            || step
                .tool_name
                .as_ref()
                .is_some_and(|value| value.chars().count() > 200)
        {
            anyhow::bail!("assistant task plan step exceeds its field limits");
        }
    }
    for step in &task.checkpoint.completed_steps {
        if step.id.trim().is_empty()
            || step.id.chars().count() > 120
            || step.tool_name.trim().is_empty()
            || step.tool_name.chars().count() > 200
            || !["success", "requiresApproval", "error"].contains(&step.status.as_str())
        {
            anyhow::bail!("assistant task completed step is invalid");
        }
    }
    let mut receipt_step_ids = std::collections::HashSet::new();
    for receipt in &task.checkpoint.execution_receipts {
        let plan_step = task
            .checkpoint
            .plan
            .iter()
            .find(|step| step.id == receipt.step_id);
        let completed_step = task
            .checkpoint
            .completed_steps
            .iter()
            .find(|step| step.id == receipt.step_id);
        let finished_state = matches!(receipt.status.as_str(), "succeeded" | "failed");
        let completion_matches = match receipt.status.as_str() {
            "started" => completed_step.is_none(),
            "succeeded" => completed_step.is_some_and(|step| step.status == "success"),
            "failed" => completed_step.is_some_and(|step| step.status != "success"),
            _ => false,
        };
        if receipt.step_id.trim().is_empty()
            || receipt.step_id.chars().count() > 120
            || receipt.tool_name.trim().is_empty()
            || receipt.tool_name.chars().count() > 200
            || !["started", "succeeded", "failed"].contains(&receipt.status.as_str())
            || receipt.started_at <= 0
            || finished_state != receipt.finished_at.is_some()
            || receipt
                .finished_at
                .is_some_and(|value| value < receipt.started_at)
            || !receipt_step_ids.insert(receipt.step_id.as_str())
            || !completion_matches
            || !plan_step.is_some_and(|step| {
                step.requires_approval
                    && step.tool_name.as_deref() == Some(receipt.tool_name.as_str())
            })
        {
            anyhow::bail!("assistant task execution receipt is invalid");
        }
    }
    if serde_json::to_vec(&task.checkpoint)?.len() > 64 * 1024 {
        anyhow::bail!("assistant task checkpoint exceeds 64 KiB");
    }
    if task
        .current_step_id
        .as_ref()
        .is_some_and(|value| value.chars().count() > 120)
        || task
            .current_tool_name
            .as_ref()
            .is_some_and(|value| value.chars().count() > 200)
    {
        anyhow::bail!("assistant task current step fields exceed their limits");
    }
    if task
        .progress
        .is_some_and(|value| !value.is_finite() || !(0.0..=1.0).contains(&value))
    {
        anyhow::bail!("assistant task progress must be between 0 and 1");
    }
    Ok(())
}

pub(super) fn assistant_task_from_row(row: sqlx::sqlite::SqliteRow) -> Result<AssistantTaskRecord> {
    let checkpoint: serde_json::Value = row.get("checkpoint");
    Ok(AssistantTaskRecord {
        id: row.get("id"),
        project_id: row.get("project_id"),
        request_id: row.get("request_id"),
        session_id: row.get("session_id"),
        status: row.get("status"),
        title: row.get("title"),
        detail: row.get("detail"),
        current_step_id: row.get("current_step_id"),
        current_tool_name: row.get("current_tool_name"),
        progress: row.get("progress"),
        checkpoint: serde_json::from_value(checkpoint)?,
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        finished_at: row.get("finished_at"),
    })
}
