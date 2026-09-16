import { type AgentContextMetrics } from "@/services/tauri/agent-host.service";

export function newerContextMetrics(
  current: AgentContextMetrics | null,
  candidate: AgentContextMetrics,
) {
  if (!current || candidate.updatedAt > current.updatedAt) return candidate;
  if (candidate.updatedAt < current.updatedAt) return current;
  return contextMetricsScore(candidate) >= contextMetricsScore(current)
    ? candidate
    : current;
}

function contextMetricsScore(metrics: AgentContextMetrics) {
  return (
    (metrics.compaction?.count ?? 0) +
    (metrics.compaction?.offloadedArtifacts ?? 0) +
    (metrics.modelUsage?.calls ?? 0) +
    (metrics.modelUsage?.totalTokens ?? 0)
  );
}
