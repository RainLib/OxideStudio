import { type AssistantTurn } from "@/ai/assistant/turns";
import { MAX_LIVE_CONVERSATION_SCOPES } from "@/features/assistant-session/model/sessionPolicy";
import { type LiveConversationState } from "@/features/assistant-session/model/sessionTypes";
import { type AgentStartTurnRequest } from "@/services/tauri/agent-host.service";

export const liveConversationStates = new Map<string, LiveConversationState>();

export function retainLiveConversationState(
  scope: string,
  threadId: string,
  turns: readonly AssistantTurn[],
  resumeRequests: ReadonlyMap<string, AgentStartTurnRequest>,
) {
  liveConversationStates.delete(scope);
  liveConversationStates.set(scope, {
    threadId,
    turns: turns.slice(-100),
    resumeRequests: new Map(resumeRequests),
    updatedAt: Date.now(),
  });
  while (liveConversationStates.size > MAX_LIVE_CONVERSATION_SCOPES) {
    const oldestScope = liveConversationStates.keys().next().value;
    if (typeof oldestScope !== "string") break;
    liveConversationStates.delete(oldestScope);
  }
}

export function readLiveConversationState(scope: string) {
  return liveConversationStates.get(scope);
}
export function deleteLiveConversationState(scope: string) {
  liveConversationStates.delete(scope);
}
export function clearLiveConversationStates() {
  liveConversationStates.clear();
}
