import type {
  AssistantProjectFileChange,
  AssistantTurn,
} from "@/ai/assistant/turns";

export type AssistantFileChangeAttribution = AssistantProjectFileChange & {
  turnId: string;
  userMessage: string;
};

export type AssistantChangeFilter = "all" | "agent" | `turn:${string}`;

export function assistantFileChangeAttributions(
  turns: readonly AssistantTurn[],
): AssistantFileChangeAttribution[] {
  return turns.flatMap((turn) =>
    (turn.fileChanges ?? []).map((change) => ({
      ...change,
      turnId: turn.id,
      userMessage: turn.userMessage,
    })),
  );
}

export function attributionPathsForFilter(
  attributions: readonly AssistantFileChangeAttribution[],
  filter: AssistantChangeFilter,
): Set<string> | null {
  if (filter === "all") return null;
  const turnId = filter.startsWith("turn:") ? filter.slice(5) : null;
  return new Set(
    attributions
      .filter((change) => !turnId || change.turnId === turnId)
      .map((change) => change.relativePath),
  );
}

export function isAvailableAttributionFilter(
  attributions: readonly AssistantFileChangeAttribution[],
  filter: string,
): filter is AssistantChangeFilter {
  if (filter === "all") return true;
  if (filter === "agent") return attributions.length > 0;
  if (!filter.startsWith("turn:")) return false;
  const turnId = filter.slice(5);
  return attributions.some((change) => change.turnId === turnId);
}
