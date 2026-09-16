import { type AssistantTurn } from "@/ai/assistant/turns";
import { applyTurnEvents } from "@/features/assistant-session/model/agentEventReducer";
import { type AgentHostEvent } from "@/services/tauri/agent-host.service";

export function flushPendingDeltaEvents(
  pending: Map<string, AgentHostEvent[]>,
  frameRef: { current: number | null },
  mutateTurns: (update: (current: AssistantTurn[]) => AssistantTurn[]) => void,
) {
  if (frameRef.current !== null) {
    window.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }
  if (pending.size === 0) return;
  const batches = new Map(pending);
  pending.clear();
  mutateTurns((current) =>
    current.map((turn) => applyTurnEvents(turn, batches.get(turn.id) ?? [])),
  );
}
