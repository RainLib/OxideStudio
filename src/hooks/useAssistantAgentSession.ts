import { presentAssistantError } from "@/ai/assistant/errorPresentation";
import {
  assistantTurnIsActive,
  type AssistantTurn,
} from "@/ai/assistant/turns";
import { useAssistantConversationLifecycle } from "@/features/assistant-session/hooks/useAssistantConversationLifecycle";
import { useAssistantFileReview } from "@/features/assistant-session/hooks/useAssistantFileReview";
import { useAssistantSnapshotPersistence } from "@/features/assistant-session/hooks/useAssistantSnapshotPersistence";
import { useAssistantTurnCommands } from "@/features/assistant-session/hooks/useAssistantTurnCommands";
import { newerContextMetrics } from "@/features/assistant-session/model/contextMetrics";
import {
  conversationScope,
  createAgentId,
} from "@/features/assistant-session/model/conversationIdentity";
import { errorMessage } from "@/features/assistant-session/model/sessionErrors";
import {
  AGENT_STATUS_POLL_DELAY_MS,
  AGENT_UNAVAILABLE_MESSAGE,
} from "@/features/assistant-session/model/sessionPolicy";
import {
  type AssistantAgentSession,
  type PendingConversationSnapshot,
} from "@/features/assistant-session/model/sessionTypes";
import {
  clearConversationSnapshotTimers,
  conversationSnapshotRequest,
  createConversationSnapshotSaveQueue,
} from "@/features/assistant-session/runtime/conversationSnapshots";
import {
  deleteLiveConversationState,
  retainLiveConversationState,
} from "@/features/assistant-session/runtime/liveConversationCache";
import {
  agentHostService,
  isAgentHostUnavailableError,
  type AgentContextMetrics,
  type AgentHostAvailability,
  type AgentHostEvent,
  type AgentHostStatus,
  type AgentStartTurnRequest,
} from "@/services/tauri/agent-host.service";
import type { AiProviderKind } from "@/services/tauri/ai.service";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export function useAssistantAgentSession(
  projectId: string,
  providerConfigured = false,
  providerKind?: AiProviderKind,
  conversationId?: string,
): AssistantAgentSession {
  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const [isHydrating, setIsHydrating] = useState(true);
  const [hydrationError, setHydrationError] = useState<string | null>(null);
  const [hydrationRevision, setHydrationRevision] = useState(0);
  const [availability, setAvailability] =
    useState<AgentHostAvailability>("checking");
  const [hostStatus, setHostStatus] = useState<AgentHostStatus | null>(null);
  const [hostError, setHostError] = useState<string | null>(null);
  const [contextMetrics, setContextMetrics] =
    useState<AgentContextMetrics | null>(null);
  const projectIdRef = useRef(projectId);
  const conversationIdRef = useRef(conversationId);
  const providerConfiguredRef = useRef(providerConfigured);
  const providerKindRef = useRef(providerKind);
  const turnsRef = useRef<AssistantTurn[]>([]);
  const threadIdRef = useRef(
    createAgentId(`thread:${projectId}:${conversationId || "default"}`),
  );
  const resumeRequestsRef = useRef(new Map<string, AgentStartTurnRequest>());
  const hydratedScopeRef = useRef<string | null>(null);
  const failedHydrationScopeRef = useRef<string | null>(null);
  const persistTimerRef = useRef<number | null>(null);
  const persistMaxWaitTimerRef = useRef<number | null>(null);
  const persistDirtySinceRef = useRef<number | null>(null);
  const latestPersistSnapshotRef = useRef<PendingConversationSnapshot | null>(
    null,
  );
  const persistQueueRef = useRef(
    createConversationSnapshotSaveQueue((request) =>
      agentHostService.saveConversationSnapshot(request),
    ),
  );
  const pendingEventsRef = useRef<AgentHostEvent[]>([]);
  const pendingDeltaEventsRef = useRef(new Map<string, AgentHostEvent[]>());
  const deltaFlushFrameRef = useRef<number | null>(null);
  const cancellationReconcileTimersRef = useRef(new Map<string, number>());

  const mutateTurns = useCallback(
    (update: (current: AssistantTurn[]) => AssistantTurn[]) => {
      // React may defer a functional state updater. Event handling and the
      // launch checkpoint both need the latest turn synchronously, so make the
      // ref the serialized source of truth before scheduling the render.
      const next = update(turnsRef.current);
      turnsRef.current = next;
      retainLiveConversationState(
        conversationScope(projectIdRef.current, conversationIdRef.current),
        threadIdRef.current,
        next,
        resumeRequestsRef.current,
      );
      setTurns(next);
    },
    [],
  );

  const updateTurn = useCallback(
    (turnId: string, update: (turn: AssistantTurn) => AssistantTurn) => {
      mutateTurns((current) =>
        current.map((turn) => (turn.id === turnId ? update(turn) : turn)),
      );
    },
    [mutateTurns],
  );

  const handleCommandError = useCallback(
    (error: unknown, turnId?: string, resumable = false) => {
      const unavailable = isAgentHostUnavailableError(error);
      const rawMessage = errorMessage(error);
      const presentation = unavailable
        ? {
            message: AGENT_UNAVAILABLE_MESSAGE,
            detail:
              rawMessage === AGENT_UNAVAILABLE_MESSAGE ? null : rawMessage,
          }
        : presentAssistantError({
            message: rawMessage,
            retryable: resumable,
          });
      if (unavailable) {
        setAvailability("unavailable");
        setHostError(presentation.message);
      }
      if (turnId) {
        updateTurn(turnId, (turn) => ({
          ...turn,
          status: resumable ? "paused" : "failed",
          error: presentation.message,
          errorDetail: presentation.detail,
          updatedAt: Date.now(),
        }));
      }
    },
    [updateTurn],
  );

  const refreshStatus = useCallback(async () => {
    try {
      const configured = providerConfiguredRef.current;
      const status = await agentHostService.getStatus(
        configured,
        providerKindRef.current,
      );
      const checking =
        configured &&
        !status.available &&
        (status.state === "starting" || status.state === "stopped");
      setHostStatus(status);
      setAvailability(
        checking
          ? "checking"
          : configured && status.available
            ? "available"
            : "unavailable",
      );
      setHostError(
        !configured || status.state === "skipped" || checking
          ? null
          : status.available
            ? null
            : status.lastError || AGENT_UNAVAILABLE_MESSAGE,
      );
    } catch (error) {
      handleCommandError(error);
    }
  }, [handleCommandError]);

  providerConfiguredRef.current = providerConfigured;
  providerKindRef.current = providerKind;

  useAssistantConversationLifecycle({
    projectIdRef,
    conversationIdRef,
    projectId,
    conversationId,
    failedHydrationScopeRef,
    latestPersistSnapshotRef,
    persistQueueRef,
    turnsRef,
    resumeRequestsRef,
    setIsHydrating,
    setHydrationError,
    threadIdRef,
    hydratedScopeRef,
    pendingEventsRef,
    pendingDeltaEventsRef,
    deltaFlushFrameRef,
    persistTimerRef,
    persistMaxWaitTimerRef,
    persistDirtySinceRef,
    setTurns,
    setHostError,
    setAvailability,
    setContextMetrics,
    mutateTurns,
    handleCommandError,
    cancellationReconcileTimersRef,
    hydrationRevision,
    refreshStatus,
  });

  useAssistantSnapshotPersistence({
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
  });

  useEffect(() => {
    void refreshStatus();
  }, [providerConfigured, providerKind, refreshStatus]);

  useEffect(() => {
    let disposed = false;
    setContextMetrics(null);
    if (!projectId.trim()) return;
    void agentHostService
      .getContextMetrics(projectId)
      .then((metrics) => {
        if (!disposed && metrics.projectId === projectId) {
          setContextMetrics((current) => newerContextMetrics(current, metrics));
        }
      })
      .catch(() => {
        // Metrics are optional diagnostics. A storage/read failure must not
        // block the workspace or make the Agent Host appear unavailable.
      });
    return () => {
      disposed = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!providerConfigured || availability !== "checking") return;

    let disposed = false;
    let timer: number | undefined;
    const poll = async () => {
      await refreshStatus();
      if (!disposed) {
        timer = window.setTimeout(poll, AGENT_STATUS_POLL_DELAY_MS);
      }
    };

    timer = window.setTimeout(poll, AGENT_STATUS_POLL_DELAY_MS);
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [availability, providerConfigured, refreshStatus]);

  const {
    startTurn,
    answerClarification,
    decideApproval,
    cancelTurn,
    resumeTurn,
  } = useAssistantTurnCommands({
    threadIdRef,
    mutateTurns,
    setHostError,
    updateTurn,
    resumeRequestsRef,
    projectIdRef,
    conversationIdRef,
    turnsRef,
    latestPersistSnapshotRef,
    persistQueueRef,
    setAvailability,
    handleCommandError,
    cancellationReconcileTimersRef,
  });

  const {
    keepFileChange,
    undoFileChange,
    keepFileChangeHunk,
    undoFileChangeHunk,
  } = useAssistantFileReview({
    updateTurn,
    turnsRef,
  });

  const activeTurn = useMemo(
    () => [...turns].reverse().find(assistantTurnIsActive) ?? null,
    [turns],
  );
  const clear = useCallback(() => {
    if (turnsRef.current.some(assistantTurnIsActive)) return;
    const scope = conversationScope(
      projectIdRef.current,
      conversationIdRef.current,
    );
    // New Chat is a durable boundary, not merely a visual reset. Cancel any
    // debounce that could otherwise enqueue the prior conversation after this
    // empty checkpoint, then serialize the empty state before a panel unmount
    // can hand control back to the shared workspace shell.
    clearConversationSnapshotTimers(
      persistTimerRef,
      persistMaxWaitTimerRef,
      persistDirtySinceRef,
    );
    turnsRef.current = [];
    resumeRequestsRef.current.clear();
    threadIdRef.current = createAgentId(
      `thread:${projectIdRef.current}:${conversationIdRef.current || "default"}`,
    );
    const clearedSnapshot = conversationSnapshotRequest(
      projectIdRef.current,
      conversationIdRef.current,
      threadIdRef.current,
      turnsRef.current,
      resumeRequestsRef.current,
    );
    latestPersistSnapshotRef.current = clearedSnapshot;
    failedHydrationScopeRef.current = null;
    deleteLiveConversationState(scope);
    setTurns([]);
    persistQueueRef.current.enqueue(clearedSnapshot.request);
    setHostError(null);
    setHydrationError(null);
  }, []);

  const retryHydration = useCallback(() => {
    if (turnsRef.current.some(assistantTurnIsActive)) return;
    setHydrationRevision((current) => current + 1);
  }, []);

  return {
    turns,
    activeTurn,
    isHydrating,
    hydrationError,
    availability,
    hostStatus,
    hostError,
    contextMetrics,
    isBusy: Boolean(activeTurn),
    startTurn,
    answerClarification,
    decideApproval,
    cancelTurn,
    resumeTurn,
    keepFileChange,
    undoFileChange,
    keepFileChangeHunk,
    undoFileChangeHunk,
    clear,
    retryHydration,
    refreshStatus,
  };
}

export {
  applyBufferedAgentEvents,
  reduceAgentHostEvent,
} from "@/features/assistant-session/model/agentEventReducer";
export type {
  AssistantAgentSession,
  AssistantAgentStartTurnRequest,
} from "@/features/assistant-session/model/sessionTypes";
export { resetAssistantAgentRuntimeForTests } from "@/features/assistant-session/runtime/resetSessionRuntime";
