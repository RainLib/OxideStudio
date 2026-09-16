import {
  assistantTurnIsActive,
  createAssistantTurn,
  upsertAssistantProcessItem,
  type AssistantTurn,
} from "@/ai/assistant/turns";
import {
  commandDeadline,
  conversationScope,
  createAgentId,
  requestMetadata,
} from "@/features/assistant-session/model/conversationIdentity";
import { errorMessage } from "@/features/assistant-session/model/sessionErrors";
import { AI_PROVIDER_REQUIRED_MESSAGE } from "@/features/assistant-session/model/sessionPolicy";
import {
  type AssistantAgentStartTurnRequest,
  type PendingConversationSnapshot,
} from "@/features/assistant-session/model/sessionTypes";
import {
  clarificationAnswerLabel,
  nextProcessSequence,
} from "@/features/assistant-session/model/turnProgress";
import type { ConversationSnapshotSaveQueue } from "@/features/assistant-session/runtime/conversationSnapshots";
import { conversationSnapshotRequest } from "@/features/assistant-session/runtime/conversationSnapshots";
import { retainLiveConversationState } from "@/features/assistant-session/runtime/liveConversationCache";
import {
  agentHostService,
  type AgentApprovalDecision,
  type AgentHostAvailability,
  type AgentStartTurnRequest,
} from "@/services/tauri/agent-host.service";
import { useCallback } from "react";

interface AssistantTurnCommandsContext {
  threadIdRef: React.RefObject<string>;
  mutateTurns: (update: (current: AssistantTurn[]) => AssistantTurn[]) => void;
  setHostError: React.Dispatch<React.SetStateAction<string | null>>;
  updateTurn: (
    turnId: string,
    update: (turn: AssistantTurn) => AssistantTurn,
  ) => void;
  resumeRequestsRef: React.RefObject<Map<string, AgentStartTurnRequest>>;
  projectIdRef: React.RefObject<string>;
  conversationIdRef: React.RefObject<string | undefined>;
  turnsRef: React.RefObject<AssistantTurn[]>;
  latestPersistSnapshotRef: React.RefObject<PendingConversationSnapshot | null>;
  persistQueueRef: React.RefObject<ConversationSnapshotSaveQueue>;
  setAvailability: React.Dispatch<React.SetStateAction<AgentHostAvailability>>;
  handleCommandError: (
    error: unknown,
    turnId?: string | undefined,
    resumable?: boolean,
  ) => void;
  cancellationReconcileTimersRef: React.RefObject<Map<string, number>>;
}

export function useAssistantTurnCommands({
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
}: AssistantTurnCommandsContext) {
  const startTurn = useCallback(
    async (request: AssistantAgentStartTurnRequest) => {
      const {
        requestedMode,
        contextVersion,
        deadline,
        provider,
        displayMessage,
        inputAttachments,
        ...payload
      } = request;
      const threadId = threadIdRef.current;
      const turn: AssistantTurn = {
        ...createAssistantTurn({
          id: request.turnId,
          requestId: request.requestId,
          projectId: request.projectId,
          requestedMode,
          mode: request.profile,
          userMessage: displayMessage ?? request.prompt,
        }),
        threadId,
        userAttachments: inputAttachments,
      };
      mutateTurns((current) => [...current, turn]);
      setHostError(null);

      if (!provider) {
        updateTurn(request.turnId, (current) => ({
          ...current,
          status: "failed",
          error: AI_PROVIDER_REQUIRED_MESSAGE,
          errorDetail: null,
          updatedAt: Date.now(),
        }));
        return;
      }

      const commandRequest: AgentStartTurnRequest = {
        ...payload,
        threadId,
        contextVersion,
        deadline: deadline ?? commandDeadline(provider.timeoutMs),
        provider,
      };
      resumeRequestsRef.current.set(request.turnId, commandRequest);
      retainLiveConversationState(
        conversationScope(projectIdRef.current, conversationIdRef.current),
        threadIdRef.current,
        turnsRef.current,
        resumeRequestsRef.current,
      );

      try {
        // Persist the accepted intent before a provider process can start. If
        // the desktop process is interrupted immediately after Host accepts,
        // restoreConversationTurns can then safely mark the exact turn as
        // paused (HTTP) or manually retryable (CLI), instead of losing it in
        // the debounce window.
        const checkpoint = conversationSnapshotRequest(
          projectIdRef.current,
          conversationIdRef.current,
          threadIdRef.current,
          turnsRef.current,
          resumeRequestsRef.current,
        );
        latestPersistSnapshotRef.current = checkpoint;
        await persistQueueRef.current.flush(checkpoint.request);
        if (projectIdRef.current !== request.projectId) return;
      } catch (error) {
        resumeRequestsRef.current.delete(request.turnId);
        const detail = errorMessage(error);
        updateTurn(request.turnId, (current) => ({
          ...current,
          status: "failed",
          error:
            "OxideStudio could not save the recovery checkpoint, so this task was not started.",
          errorDetail: detail,
          updatedAt: Date.now(),
        }));
        return;
      }

      try {
        const handle = await agentHostService.startTurn(commandRequest);
        if (projectIdRef.current !== request.projectId) return;
        if (!handle.accepted) {
          throw new Error("Agent Host rejected the request.");
        }
        setAvailability("available");
        updateTurn(request.turnId, (current) => ({
          ...current,
          threadId: handle.threadId,
          status: current.status === "planning" ? "running" : current.status,
          updatedAt: Date.now(),
        }));
      } catch (error) {
        handleCommandError(error, request.turnId);
      }
    },
    [handleCommandError, mutateTurns, updateTurn],
  );

  const answerClarification = useCallback(
    async (
      turnId: string,
      clarificationId: string,
      answers: Record<string, string>,
      _contextFingerprint: string,
    ) => {
      const turn = turnsRef.current.find(
        (candidate) => candidate.id === turnId,
      );
      const source = resumeRequestsRef.current.get(turnId);
      if (!turn?.threadId || !source) return;

      const group = turn.clarifications.filter(
        (clarification) => clarification.clarificationId === clarificationId,
      );
      const answeredGroup = group.map((clarification) => {
        const answer = answers[clarification.questionId]?.trim();
        return answer ? { ...clarification, answer } : clarification;
      });
      if (
        answeredGroup.length === 0 ||
        answeredGroup.some((clarification) => !clarification.answer?.trim())
      ) {
        return;
      }

      try {
        const acknowledgement = await agentHostService.answerClarification({
          // A human answer resumes the same pinned workspace snapshot. Using
          // the latest UI fingerprint here makes a harmless selection or tab
          // refresh look like a cross-context resume to the Rust safety gate.
          ...requestMetadata(
            turn,
            source.contextVersion,
            source.provider.timeoutMs,
          ),
          clarificationId,
          answers: Object.fromEntries(
            answeredGroup.map((clarification) => [
              clarification.questionId,
              clarification.answer!.trim(),
            ]),
          ),
        });
        if (!acknowledgement.accepted) {
          throw new Error("Agent Host rejected the clarification answer.");
        }
        updateTurn(turnId, (current) => ({
          ...current,
          status: "running",
          error: null,
          errorDetail: null,
          process: upsertAssistantProcessItem(current.process, {
            id: `clarification:${clarificationId}`,
            sequence: nextProcessSequence(current.process),
            kind: "clarification",
            title:
              answeredGroup.length === 1
                ? "Confirmed answer"
                : `Confirmed ${answeredGroup.length} answers`,
            detail: answeredGroup
              .map(
                (clarification) =>
                  `${clarification.question}\n${clarificationAnswerLabel(clarification)}`,
              )
              .join("\n\n"),
            status: "completed",
            startedAt: Date.now(),
            finishedAt: Date.now(),
          }),
          clarifications: current.clarifications.map((clarification) => {
            const answered = answeredGroup.find(
              (candidate) =>
                candidate.questionId === clarification.questionId &&
                candidate.clarificationId === clarification.clarificationId,
            );
            return answered
              ? {
                  ...clarification,
                  answer: answered.answer,
                  answeredAt: Date.now(),
                }
              : clarification;
          }),
          updatedAt: Date.now(),
        }));
      } catch (error) {
        handleCommandError(error, turnId, true);
      }
    },
    [handleCommandError, updateTurn],
  );

  const decideApproval = useCallback(
    async (
      turnId: string,
      approvalId: string,
      decision: AgentApprovalDecision,
      _contextFingerprint: string,
      confirmationText?: string,
    ) => {
      const turn = turnsRef.current.find(
        (candidate) => candidate.id === turnId,
      );
      const source = resumeRequestsRef.current.get(turnId);
      const approval = turn?.approvals.find(
        (candidate) => candidate.approvalId === approvalId,
      );
      if (!turn?.threadId || !approval || approval.decision) return;
      if (!source) {
        handleCommandError(
          new Error(
            "The saved workspace snapshot for this approval is unavailable. Resume or restart the task safely.",
          ),
          turnId,
          true,
        );
        return;
      }
      try {
        const acknowledgement = await agentHostService.approveAction({
          // The approval was issued for the turn's frozen workspace snapshot.
          // Using the live UI fingerprint makes harmless tab/schema refreshes
          // fail the Rust context gate even though the digest-bound approval
          // still belongs to this exact active turn.
          ...requestMetadata(
            turn,
            source.contextVersion,
            source.provider.timeoutMs,
          ),
          approvalId,
          decision,
          ...(confirmationText ? { confirmationText } : {}),
        });
        if (!acknowledgement.accepted) {
          throw new Error("Agent Host rejected the approval decision.");
        }
        updateTurn(turnId, (current) => ({
          ...current,
          status: "running",
          error: null,
          errorDetail: null,
          approvals: current.approvals.map((candidate) =>
            candidate.approvalId === approvalId
              ? {
                  ...candidate,
                  decision: decision === "approve" ? "approved" : "rejected",
                  decidedAt: Date.now(),
                }
              : candidate,
          ),
          updatedAt: Date.now(),
        }));
      } catch (error) {
        handleCommandError(error, turnId, true);
      }
    },
    [handleCommandError, updateTurn],
  );

  const cancelTurn = useCallback(
    async (turnId: string) => {
      const turn = turnsRef.current.find(
        (candidate) => candidate.id === turnId,
      );
      const source = resumeRequestsRef.current.get(turnId);
      if (!turn?.threadId || !source || !assistantTurnIsActive(turn)) return;
      updateTurn(turnId, (current) => ({
        ...current,
        status: "cancelling",
        updatedAt: Date.now(),
      }));
      try {
        const acknowledgement = await agentHostService.cancelTurn(
          requestMetadata(
            turn,
            source.contextVersion,
            source.provider.timeoutMs,
          ),
        );
        if (!acknowledgement.accepted) {
          throw new Error("Agent Host rejected cancellation.");
        }
        const timer = window.setTimeout(() => {
          void agentHostService
            .getTurnRuntimeStatus(
              requestMetadata(
                turn,
                source.contextVersion,
                source.provider.timeoutMs,
              ),
            )
            .then((runtime) => {
              if (runtime.active) return;
              updateTurn(turnId, (current) =>
                current.status === "cancelling"
                  ? {
                      ...current,
                      status: "cancelled",
                      error: null,
                      errorDetail: null,
                      updatedAt: Date.now(),
                    }
                  : current,
              );
            })
            .catch(() => undefined)
            .finally(() => {
              cancellationReconcileTimersRef.current.delete(turnId);
            });
        }, 2_000);
        cancellationReconcileTimersRef.current.set(turnId, timer);
      } catch (error) {
        handleCommandError(error, turnId, true);
      }
    },
    [handleCommandError, updateTurn],
  );

  const resumeTurn = useCallback(
    async (turnId: string, _contextFingerprint: string) => {
      const turn = turnsRef.current.find(
        (candidate) => candidate.id === turnId,
      );
      const source = resumeRequestsRef.current.get(turnId);
      if (!turn?.threadId || !source || turn.status !== "paused") return;

      const request: AgentStartTurnRequest = {
        ...source,
        requestId: createAgentId("request:resume"),
        threadId: turn.threadId,
        // Retry the persisted turn against the snapshot it was created with.
        // Project changes cancel the turn separately, so adopting the latest
        // fingerprint here only creates a false stale-context mismatch.
        contextVersion: source.contextVersion,
        deadline: commandDeadline(source.provider.timeoutMs),
        workspace: source.workspace,
      };
      resumeRequestsRef.current.set(turnId, request);
      updateTurn(turnId, (current) => ({
        ...current,
        status: "planning",
        lastEventSequence: undefined,
        error: null,
        errorDetail: null,
        updatedAt: Date.now(),
      }));
      try {
        const cliProvider =
          request.provider.kind === "codex-cli" ||
          request.provider.kind === "codebuddy-cli";
        const handle = cliProvider
          ? await agentHostService.startTurn({
              ...request,
              resumeCheckpoint: undefined,
            })
          : await agentHostService.resumeTurn(request);
        if (!handle.accepted) {
          throw new Error("Agent Host rejected resume.");
        }
        updateTurn(turnId, (current) => ({
          ...current,
          threadId: handle.threadId,
          status: "running",
          updatedAt: Date.now(),
        }));
      } catch (error) {
        handleCommandError(error, turnId, true);
      }
    },
    [handleCommandError, updateTurn],
  );

  return {
    startTurn,
    answerClarification,
    decideApproval,
    cancelTurn,
    resumeTurn,
  };
}
