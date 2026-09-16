import { type AssistantTurn } from "@/ai/assistant/turns";

export function assistantConversationContentVersion(
  turns: readonly AssistantTurn[],
  activeTurn: AssistantTurn | null,
) {
  // Deltas update a single active turn many times per second. The scroll and
  // minimap consumers only need to know whether the hot turn or conversation
  // tail changed; their DOM observers still catch any non-tail structural
  // update. Avoid mapping the full persisted conversation for each token.
  const tail = turns[turns.length - 1];
  const versionFor = (turn: AssistantTurn | null | undefined) =>
    turn
      ? `${turn.id}:${turn.updatedAt}:${turn.status}:${turn.process.length}:${turn.draft.length}:${turn.final?.content.length || 0}`
      : "none";
  return `${turns.length}|${versionFor(activeTurn)}|${versionFor(tail)}`;
}

/**
 * Conversation history intentionally contains only user requests, answered
 * clarifications, and final answers. During a streamed draft none of these
 * fields changes, so using this compact version avoids rebuilding history for
 * every token while still reacting immediately to a completed answer or an
 * answered clarification on the active turn.
 */
export function assistantConversationHistoryVersion(
  turns: readonly AssistantTurn[],
  activeTurn: AssistantTurn | null,
) {
  const tail = turns[turns.length - 1];
  const versionFor = (turn: AssistantTurn | null | undefined) =>
    turn
      ? `${turn.id}:${turn.final?.createdAt || 0}:${turn.clarifications
          .filter((clarification) => Boolean(clarification.answer?.trim()))
          .map(
            (clarification) =>
              `${clarification.clarificationId}:${clarification.answeredAt || 0}`,
          )
          .join("\\u0001")}`
      : "none";
  return `${turns.length}|${versionFor(activeTurn)}|${versionFor(tail)}`;
}

/**
 * Context metrics are emitted by the host when available. The local fallback
 * only changes on the active turn or the turn appended to the conversation;
 * keeping an O(1) dependency prevents the aggregate reducers from scanning a
 * long conversation for every streamed answer.delta batch.
 */
export function assistantTurnMetricsVersion(
  turns: readonly AssistantTurn[],
  activeTurn: AssistantTurn | null,
) {
  const tail = turns[turns.length - 1];
  const versionFor = (turn: AssistantTurn | null | undefined) =>
    turn
      ? `${turn.id}:${turn.contextCompaction?.count || 0}:${turn.contextCompaction?.lastInputTokens || 0}:${turn.contextCompaction?.lastRetainedTokens || 0}:${turn.contextCompaction?.offloadedArtifacts || 0}:${turn.modelUsage?.calls || 0}:${turn.modelUsage?.inputTokens || 0}:${turn.modelUsage?.outputTokens || 0}:${turn.modelUsage?.totalTokens || 0}`
      : "none";
  return `${turns.length}|${versionFor(activeTurn)}|${versionFor(tail)}`;
}
