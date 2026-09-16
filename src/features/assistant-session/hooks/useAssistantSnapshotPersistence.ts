import { type AssistantTurn } from "@/ai/assistant/turns";
import { conversationScope } from "@/features/assistant-session/model/conversationIdentity";
import {
  SNAPSHOT_PERSIST_DEBOUNCE_MS,
  SNAPSHOT_PERSIST_MAX_WAIT_MS,
} from "@/features/assistant-session/model/sessionPolicy";
import { type PendingConversationSnapshot } from "@/features/assistant-session/model/sessionTypes";
import type { ConversationSnapshotSaveQueue } from "@/features/assistant-session/runtime/conversationSnapshots";
import {
  clearConversationSnapshotTimers,
  conversationSnapshotRequest,
} from "@/features/assistant-session/runtime/conversationSnapshots";
import { type AgentStartTurnRequest } from "@/services/tauri/agent-host.service";
import { useEffect } from "react";

interface AssistantSnapshotPersistenceContext {
  projectId: string;
  conversationId: string | undefined;
  hydratedScopeRef: React.RefObject<string | null>;
  failedHydrationScopeRef: React.RefObject<string | null>;
  latestPersistSnapshotRef: React.RefObject<PendingConversationSnapshot | null>;
  threadIdRef: React.RefObject<string>;
  turnsRef: React.RefObject<AssistantTurn[]>;
  resumeRequestsRef: React.RefObject<Map<string, AgentStartTurnRequest>>;
  persistTimerRef: React.RefObject<number | null>;
  persistMaxWaitTimerRef: React.RefObject<number | null>;
  persistDirtySinceRef: React.RefObject<number | null>;
  persistQueueRef: React.RefObject<ConversationSnapshotSaveQueue>;
  turns: AssistantTurn[];
}

export function useAssistantSnapshotPersistence({
  projectId,
  conversationId,
  hydratedScopeRef,
  failedHydrationScopeRef,
  latestPersistSnapshotRef,
  threadIdRef,
  turnsRef,
  resumeRequestsRef,
  persistTimerRef,
  persistMaxWaitTimerRef,
  persistDirtySinceRef,
  persistQueueRef,
  turns,
}: AssistantSnapshotPersistenceContext) {
  useEffect(() => {
    const scope = conversationScope(projectId, conversationId);
    if (
      hydratedScopeRef.current !== scope ||
      failedHydrationScopeRef.current === scope
    ) {
      return;
    }
    latestPersistSnapshotRef.current = conversationSnapshotRequest(
      projectId,
      conversationId,
      threadIdRef.current,
      turnsRef.current,
      resumeRequestsRef.current,
    );
    const flushSnapshot = () => {
      clearConversationSnapshotTimers(
        persistTimerRef,
        persistMaxWaitTimerRef,
        persistDirtySinceRef,
      );
      const snapshot = latestPersistSnapshotRef.current;
      if (
        snapshot?.scope !== scope ||
        hydratedScopeRef.current !== scope ||
        failedHydrationScopeRef.current === scope
      ) {
        return;
      }
      persistQueueRef.current.enqueue(snapshot.request);
    };
    const now = Date.now();
    persistDirtySinceRef.current ??= now;
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null;
      flushSnapshot();
    }, SNAPSHOT_PERSIST_DEBOUNCE_MS);
    if (persistMaxWaitTimerRef.current === null) {
      const elapsed = now - persistDirtySinceRef.current;
      persistMaxWaitTimerRef.current = window.setTimeout(
        flushSnapshot,
        Math.max(0, SNAPSHOT_PERSIST_MAX_WAIT_MS - elapsed),
      );
    }
  }, [conversationId, projectId, turns]);

  useEffect(() => {
    const queue = persistQueueRef.current;
    return () => {
      clearConversationSnapshotTimers(
        persistTimerRef,
        persistMaxWaitTimerRef,
        persistDirtySinceRef,
      );
      const snapshot = latestPersistSnapshotRef.current;
      if (snapshot) queue.enqueue(snapshot.request);
    };
  }, []);
}
