import type { AssistantIntent, AssistantTurnInput } from "@/ai/assistant/types";
import {
  hasExplainIntent,
  hasKeyReadIntent,
  hasMetadataIntent,
  hasQueryIntent,
  hasWorkspaceIntent,
  hasWriteIntent,
} from "@/ai/assistant/planner/intentSignals";

export function classifyAssistantIntent(
  input: AssistantTurnInput,
): AssistantIntent {
  const text = `${input.message} ${input.selectedText || ""}`.toLowerCase();
  if (!text.trim()) return "unknown";

  if (hasExplainIntent(text)) {
    return "explain";
  }
  if (hasWriteIntent(text)) {
    return "query";
  }
  if (hasKeyReadIntent(text)) {
    return "query";
  }
  if (hasQueryIntent(text)) {
    return "query";
  }
  if (hasMetadataIntent(text)) {
    return "metadata";
  }
  if (hasWorkspaceIntent(text)) {
    return "workspace";
  }

  return "unknown";
}
