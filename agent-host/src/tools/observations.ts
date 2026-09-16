import {
  type AgentCitation,
  type BoundedObservation,
} from "@oxide/agent-contract";

export function serializeObservation(
  observation: BoundedObservation,
  citations: readonly AgentCitation[],
): string {
  return JSON.stringify({
    summary: observation.summary,
    data: observation.data,
    rowCount: observation.rowCount,
    truncated: observation.truncated,
    artifactRef: observation.artifactRef,
    citations,
  });
}

export function toolObservationDetail(observation: BoundedObservation): string {
  const stats = [
    observation.rowCount === undefined
      ? null
      : `${observation.rowCount.toLocaleString("en-US")} rows`,
    `${observation.byteCount.toLocaleString("en-US")} bytes`,
    observation.truncated ? "truncated" : null,
  ].filter(Boolean);
  const summary = [observation.summary.trim(), stats.join(" · ")]
    .filter(Boolean)
    .join(" · ");
  if (observation.data === undefined) return summary.slice(0, 2_400);

  let serialized: string;
  try {
    serialized = JSON.stringify(observation.data, null, 2);
  } catch {
    return summary.slice(0, 2_400);
  }
  const preview = truncateVisibleOutput(serialized, 1_800);
  return `${summary}\nOutput preview\n${preview}`.slice(0, 2_400);
}

export function truncateVisibleOutput(content: string, limit: number): string {
  const characters = Array.from(content);
  if (characters.length <= limit) return content;
  return `${characters
    .slice(0, Math.max(0, limit - 3))
    .join("")
    .trimEnd()}...`;
}

export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 500);
  return "Tool execution failed";
}
