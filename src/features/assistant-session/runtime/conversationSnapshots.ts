import {
  assistantTurnIsActive,
  type AssistantTurn,
} from "@/ai/assistant/turns";
import { conversationScope } from "@/features/assistant-session/model/conversationIdentity";
import {
  type ConversationSnapshotSaveRequest,
  type PendingConversationSnapshot,
} from "@/features/assistant-session/model/sessionTypes";
import { type AgentStartTurnRequest } from "@/services/tauri/agent-host.service";

export function conversationSnapshotRequest(
  projectId: string,
  conversationId: string | undefined,
  threadId: string,
  turns: readonly AssistantTurn[],
  resumeRequestsByTurn: ReadonlyMap<string, AgentStartTurnRequest>,
): PendingConversationSnapshot {
  const persistedTurns = turns.slice(-100);
  const resumableTurnIds = new Set(
    persistedTurns
      .filter((turn) => assistantTurnIsActive(turn) || turn.status === "paused")
      .map((turn) => turn.id),
  );
  const resumeRequests = Array.from(resumeRequestsByTurn.entries())
    .filter(([turnId]) => resumableTurnIds.has(turnId))
    .map(([, request]) => request)
    .slice(-8);
  return {
    scope: conversationScope(projectId, conversationId),
    request: {
      projectId,
      conversationId,
      threadId,
      turns: persistedTurns,
      resumeRequests,
    },
  };
}

export function clearConversationSnapshotTimers(
  trailingTimerRef: { current: number | null },
  maxWaitTimerRef: { current: number | null },
  dirtySinceRef: { current: number | null },
) {
  if (trailingTimerRef.current !== null) {
    window.clearTimeout(trailingTimerRef.current);
    trailingTimerRef.current = null;
  }
  if (maxWaitTimerRef.current !== null) {
    window.clearTimeout(maxWaitTimerRef.current);
    maxWaitTimerRef.current = null;
  }
  dirtySinceRef.current = null;
}

export function createConversationSnapshotSaveQueue(
  save: (request: ConversationSnapshotSaveRequest) => Promise<unknown>,
) {
  type QueuedSnapshot = {
    request: ConversationSnapshotSaveRequest;
    sequence: number;
  };
  let pending: QueuedSnapshot | null = null;
  let draining = false;
  let drainPromise: Promise<void> | null = null;
  let nextSequence = 0;
  let settledSequence = 0;
  const failures = new Map<number, unknown>();

  const enqueueRequest = (request: ConversationSnapshotSaveRequest) => {
    const sequence = ++nextSequence;
    pending = { request, sequence };
    return sequence;
  };

  const drain = async () => {
    if (draining) return;
    draining = true;
    try {
      while (pending) {
        const queued = pending;
        pending = null;
        try {
          await save(queued.request);
        } catch (error) {
          failures.set(queued.sequence, error);
          console.warn("Failed to persist encrypted AI conversation", error);
        } finally {
          settledSequence = queued.sequence;
        }
      }
    } finally {
      draining = false;
      // An enqueue can race the final await continuation. Re-enter the drain
      // when that happens without allowing concurrent writes for one scope.
      if (pending) void drain();
    }
  };

  const scheduleDrain = () => {
    if (!drainPromise) {
      drainPromise = drain().finally(() => {
        drainPromise = null;
        if (pending) void scheduleDrain();
      });
    }
    return drainPromise;
  };

  return {
    enqueue(request: ConversationSnapshotSaveRequest) {
      enqueueRequest(request);
      void scheduleDrain();
    },
    async flush(request: ConversationSnapshotSaveRequest) {
      const targetSequence = enqueueRequest(request);
      // A queued older snapshot is always drained before this checkpoint. The
      // loop also covers a state update that arrives while the previous drain
      // promise is completing, preserving the queue's single-writer contract.
      do {
        await scheduleDrain();
      } while (settledSequence < targetSequence);
      const failedSequence = Array.from(failures.keys()).find(
        (sequence) => sequence >= targetSequence,
      );
      if (failedSequence !== undefined) {
        const failure = failures.get(failedSequence);
        failures.delete(failedSequence);
        throw failure;
      }
    },
  };
}

export type ConversationSnapshotSaveQueue = ReturnType<
  typeof createConversationSnapshotSaveQueue
>;
