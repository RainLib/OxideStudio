import {
  assistantTurnIsActive,
  type AssistantTurn,
} from "@/ai/assistant/turns";
import {
  applyBufferedAgentEvents,
  applyTurnEvents,
  mergeAgentEvents,
} from "@/features/assistant-session/model/agentEventReducer";
import { newerContextMetrics } from "@/features/assistant-session/model/contextMetrics";
import {
  conversationScope,
  createAgentId,
  requestMetadata,
} from "@/features/assistant-session/model/conversationIdentity";
import {
  restoreConversationRequests,
  restoreConversationTurns,
} from "@/features/assistant-session/model/restoreConversation";
import { type PendingConversationSnapshot } from "@/features/assistant-session/model/sessionTypes";
import type { ConversationSnapshotSaveQueue } from "@/features/assistant-session/runtime/conversationSnapshots";
import { clearConversationSnapshotTimers } from "@/features/assistant-session/runtime/conversationSnapshots";
import { flushPendingDeltaEvents } from "@/features/assistant-session/runtime/deltaEvents";
import { assistantHostEventBroker } from "@/features/assistant-session/runtime/hostEventBroker";
import {
  readLiveConversationState,
  retainLiveConversationState,
} from "@/features/assistant-session/runtime/liveConversationCache";
import { syncAppliedProjectFile } from "@/features/assistant-session/runtime/projectFileSync";
import {
  agentHostService,
  type AgentContextMetrics,
  type AgentHostAvailability,
  type AgentHostEvent,
  type AgentStartTurnRequest,
} from "@/services/tauri/agent-host.service";
import { useEffect } from "react";

interface AssistantConversationLifecycleContext {
  projectIdRef: React.RefObject<string>;
  conversationIdRef: React.RefObject<string | undefined>;
  projectId: string;
  conversationId: string | undefined;
  failedHydrationScopeRef: React.RefObject<string | null>;
  latestPersistSnapshotRef: React.RefObject<PendingConversationSnapshot | null>;
  persistQueueRef: React.RefObject<ConversationSnapshotSaveQueue>;
  turnsRef: React.RefObject<AssistantTurn[]>;
  resumeRequestsRef: React.RefObject<Map<string, AgentStartTurnRequest>>;
  setIsHydrating: React.Dispatch<React.SetStateAction<boolean>>;
  setHydrationError: React.Dispatch<React.SetStateAction<string | null>>;
  threadIdRef: React.RefObject<string>;
  hydratedScopeRef: React.RefObject<string | null>;
  pendingEventsRef: React.RefObject<AgentHostEvent[]>;
  pendingDeltaEventsRef: React.RefObject<Map<string, AgentHostEvent[]>>;
  deltaFlushFrameRef: React.RefObject<number | null>;
  persistTimerRef: React.RefObject<number | null>;
  persistMaxWaitTimerRef: React.RefObject<number | null>;
  persistDirtySinceRef: React.RefObject<number | null>;
  setTurns: React.Dispatch<React.SetStateAction<AssistantTurn[]>>;
  setHostError: React.Dispatch<React.SetStateAction<string | null>>;
  setAvailability: React.Dispatch<React.SetStateAction<AgentHostAvailability>>;
  setContextMetrics: React.Dispatch<
    React.SetStateAction<AgentContextMetrics | null>
  >;
  mutateTurns: (update: (current: AssistantTurn[]) => AssistantTurn[]) => void;
  handleCommandError: (
    error: unknown,
    turnId?: string | undefined,
    resumable?: boolean,
  ) => void;
  cancellationReconcileTimersRef: React.RefObject<Map<string, number>>;
  hydrationRevision: number;
  refreshStatus: () => Promise<void>;
}

export function useAssistantConversationLifecycle({
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
}: AssistantConversationLifecycleContext) {
  useEffect(() => {
    const previousProjectId = projectIdRef.current;
    const previousConversationId = conversationIdRef.current;
    const previousScope = conversationScope(
      previousProjectId,
      previousConversationId,
    );
    const nextScope = conversationScope(projectId, conversationId);
    if (failedHydrationScopeRef.current !== nextScope) {
      failedHydrationScopeRef.current = null;
    }
    if (previousScope !== nextScope) {
      const previousSnapshot = latestPersistSnapshotRef.current;
      if (previousSnapshot?.scope === previousScope) {
        persistQueueRef.current.enqueue(previousSnapshot.request);
      }
      for (const turn of turnsRef.current) {
        const source = resumeRequestsRef.current.get(turn.id);
        if (
          turn.projectId !== previousProjectId ||
          !turn.threadId ||
          !source ||
          !assistantTurnIsActive(turn)
        ) {
          continue;
        }
        void agentHostService
          .cancelTurn(
            requestMetadata(
              turn,
              source.contextVersion,
              source.provider.timeoutMs,
            ),
          )
          .catch(() => undefined);
      }
    }

    projectIdRef.current = projectId;
    conversationIdRef.current = conversationId;
    setIsHydrating(true);
    setHydrationError(null);
    const retainedState = readLiveConversationState(nextScope);
    threadIdRef.current =
      retainedState?.threadId ??
      createAgentId(`thread:${projectId}:${conversationId || "default"}`);
    hydratedScopeRef.current = null;
    pendingEventsRef.current = [];
    pendingDeltaEventsRef.current.clear();
    if (deltaFlushFrameRef.current !== null) {
      window.cancelAnimationFrame(deltaFlushFrameRef.current);
      deltaFlushFrameRef.current = null;
    }
    clearConversationSnapshotTimers(
      persistTimerRef,
      persistMaxWaitTimerRef,
      persistDirtySinceRef,
    );
    latestPersistSnapshotRef.current = null;
    resumeRequestsRef.current = new Map(retainedState?.resumeRequests ?? []);
    turnsRef.current = retainedState?.turns ?? [];
    setTurns(turnsRef.current);
    setHostError(null);
    setAvailability("checking");

    let disposed = false;
    let unlisten: (() => void) | undefined;
    void assistantHostEventBroker
      .subscribe((event) => {
        if (disposed) return;
        const eventMetrics = event.projectMetrics;
        if (eventMetrics?.projectId === projectIdRef.current) {
          setContextMetrics((current) =>
            newerContextMetrics(current, eventMetrics),
          );
        }
        if (
          event.type === "file.changed" &&
          event.reviewable === true &&
          typeof event.appliedContent === "string"
        ) {
          const turn = turnsRef.current.find(
            (candidate) => candidate.id === event.turnId,
          );
          if (turn) {
            syncAppliedProjectFile(
              turn.projectId,
              event.relativePath,
              event.appliedContent,
              event.revision,
            );
          }
        }
        if (hydratedScopeRef.current !== nextScope) {
          pendingEventsRef.current.push(event);
          if (pendingEventsRef.current.length > 2_000) {
            pendingEventsRef.current.shift();
            setHostError(
              "Assistant event hydration exceeded its safety buffer. The latest activity is retained; verify the active task before retrying it.",
            );
          }
          return;
        }
        if (event.type === "answer.delta") {
          const pending = pendingDeltaEventsRef.current.get(event.turnId) ?? [];
          pending.push(event);
          pendingDeltaEventsRef.current.set(event.turnId, pending);
          if (deltaFlushFrameRef.current === null) {
            deltaFlushFrameRef.current = window.requestAnimationFrame(() => {
              deltaFlushFrameRef.current = null;
              const batches = pendingDeltaEventsRef.current;
              pendingDeltaEventsRef.current = new Map();
              mutateTurns((current) =>
                current.map((turn) =>
                  applyTurnEvents(turn, batches.get(turn.id) ?? []),
                ),
              );
            });
          }
          return;
        }
        flushPendingDeltaEvents(
          pendingDeltaEventsRef.current,
          deltaFlushFrameRef,
          mutateTurns,
        );
        mutateTurns((current) =>
          current.map((turn) => applyTurnEvents(turn, [event])),
        );
      })
      .then((cleanup) => {
        if (disposed) cleanup();
        else unlisten = cleanup;
      })
      .catch((error) => {
        if (!disposed) handleCommandError(error);
      });

    void agentHostService
      .loadConversationSnapshot(projectId, conversationId)
      .then(async (snapshot) => {
        if (
          disposed ||
          conversationScope(projectIdRef.current, conversationIdRef.current) !==
            nextScope
        )
          return;
        const restoredTurns = restoreConversationTurns(snapshot?.turns);
        const journals = await Promise.all(
          restoredTurns.map(async (turn) => {
            if (!turn.threadId) return null;
            try {
              return await agentHostService.loadTurnJournal(
                projectId,
                turn.threadId,
                turn.id,
              );
            } catch (error) {
              // A journal is an extra recovery signal. A missing/expired
              // record must not make the encrypted conversation snapshot
              // unreadable or alter the conservative restart policy.
              console.warn("Failed to load agent recovery journal", error);
              return null;
            }
          }),
        );
        if (journals.some((journal) => journal?.truncated)) {
          setHostError(
            "The recovered Assistant activity log was truncated. Verify any unfinished work before retrying it.",
          );
        }
        const journalEvents = journals.flatMap(
          (journal) => journal?.events ?? [],
        );
        const restoredRequests = restoreConversationRequests(
          snapshot?.resumeRequests,
        );
        const requestByTurn = new Map(
          restoredRequests.map((request) => [request.turnId, request]),
        );
        const resumableTurns = restoredTurns.map((turn) => {
          if (!assistantTurnIsActive(turn)) return turn;
          const source = requestByTurn.get(turn.id);
          const canResume = Boolean(source);
          const cliProvider =
            source?.provider.kind === "codex-cli" ||
            source?.provider.kind === "codebuddy-cli";
          const mutationResultUnknown = turn.process.some(
            (item) =>
              item.kind === "tool" &&
              item.toolName === "query.executeApproved" &&
              item.status === "running",
          );
          if (mutationResultUnknown) {
            requestByTurn.delete(turn.id);
            return {
              ...turn,
              status: "failed" as const,
              error:
                "OxideStudio restarted while a database change was active. Verify the target manually; automatic retry is disabled.",
              errorDetail: null,
              updatedAt: Date.now(),
            };
          }
          return {
            ...turn,
            status:
              cliProvider || !canResume
                ? ("failed" as const)
                : ("paused" as const),
            error: cliProvider
              ? "The CLI was interrupted when OxideStudio restarted. Retry manually to start a fresh CLI turn; it will not replay automatically."
              : canResume
                ? "OxideStudio restarted while this task was running. Resume from its encrypted checkpoint when you are ready."
                : "OxideStudio restarted while this task was running. Start the request again to continue safely.",
            errorDetail: null,
            updatedAt: Date.now(),
          };
        });
        for (const turn of resumableTurns) {
          if (
            turn.status === "paused" &&
            (turn.error?.includes("fresh CLI turn") ||
              turn.error?.includes("Start the request again"))
          ) {
            requestByTurn.delete(turn.id);
          }
        }
        const liveTurns = turnsRef.current;
        const liveTurnIds = new Set(liveTurns.map((turn) => turn.id));
        const mergedTurns = liveTurns.length
          ? [
              ...resumableTurns.filter((turn) => !liveTurnIds.has(turn.id)),
              ...liveTurns,
            ]
          : resumableTurns;
        if (liveTurns.length === 0) {
          threadIdRef.current = snapshot?.threadId || threadIdRef.current;
          resumeRequestsRef.current = requestByTurn;
        } else {
          for (const [turnId, request] of requestByTurn) {
            if (!resumeRequestsRef.current.has(turnId)) {
              resumeRequestsRef.current.set(turnId, request);
            }
          }
        }
        const replayedEvents = assistantHostEventBroker.replayForTurns(
          // A remounted shared panel can retain live turns before its snapshot
          // finishes loading. Replay against the merged set, otherwise events
          // emitted while the panel was hidden have no matching cursor and
          // are silently skipped.
          mergedTurns,
        );
        const bufferedEvents = mergeAgentEvents(
          mergeAgentEvents(replayedEvents, journalEvents),
          pendingEventsRef.current,
        );
        pendingEventsRef.current = [];
        turnsRef.current = applyBufferedAgentEvents(
          mergedTurns,
          bufferedEvents,
        );
        failedHydrationScopeRef.current = null;
        setTurns(turnsRef.current);
        hydratedScopeRef.current = nextScope;
        setHydrationError(null);
        setIsHydrating(false);
        retainLiveConversationState(
          nextScope,
          threadIdRef.current,
          turnsRef.current,
          resumeRequestsRef.current,
        );
      })
      .catch((error) => {
        if (
          disposed ||
          conversationScope(projectIdRef.current, conversationIdRef.current) !==
            nextScope
        )
          return;
        console.warn("Failed to restore encrypted AI conversation", error);
        const recoveredEvents = mergeAgentEvents(
          assistantHostEventBroker.replayForTurns(turnsRef.current),
          pendingEventsRef.current,
        );
        pendingEventsRef.current = [];
        turnsRef.current = applyBufferedAgentEvents(
          turnsRef.current,
          recoveredEvents,
        );
        failedHydrationScopeRef.current = nextScope;
        setTurns(turnsRef.current);
        hydratedScopeRef.current = nextScope;
        setHydrationError(
          "The saved Assistant conversation could not be restored. Retry before sending a new message, or start a new chat to keep the saved history untouched.",
        );
        setIsHydrating(false);
        retainLiveConversationState(
          nextScope,
          threadIdRef.current,
          turnsRef.current,
          resumeRequestsRef.current,
        );
      });
    return () => {
      disposed = true;
      flushPendingDeltaEvents(
        pendingDeltaEventsRef.current,
        deltaFlushFrameRef,
        mutateTurns,
      );
      retainLiveConversationState(
        nextScope,
        threadIdRef.current,
        turnsRef.current,
        resumeRequestsRef.current,
      );
      unlisten?.();
      for (const timer of cancellationReconcileTimersRef.current.values()) {
        window.clearTimeout(timer);
      }
      cancellationReconcileTimersRef.current.clear();
    };
  }, [
    conversationId,
    handleCommandError,
    hydrationRevision,
    mutateTurns,
    projectId,
    refreshStatus,
  ]);
}
