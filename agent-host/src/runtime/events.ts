import { type AgentEvent } from "@oxide/agent-contract";
import { TurnExecution } from "./execution.js";
import { isRecord } from "./value.js";

export type EventPayload = AgentEvent extends infer Event
  ? Event extends AgentEvent
    ? Omit<Event, "threadId" | "turnId" | "sequence" | "occurredAt">
    : never
  : never;

export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export async function emitTodoPlan(
  execution: TurnExecution,
  result: unknown,
): Promise<void> {
  if (!isRecord(result) || !Array.isArray(result.todos)) return;
  const items = result.todos.flatMap((todo, index) => {
    if (!isRecord(todo) || typeof todo.content !== "string") return [];
    const status =
      todo.status === "in_progress"
        ? "running"
        : todo.status === "completed"
          ? "completed"
          : "pending";
    return [{ id: `todo-${index}`, title: todo.content, status } as const];
  });
  if (items.length > 0) await execution.emit({ type: "plan.changed", items });
}

export async function emitCompaction(
  execution: TurnExecution,
  result: unknown,
): Promise<void> {
  if (!isRecord(result) || !isRecord(result._summarizationEvent)) return;
  const event = result._summarizationEvent;
  const cutoff = typeof event.cutoffIndex === "number" ? event.cutoffIndex : 0;
  await execution.emit({
    type: "context.compacted",
    inputTokens: Math.max(0, cutoff * 400),
    retainedTokens: 0,
    offloadedArtifacts: event.filePath ? 1 : 0,
  });
}

export async function bestEffortEmit(
  execution: TurnExecution,
  event: EventPayload,
): Promise<void> {
  try {
    await execution.emit(event);
  } catch {
    // The host may already be gone. stdout must remain protocol-only.
  }
}
