import type { AssistantContextPreview } from "@/ai/assistant/contextPreview";

export function contextDetail(
  preview: AssistantContextPreview["editor"],
  prefix?: string,
) {
  const availability = preview.available
    ? characterDetail(preview)
    : "Not available";
  return prefix ? `${prefix} · ${availability}` : availability;
}

export function characterDetail(preview: AssistantContextPreview["prompt"]) {
  if (!preview.available) return "Empty";
  if (!preview.included) {
    return `${preview.originalCharacters.toLocaleString()} characters · excluded`;
  }
  const suffix = preview.truncated ? " · truncated" : "";
  return `${preview.sentCharacters.toLocaleString()} of ${preview.originalCharacters.toLocaleString()} characters · ~${preview.estimatedTokens.toLocaleString()} tokens${suffix}`;
}

export function historyDetail(preview: AssistantContextPreview) {
  const history = preview.history;
  if (history.availableMessages === 0) return "No previous messages";
  if (!history.included) {
    return `${history.availableMessages} messages · excluded`;
  }
  const omitted =
    history.omittedMessages > 0 || history.omittedCharacters > 0
      ? ` · omitted ${history.omittedMessages} messages / ${history.omittedCharacters.toLocaleString()} characters`
      : "";
  return `${history.sentMessages} of ${history.availableMessages} messages · ${history.sentCharacters.toLocaleString()} characters · ~${history.estimatedTokens.toLocaleString()} tokens${omitted}`;
}

export function tokenBudgetDetail(preview: AssistantContextPreview) {
  const budget = preview.tokenBudget;
  const estimate = `~${budget.estimatedInputTokens.toLocaleString()} visible tokens`;
  if (budget.maxInputTokens === null)
    return `${estimate} · model limit unknown`;
  return `${estimate} of ${budget.maxInputTokens.toLocaleString()} · ${budget.utilizationPercent}%`;
}

export function contextPressureDetail(preview: AssistantContextPreview) {
  const budget = preview.tokenBudget;
  if (budget.promptCompactionLikely) {
    return `The prompt exceeds the runtime's ${budget.promptCompactionThresholdTokens?.toLocaleString()} token pre-compaction threshold. OxideStudio will preserve all source ranges in a requirements digest before the model runs.`;
  }
  if (budget.pressure === "compaction-likely") {
    return "Visible context is near the model limit. The runtime may offload tool observations or summarize older history.";
  }
  if (budget.pressure === "approaching") {
    return "Visible context is approaching the model limit. Runtime instructions and provider tokenization may increase the final count.";
  }
  return "Token count is an estimate; runtime instructions and provider tokenization are not included.";
}

export function compactionDetail(preview: AssistantContextPreview) {
  const stats = preview.previousCompaction;
  if (!stats) return "No previous compaction";
  return `${stats.count} event${stats.count === 1 ? "" : "s"} · last ${stats.lastInputTokens.toLocaleString()} → ${stats.lastRetainedTokens.toLocaleString()} tokens · ${stats.offloadedArtifacts} artifact${stats.offloadedArtifacts === 1 ? "" : "s"} offloaded`;
}

export function modelUsageDetail(preview: AssistantContextPreview) {
  const usage = preview.previousModelUsage;
  if (!usage) return "No provider usage reported";
  return `${usage.calls} call${usage.calls === 1 ? "" : "s"} · ${usage.inputTokens.toLocaleString()} input + ${usage.outputTokens.toLocaleString()} output = ${usage.totalTokens.toLocaleString()} actual tokens`;
}

export function omissionDetail(preview: AssistantContextPreview) {
  return preview.omissions
    .map((omission) => {
      const source = omission.source.replace("-", " ");
      const amounts = [
        omission.omittedMessages
          ? `${omission.omittedMessages} messages`
          : null,
        omission.omittedCharacters
          ? `${omission.omittedCharacters.toLocaleString()} characters`
          : null,
      ].filter(Boolean);
      return `${source}: ${omission.reason}${amounts.length ? ` (${amounts.join(", ")})` : ""}`;
    })
    .join(" · ");
}
