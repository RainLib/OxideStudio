#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ContextMetricsUpdate {
    Compaction {
        input_tokens: u64,
        retained_tokens: u64,
        offloaded_artifacts: u64,
    },
    ModelUsage {
        calls: u64,
        input_tokens: u64,
        output_tokens: u64,
        total_tokens: u64,
    },
}
