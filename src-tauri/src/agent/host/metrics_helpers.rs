use super::metrics_types::ContextMetricsUpdate;
use crate::agent::protocol::AgentContextCompactionMetrics;
use crate::agent::protocol::AgentContextMetrics;
use crate::agent::protocol::AgentModelUsageMetrics;
use serde_json::Map;
use serde_json::Value;

pub(super) fn context_metrics_update(
    event_type: &str,
    object: &Map<String, Value>,
) -> Option<ContextMetricsUpdate> {
    match event_type {
        "context.compacted" => Some(ContextMetricsUpdate::Compaction {
            input_tokens: object.get("inputTokens")?.as_u64()?,
            retained_tokens: object.get("retainedTokens")?.as_u64()?,
            offloaded_artifacts: object.get("offloadedArtifacts")?.as_u64()?,
        }),
        "model.usage" => Some(ContextMetricsUpdate::ModelUsage {
            calls: object.get("calls")?.as_u64()?,
            input_tokens: object.get("inputTokens")?.as_u64()?,
            output_tokens: object.get("outputTokens")?.as_u64()?,
            total_tokens: object.get("totalTokens")?.as_u64()?,
        }),
        _ => None,
    }
}

pub(super) fn apply_context_metrics_update(
    metrics: &mut AgentContextMetrics,
    update: ContextMetricsUpdate,
    occurred_at: i64,
) {
    match update {
        ContextMetricsUpdate::Compaction {
            input_tokens,
            retained_tokens,
            offloaded_artifacts,
        } => {
            let compaction = metrics
                .compaction
                .get_or_insert_with(AgentContextCompactionMetrics::default);
            compaction.count = compaction.count.saturating_add(1);
            compaction.last_input_tokens = input_tokens;
            compaction.last_retained_tokens = retained_tokens;
            compaction.offloaded_artifacts = compaction
                .offloaded_artifacts
                .saturating_add(offloaded_artifacts);
        }
        ContextMetricsUpdate::ModelUsage {
            calls,
            input_tokens,
            output_tokens,
            total_tokens,
        } => {
            let usage = metrics
                .model_usage
                .get_or_insert_with(AgentModelUsageMetrics::default);
            usage.calls = usage.calls.saturating_add(calls);
            usage.input_tokens = usage.input_tokens.saturating_add(input_tokens);
            usage.output_tokens = usage.output_tokens.saturating_add(output_tokens);
            usage.total_tokens = usage.total_tokens.saturating_add(total_tokens);
        }
    }
    metrics.updated_at = metrics.updated_at.max(occurred_at);
}
