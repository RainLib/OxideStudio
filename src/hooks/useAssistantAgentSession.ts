import {
  assistantTurnIsActive,
  createAssistantTurn,
  upsertAssistantProcessItem,
  type AssistantApproval,
  type AssistantClarification,
  type AssistantProcessItem,
  type AssistantProcessStatus,
  type AssistantProjectFileProposal,
  type AssistantTurn,
  type AssistantTurnStatus,
} from "@/ai/assistant/turns";
import type { AssistantMode } from "@/ai/assistant/modes";
import { presentAssistantError } from "@/ai/assistant/errorPresentation";
import {
  agentHostService,
  isAgentCitation,
  isAgentHostUnavailableError,
  type AgentApprovalDecision,
  type AgentContextMetrics,
  type AgentHostAvailability,
  type AgentHostEvent,
  type AgentHostStatus,
  type AgentProviderConfig,
  type AgentRequestMetadata,
  type AgentStartTurnRequest,
} from "@/services/tauri/agent-host.service";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  projectFilesService,
  isProjectFileRevisionConflict,
  type ProjectFileWriteResult,
} from "@/services/tauri/project-files.service";
import {
  applyLineDiffHunk,
  lineDiffCounts,
  type LineDiffHunk,
} from "@/lib/lineDiff";
import { useTabStore } from "@/store/useTabStore";
import { useProjectFilesStore } from "@/store/useProjectFilesStore";

const AGENT_UNAVAILABLE_MESSAGE =
  "AI agent is unavailable. The database workspace remains fully usable; configure or restart the Agent Host and try again.";
const AI_PROVIDER_REQUIRED_MESSAGE =
  "Configure an AI provider in Settings > AI Assistant before starting this request.";
const DEFAULT_TURN_TIMEOUT_MS = 30 * 60 * 1_000;
const MAX_TURN_TIMEOUT_MS = 2 * 60 * 60 * 1_000;
const AGENT_STATUS_POLL_DELAY_MS = 300;

export type AssistantAgentStartTurnRequest = Omit<
  AgentStartTurnRequest,
  "threadId" | "contextVersion" | "deadline" | "provider"
> & {
  requestedMode: AssistantMode;
  contextVersion: string;
  deadline?: number;
  provider: AgentProviderConfig | null;
  displayMessage?: string;
  inputAttachments?: Array<{
    id: string;
    fileName: string;
    byteCount: number;
  }>;
};

export type AssistantAgentSession = {
  turns: AssistantTurn[];
  activeTurn: AssistantTurn | null;
  availability: AgentHostAvailability;
  hostStatus: AgentHostStatus | null;
  hostError: string | null;
  contextMetrics: AgentContextMetrics | null;
  isBusy: boolean;
  startTurn: (request: AssistantAgentStartTurnRequest) => Promise<void>;
  answerClarification: (
    turnId: string,
    clarificationId: string,
    answers: Record<string, string>,
    contextFingerprint: string,
  ) => Promise<void>;
  decideApproval: (
    turnId: string,
    approvalId: string,
    decision: AgentApprovalDecision,
    contextFingerprint: string,
  ) => Promise<void>;
  cancelTurn: (turnId: string) => Promise<void>;
  resumeTurn: (turnId: string, contextFingerprint: string) => Promise<void>;
  keepFileChange: (
    turnId: string,
    callId: string,
  ) => void;
  undoFileChange: (
    turnId: string,
    callId: string,
    expectedRoot?: string | null,
  ) => Promise<void>;
  keepFileChangeHunk: (
    turnId: string,
    callId: string,
    hunk: LineDiffHunk,
  ) => void;
  undoFileChangeHunk: (
    turnId: string,
    callId: string,
    hunk: LineDiffHunk,
    expectedRoot?: string | null,
  ) => Promise<void>;
  clear: () => void;
  refreshStatus: () => Promise<void>;
};

export function useAssistantAgentSession(
  projectId: string,
  providerConfigured = false,
): AssistantAgentSession {
  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const [availability, setAvailability] =
    useState<AgentHostAvailability>("checking");
  const [hostStatus, setHostStatus] = useState<AgentHostStatus | null>(null);
  const [hostError, setHostError] = useState<string | null>(null);
  const [contextMetrics, setContextMetrics] =
    useState<AgentContextMetrics | null>(null);
  const projectIdRef = useRef(projectId);
  const providerConfiguredRef = useRef(providerConfigured);
  const turnsRef = useRef<AssistantTurn[]>([]);
  const threadIdRef = useRef(createAgentId(`thread:${projectId}`));
  const resumeRequestsRef = useRef(new Map<string, AgentStartTurnRequest>());
  const hydratedProjectRef = useRef<string | null>(null);
  const persistTimerRef = useRef<number | null>(null);
  const fileProposalWritesRef = useRef(new Set<string>());

  const mutateTurns = useCallback(
    (update: (current: AssistantTurn[]) => AssistantTurn[]) => {
      setTurns((current) => {
        const next = update(current);
        turnsRef.current = next;
        return next;
      });
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
      const status = await agentHostService.getStatus(configured);
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

  useEffect(() => {
    const previousProjectId = projectIdRef.current;
    if (previousProjectId !== projectId) {
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
    threadIdRef.current = createAgentId(`thread:${projectId}`);
    hydratedProjectRef.current = null;
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    resumeRequestsRef.current.clear();
    turnsRef.current = [];
    setTurns([]);
    setHostError(null);
    setAvailability("checking");

    let disposed = false;
    let unlisten: (() => void) | undefined;
    void agentHostService
      .listen((event) => {
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
        mutateTurns((current) =>
          current.map((turn) =>
            turn.id === event.turnId &&
            (!turn.threadId || turn.threadId === event.threadId)
              ? reduceAgentHostEvent(turn, event)
              : turn,
          ),
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
      .loadConversationSnapshot(projectId)
      .then((snapshot) => {
        if (disposed || projectIdRef.current !== projectId) return;
        const restoredTurns = restoreConversationTurns(snapshot?.turns);
        const restoredRequests = restoreConversationRequests(
          snapshot?.resumeRequests,
        );
        const requestByTurn = new Map(
          restoredRequests.map((request) => [request.turnId, request]),
        );
        const resumableTurns = restoredTurns.map((turn) => {
          if (!assistantTurnIsActive(turn)) return turn;
          const canResume = requestByTurn.has(turn.id);
          return {
            ...turn,
            status: "paused" as const,
            error: canResume
              ? "OxideStudio restarted while this task was running. Resume from its encrypted checkpoint when you are ready."
              : "OxideStudio restarted while this task was running. Start the request again to continue safely.",
            errorDetail: null,
            updatedAt: Date.now(),
          };
        });
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
        turnsRef.current = mergedTurns;
        setTurns(turnsRef.current);
        hydratedProjectRef.current = projectId;
      })
      .catch((error) => {
        if (disposed || projectIdRef.current !== projectId) return;
        console.warn("Failed to restore encrypted AI conversation", error);
        hydratedProjectRef.current = projectId;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [handleCommandError, mutateTurns, projectId, refreshStatus]);

  useEffect(() => {
    if (hydratedProjectRef.current !== projectId) return;
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current);
    }
    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null;
      if (hydratedProjectRef.current !== projectId) return;
      const persistedTurns = turnsRef.current.slice(-100);
      const resumableTurnIds = new Set(
        persistedTurns
          .filter(
            (turn) => assistantTurnIsActive(turn) || turn.status === "paused",
          )
          .map((turn) => turn.id),
      );
      const resumeRequests = Array.from(resumeRequestsRef.current.entries())
        .filter(([turnId]) => resumableTurnIds.has(turnId))
        .map(([, request]) => request)
        .slice(-8);
      void agentHostService
        .saveConversationSnapshot({
          projectId,
          threadId: threadIdRef.current,
          turns: persistedTurns,
          resumeRequests,
        })
        .catch((error) => {
          console.warn("Failed to persist encrypted AI conversation", error);
        });
    }, 250);
    return () => {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, [projectId, turns]);

  useEffect(() => {
    void refreshStatus();
  }, [providerConfigured, refreshStatus]);

  useEffect(() => {
    let disposed = false;
    setContextMetrics(null);
    if (!projectId.trim()) return;
    void agentHostService
      .getContextMetrics(projectId)
      .then((metrics) => {
        if (!disposed && metrics.projectId === projectId) {
          setContextMetrics((current) =>
            newerContextMetrics(current, metrics),
          );
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
      const turn = turnsRef.current.find((candidate) => candidate.id === turnId);
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
    ) => {
      const turn = turnsRef.current.find((candidate) => candidate.id === turnId);
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
      const turn = turnsRef.current.find((candidate) => candidate.id === turnId);
      const source = resumeRequestsRef.current.get(turnId);
      if (!turn?.threadId || !source || !assistantTurnIsActive(turn)) return;
      updateTurn(turnId, (current) => ({
        ...current,
        status: "cancelling",
        updatedAt: Date.now(),
      }));
      try {
        const acknowledgement = await agentHostService.cancelTurn(
          requestMetadata(turn, source.contextVersion, source.provider.timeoutMs),
        );
        if (!acknowledgement.accepted) {
          throw new Error("Agent Host rejected cancellation.");
        }
      } catch (error) {
        handleCommandError(error, turnId, true);
      }
    },
    [handleCommandError, updateTurn],
  );

  const resumeTurn = useCallback(
    async (turnId: string, _contextFingerprint: string) => {
      const turn = turnsRef.current.find((candidate) => candidate.id === turnId);
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
        const handle = await agentHostService.resumeTurn(request);
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

  const updateFileProposal = useCallback(
    (
      turnId: string,
      callId: string,
      update: (proposal: AssistantProjectFileProposal) => AssistantProjectFileProposal,
    ) => {
      updateTurn(turnId, (turn) => ({
        ...turn,
        fileProposals: (turn.fileProposals ?? []).map((proposal) =>
          proposal.callId === callId ? update(proposal) : proposal,
        ),
        updatedAt: Date.now(),
      }));
    },
    [updateTurn],
  );

  const writeReviewedFileContent = useCallback(
    async (
      turnId: string,
      callId: string,
      content: string,
      expectedRoot?: string | null,
    ): Promise<ProjectFileWriteResult | null> => {
      const turn = turnsRef.current.find((candidate) => candidate.id === turnId);
      const proposal = turn?.fileProposals?.find(
        (candidate) => candidate.callId === callId,
      );
      if (!turn || !proposal || proposal.status !== "pending") {
        throw new Error("This file change is no longer pending review.");
      }
      if (!expectedRoot) {
        throw new Error("The active project directory is unavailable.");
      }
      const writeKey = `${turnId}:${callId}`;
      if (fileProposalWritesRef.current.has(writeKey)) {
        throw new Error("This file change is already being updated.");
      }
      fileProposalWritesRef.current.add(writeKey);

      updateFileProposal(turnId, callId, (current) => ({
        ...current,
        isApplying: true,
        error: null,
      }));
      try {
        if (!proposal.baseRevision) {
          throw new Error("The applied file revision is unavailable for undo.");
        }
        const deleteCreatedFile =
          proposal.operation === "created" &&
          proposal.createdFileCanBeDeleted !== false &&
          content === proposal.originalContent;
        const result = deleteCreatedFile
          ? await projectFilesService
              .deleteProjectFileIfRevision(
                turn.projectId,
                proposal.relativePath,
                proposal.baseRevision,
                expectedRoot,
              )
              .then(() => null)
          : await projectFilesService.writeProjectFile(
              turn.projectId,
              proposal.relativePath,
              content,
              proposal.baseRevision,
              expectedRoot,
            );
        const tabs = useTabStore.getState();
        const openTab = tabs.tabs.find(
          (tab) =>
            !tab.agentFileDiffPreview &&
            tab.fileProjectId === turn.projectId &&
            tab.fileRelativePath === proposal.relativePath,
        );
        if (openTab && !openTab.isDirty) {
          if (result) {
            tabs.updateTabSql(openTab.id, content);
            tabs.markProjectFileSaved(openTab.id, result.revision, content);
          } else {
            tabs.closeTab(openTab.id);
          }
        }
        useProjectFilesStore.getState().syncActiveProject();
        void useProjectFilesStore
          .getState()
          .refreshDirectory(parentProjectPath(proposal.relativePath))
          .catch(() => undefined);
        fileProposalWritesRef.current.delete(writeKey);
        return result;
      } catch (error) {
        fileProposalWritesRef.current.delete(writeKey);
        const message = fileReviewError(error);
        updateFileProposal(turnId, callId, (current) => ({
          ...current,
          isApplying: false,
          error: message,
        }));
        throw new Error(message);
      }
    },
    [updateFileProposal],
  );

  const keepFileChange = useCallback(
    (turnId: string, callId: string) => {
      updateFileProposal(turnId, callId, (proposal) => ({
        ...proposal,
        status: "accepted",
        isApplying: false,
        error: null,
        resolvedAt: Date.now(),
      }));
    },
    [updateFileProposal],
  );

  const undoFileChange = useCallback(
    async (
      turnId: string,
      callId: string,
      expectedRoot?: string | null,
    ) => {
      const turn = turnsRef.current.find((candidate) => candidate.id === turnId);
      const proposal = turn?.fileProposals?.find(
        (candidate) => candidate.callId === callId,
      );
      if (!turn || !proposal || proposal.status !== "pending") return;
      const result = await writeReviewedFileContent(
        turnId,
        callId,
        proposal.originalContent,
        expectedRoot,
      );
      const sourceCallIds = new Set(proposal.sourceCallIds ?? [proposal.callId]);
      const partiallyKept = proposal.keptChanges === true;
      updateTurn(turnId, (current) => ({
        ...current,
        fileProposals: (current.fileProposals ?? []).map((candidate) =>
          candidate.callId === callId
            ? {
                ...candidate,
                baseRevision: result?.revision ?? candidate.baseRevision,
                status: partiallyKept ? ("mixed" as const) : ("rejected" as const),
                isApplying: false,
                error: null,
                resolvedAt: Date.now(),
              }
            : candidate,
        ),
        fileChanges: partiallyKept
          ? updateReviewedFileAttribution(
              current.fileChanges,
              proposal,
              result,
            )
          : (current.fileChanges ?? []).filter(
              (change) => !sourceCallIds.has(change.callId),
            ),
        updatedAt: Date.now(),
      }));
    },
    [updateTurn, writeReviewedFileContent],
  );

  const keepFileChangeHunk = useCallback(
    (turnId: string, callId: string, hunk: LineDiffHunk) => {
      updateFileProposal(turnId, callId, (proposal) => {
        const originalContent = applyLineDiffHunk(
          proposal.originalContent,
          proposal.proposedContent,
          hunk,
          "accept",
        );
        const counts = lineDiffCounts(originalContent, proposal.proposedContent);
        const completed = counts.additions === 0 && counts.deletions === 0;
        return {
          ...proposal,
          originalContent,
          keptChanges: true,
          createdFileCanBeDeleted:
            proposal.operation === "created"
              ? false
              : proposal.createdFileCanBeDeleted,
          additions: counts.additions,
          deletions: counts.deletions,
          status: completed ? "accepted" : proposal.status,
          isApplying: false,
          error: null,
          resolvedAt: completed ? Date.now() : null,
        };
      });
    },
    [updateFileProposal],
  );

  const undoFileChangeHunk = useCallback(
    async (
      turnId: string,
      callId: string,
      hunk: LineDiffHunk,
      expectedRoot?: string | null,
    ) => {
      const turn = turnsRef.current.find((candidate) => candidate.id === turnId);
      const proposal = turn?.fileProposals?.find(
        (candidate) => candidate.callId === callId,
      );
      if (!turn || !proposal || proposal.status !== "pending") return;
      const nextContent = applyLineDiffHunk(
        proposal.originalContent,
        proposal.proposedContent,
        hunk,
        "reject",
      );
      const result = await writeReviewedFileContent(
        turnId,
        callId,
        nextContent,
        expectedRoot,
      );
      const counts = lineDiffCounts(proposal.originalContent, nextContent);
      const completed = counts.additions === 0 && counts.deletions === 0;
      const sourceCallIds = new Set(proposal.sourceCallIds ?? [proposal.callId]);
      const partiallyKept = proposal.keptChanges === true;
      updateTurn(turnId, (current) => ({
        ...current,
        fileProposals: (current.fileProposals ?? []).map((candidate) =>
          candidate.callId === callId
            ? {
                ...candidate,
                proposedContent: nextContent,
                proposedRevision: result?.revision ?? candidate.proposedRevision,
                baseRevision: result?.revision ?? candidate.baseRevision,
                additions: counts.additions,
                deletions: counts.deletions,
                status: completed
                  ? partiallyKept
                    ? ("mixed" as const)
                    : ("rejected" as const)
                  : candidate.status,
                isApplying: false,
                error: null,
                resolvedAt: completed ? Date.now() : null,
              }
            : candidate,
        ),
        fileChanges: completed && !partiallyKept
          ? (current.fileChanges ?? []).filter(
              (change) => !sourceCallIds.has(change.callId),
            )
          : updateReviewedFileAttribution(
              current.fileChanges,
              proposal,
              result,
            ),
        updatedAt: Date.now(),
      }));
    },
    [updateTurn, writeReviewedFileContent],
  );

  const activeTurn = useMemo(
    () => [...turns].reverse().find(assistantTurnIsActive) ?? null,
    [turns],
  );
  const clear = useCallback(() => {
    if (turnsRef.current.some(assistantTurnIsActive)) return;
    turnsRef.current = [];
    setTurns([]);
    resumeRequestsRef.current.clear();
    threadIdRef.current = createAgentId(`thread:${projectIdRef.current}`);
    setHostError(null);
  }, []);

  return {
    turns,
    activeTurn,
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
    refreshStatus,
  };
}

export function reduceAgentHostEvent(
  turn: AssistantTurn,
  event: AgentHostEvent,
): AssistantTurn {
  if (
    turn.lastEventSequence !== undefined &&
    event.sequence <= turn.lastEventSequence
  ) {
    return turn;
  }
  const common = {
    threadId: event.threadId,
    lastEventSequence: event.sequence,
    updatedAt: event.occurredAt,
  };

  switch (event.type) {
    case "turn.status":
      return reduceTurnStatus(turn, event, common);
    case "plan.changed":
      return {
        ...turn,
        ...common,
        status: event.items.some((item) => item.status === "running")
          ? "running"
          : turn.status,
        process: event.items.reduce(
          (process, item) =>
            upsertAssistantProcessItem(
              process,
              processItem(event, "step", {
                id: `plan:${item.id}`,
                title: item.title,
                status: item.status,
              }),
            ),
          turn.process,
        ),
      };
    case "tool.started":
    case "tool.finished": {
      const status: AssistantProcessStatus =
        event.type === "tool.started"
          ? "running"
          : event.success === false
            ? "failed"
            : "completed";
      const process =
        event.type === "tool.started" &&
        !hasRecentProcessDescription(turn.process, event.occurredAt)
          ? upsertAssistantProcessItem(
              turn.process,
              processItem(event, "commentary", {
                id: `commentary:tool:${event.callId}`,
                title: fallbackToolPhaseDescription(
                  event.toolName,
                  event.label || event.toolName,
                ),
                status: "completed",
              }),
            )
          : turn.process;
      return {
        ...turn,
        ...common,
        status: event.type === "tool.started" ? "running" : turn.status,
        process: upsertAssistantProcessItem(
          process,
          processItem(event, "tool", {
            id: `tool:${event.callId}`,
            title: event.label || event.toolName,
            detail: event.detail,
            toolName: event.toolName,
            relativePath: event.relativePath,
            status,
          }),
        ),
      };
    }
    case "file.changed":
      return {
        ...turn,
        ...common,
        process: turn.process.map((item) =>
          item.id === `tool:${event.callId}` || item.id === event.callId
            ? {
                ...item,
                relativePath: event.relativePath,
                additions: event.additions,
                deletions: event.deletions,
              }
            : item,
        ),
        fileChanges: upsertProjectFileChange(turn.fileChanges, {
          callId: event.callId,
          relativePath: event.relativePath,
          operation: event.operation,
          revision: event.revision,
          previousRevision: event.previousRevision,
          introducedLines: event.introducedLines,
          lineEvidenceTruncated: event.lineEvidenceTruncated,
          additions: event.additions,
          deletions: event.deletions,
          occurredAt: event.occurredAt,
        }),
        fileProposals:
          event.reviewable === true &&
          typeof event.originalContent === "string" &&
          typeof event.appliedContent === "string" &&
          typeof event.additions === "number" &&
          typeof event.deletions === "number"
            ? upsertAppliedFileReview(turn.fileProposals, {
                callId: event.callId,
                sourceCallIds: [event.callId],
                relativePath: event.relativePath,
                operation: event.operation,
                proposedRevision: event.revision,
                baseRevision: event.revision,
                originalContent: event.originalContent,
                proposedContent: event.appliedContent,
                additions: event.additions,
                deletions: event.deletions,
                status: "pending",
                keptChanges: false,
                createdFileCanBeDeleted: event.operation === "created",
                appliedImmediately: true,
                error: null,
                occurredAt: event.occurredAt,
              })
            : turn.fileProposals,
      };
    case "file.proposed":
      return {
        ...turn,
        ...common,
        fileProposals: upsertProjectFileProposal(turn.fileProposals, {
          callId: event.callId,
          relativePath: event.relativePath,
          operation: event.operation,
          proposedRevision: event.proposedRevision,
          baseRevision: event.baseRevision,
          originalContent: event.originalContent,
          proposedContent: event.proposedContent,
          additions: event.additions,
          deletions: event.deletions,
          status: "rejected",
          appliedImmediately: false,
          error: "This legacy proposal was not applied to disk and cannot be reviewed as an immediate Agent edit.",
          occurredAt: event.occurredAt,
        }),
      };
    case "subagent":
      return {
        ...turn,
        ...common,
        status: event.status === "started" ? "running" : turn.status,
        process: upsertAssistantProcessItem(
          turn.process,
          processItem(event, "step", {
            id: `subagent:${event.name}`,
            title: event.name,
            detail: event.detail,
            status:
              event.status === "started"
                ? "running"
                : event.status === "failed"
                  ? "failed"
                  : "completed",
          }),
        ),
      };
    case "clarification":
      return {
        ...turn,
        ...common,
        status: "awaiting_input",
        clarifications: event.questions.reduce(
          (clarifications, question) =>
            upsertClarification(clarifications, {
              clarificationId: event.clarificationId,
              questionId: question.id,
              question: question.prompt,
              context: event.context,
              options: question.options.map((option) => ({
                ...option,
                value: option.id,
              })),
              allowFreeText: question.allowFreeText,
            }),
          turn.clarifications,
        ),
      };
    case "approval":
      return {
        ...turn,
        ...common,
        status: "awaiting_approval",
        approvals: upsertApproval(turn.approvals, {
          approvalId: event.approvalId,
          callId: event.callId,
          title: event.title,
          summary: event.summary,
          toolName: event.toolName,
          risk: event.risk,
          inputDigest: event.inputDigest,
        }),
      };
    case "context.compacted":
      return {
        ...turn,
        ...common,
        contextCompaction: {
          count: (turn.contextCompaction?.count ?? 0) + 1,
          lastInputTokens: event.inputTokens,
          lastRetainedTokens: event.retainedTokens,
          offloadedArtifacts:
            (turn.contextCompaction?.offloadedArtifacts ?? 0) +
            event.offloadedArtifacts,
        },
        process: upsertAssistantProcessItem(
          turn.process,
          processItem(event, "compaction", {
            id: `compaction:${event.sequence}`,
            title: "Compacted conversation context",
            detail: `${event.inputTokens} input tokens → ${event.retainedTokens} retained · ${event.offloadedArtifacts} artifacts offloaded`,
            status: "completed",
          }),
        ),
      };
    case "model.usage":
      return {
        ...turn,
        ...common,
        modelUsage: {
          calls: (turn.modelUsage?.calls ?? 0) + event.calls,
          inputTokens:
            (turn.modelUsage?.inputTokens ?? 0) + event.inputTokens,
          outputTokens:
            (turn.modelUsage?.outputTokens ?? 0) + event.outputTokens,
          totalTokens:
            (turn.modelUsage?.totalTokens ?? 0) + event.totalTokens,
        },
      };
    case "answer.delta": {
      const visibleProgress = event.reset ? turn.draft.trim() : "";
      return {
        ...turn,
        ...common,
        status: "running",
        draft: event.reset ? event.content : `${turn.draft}${event.content}`,
        process: visibleProgress
          ? upsertAssistantProcessItem(
              turn.process,
              processItem(event, "commentary", {
                id: `commentary:${event.sequence}`,
                title: visibleProgressHeadline(visibleProgress),
                detail: visibleProgressDetail(visibleProgress),
                status: "completed",
              }),
            )
          : turn.process,
      };
    }
    case "final.answer":
      return {
        ...turn,
        ...common,
        draft: "",
        final: {
          content: event.content,
          attachments: [],
          artifactRefs: event.artifacts,
          citations: event.citations ?? [],
          createdAt: event.occurredAt,
        },
      };
    case "failure": {
      const presentation = presentAssistantError({
        code: event.code,
        message: event.message,
        retryable: event.retryable,
      });
      return {
        ...turn,
        ...common,
        status: event.retryable ? "paused" : "failed",
        error: presentation.message,
        errorDetail: presentation.detail,
        process: finishRunningProcess(
          turn.process,
          "failed",
          event.occurredAt,
        ),
      };
    }
  }
}

function hasRecentProcessDescription(
  process: readonly AssistantProcessItem[],
  occurredAt: number,
) {
  const latest = [...process]
    .reverse()
    .find((item) => item.kind === "commentary");
  return Boolean(
    latest &&
      latest.startedAt <= occurredAt &&
      occurredAt - latest.startedAt <= 15_000,
  );
}

function fallbackToolPhaseDescription(toolName: string, label: string) {
  if (toolName === "project.listFiles") {
    return "I’ll review the project structure to locate the relevant files.";
  }
  if (toolName === "project.readFile") {
    return "I’ll read the relevant project file before deciding what needs to change.";
  }
  if (toolName === "project.writeFile") {
    return "I’ll update the requested project file and leave the change available for review or undo.";
  }
  if (toolName.startsWith("metadata.")) {
    return "I’ll inspect the relevant database metadata before continuing.";
  }
  if (toolName.startsWith("query.")) {
    return "I’ll check the query with a bounded, read-only database operation.";
  }
  if (toolName.startsWith("lsp.")) {
    return "I’ll inspect the editor diagnostics before proposing the next change.";
  }
  if (toolName.startsWith("editor.")) {
    return "I’ll prepare a reviewable editor change without applying it automatically.";
  }
  return `I’ll ${label.toLocaleLowerCase()} for this stage.`;
}

function reduceTurnStatus(
  turn: AssistantTurn,
  event: Extract<AgentHostEvent, { type: "turn.status" }>,
  common: Pick<AssistantTurn, "threadId" | "lastEventSequence" | "updatedAt">,
): AssistantTurn {
  const status =
    event.status === "failed" && turn.status === "paused"
      ? "paused"
      : turnStatus(event.status);
  let process = turn.process;
  if (event.status === "starting" || event.status === "planning") {
    process = upsertAssistantProcessItem(
      process,
      processItem(event, "planning", {
        id: "status:planning",
        title: event.label || "Preparing the response",
        status: "running",
      }),
    );
  } else if (event.status === "running") {
    process = finishProcessItem(process, "status:planning", event.occurredAt);
  } else if (["completed", "failed", "cancelled"].includes(event.status)) {
    process = finishRunningProcess(
      process,
      event.status === "completed"
        ? "completed"
        : event.status === "cancelled"
          ? "cancelled"
          : "failed",
      event.occurredAt,
    );
  }
  return {
    ...turn,
    ...common,
    status,
    process,
    error:
      event.status === "failed"
        ? turn.error || event.label || "The assistant could not complete this task."
        : event.status === "completed"
          ? null
          : turn.error,
    errorDetail: event.status === "completed" ? null : turn.errorDetail,
  };
}

function turnStatus(
  status: Extract<AgentHostEvent, { type: "turn.status" }>["status"],
): AssistantTurnStatus {
  if (status === "starting" || status === "planning") return "planning";
  return status;
}

function processItem(
  event: AgentHostEvent,
  kind: AssistantProcessItem["kind"],
  item: Omit<AssistantProcessItem, "kind" | "sequence" | "startedAt">,
): AssistantProcessItem {
  return {
    ...item,
    kind,
    sequence: event.sequence,
    startedAt: event.occurredAt,
    finishedAt:
      item.status === "running" || item.status === "pending"
        ? null
        : event.occurredAt,
  };
}

function finishProcessItem(
  process: readonly AssistantProcessItem[],
  id: string,
  finishedAt: number,
) {
  return process.map((item) =>
    item.id === id && item.status === "running"
      ? { ...item, status: "completed" as const, finishedAt }
      : item,
  );
}

function finishRunningProcess(
  process: readonly AssistantProcessItem[],
  status: Exclude<AssistantProcessStatus, "pending" | "running">,
  finishedAt: number,
) {
  return process.map((item) =>
    item.status === "running" ? { ...item, status, finishedAt } : item,
  );
}

function upsertClarification(
  clarifications: readonly AssistantClarification[],
  clarification: AssistantClarification,
) {
  const key = clarificationKey(clarification);
  const exists = clarifications.some(
    (candidate) => clarificationKey(candidate) === key,
  );
  return exists
    ? clarifications.map((candidate) =>
        clarificationKey(candidate) === key
          ? {
              ...candidate,
              ...clarification,
              answer: candidate.answer,
              answeredAt: candidate.answeredAt,
            }
          : candidate,
      )
    : [...clarifications, clarification];
}

function clarificationKey(clarification: AssistantClarification) {
  return `${clarification.clarificationId}:${clarification.questionId}`;
}

function upsertApproval(
  approvals: readonly AssistantApproval[],
  approval: AssistantApproval,
) {
  const exists = approvals.some(
    (candidate) => candidate.approvalId === approval.approvalId,
  );
  return exists
    ? approvals.map((candidate) =>
        candidate.approvalId === approval.approvalId
          ? {
              ...candidate,
              ...approval,
              decision: candidate.decision,
              decidedAt: candidate.decidedAt,
            }
          : candidate,
      )
    : [...approvals, approval];
}

function upsertProjectFileChange(
  changes: AssistantTurn["fileChanges"],
  change: NonNullable<AssistantTurn["fileChanges"]>[number],
) {
  const current = changes ?? [];
  const withoutDuplicate = current.filter(
    (candidate) => candidate.callId !== change.callId,
  );
  return [...withoutDuplicate, change].slice(-128);
}

function upsertProjectFileProposal(
  proposals: AssistantTurn["fileProposals"],
  proposal: NonNullable<AssistantTurn["fileProposals"]>[number],
) {
  const current = proposals ?? [];
  const withoutDuplicate = current.filter(
    (candidate) => candidate.callId !== proposal.callId,
  );
  return [...withoutDuplicate, proposal].slice(-128);
}

function upsertAppliedFileReview(
  proposals: AssistantTurn["fileProposals"],
  review: NonNullable<AssistantTurn["fileProposals"]>[number],
) {
  const current = proposals ?? [];
  const previous = [...current]
    .reverse()
    .find(
      (candidate) =>
        candidate.status === "pending" &&
        candidate.relativePath === review.relativePath,
    );
  if (!previous || previous.proposedContent !== review.originalContent) {
    return upsertProjectFileProposal(current, review);
  }
  const counts = lineDiffCounts(
    previous.originalContent,
    review.proposedContent,
  );
  return current.map((candidate) =>
    candidate.callId === previous.callId
      ? {
          ...review,
          callId: previous.callId,
          sourceCallIds: Array.from(
            new Set([
              ...(previous.sourceCallIds ?? [previous.callId]),
              ...((review.sourceCallIds ?? [review.callId])),
            ]),
          ),
          operation: previous.operation,
          originalContent: previous.originalContent,
          keptChanges: previous.keptChanges,
          createdFileCanBeDeleted: previous.createdFileCanBeDeleted,
          additions: counts.additions,
          deletions: counts.deletions,
        }
      : candidate,
  );
}

function updateReviewedFileAttribution(
  changes: AssistantTurn["fileChanges"],
  proposal: AssistantProjectFileProposal,
  result: ProjectFileWriteResult | null,
) {
  if (!result) return changes ?? [];
  const sourceCallIds = new Set(proposal.sourceCallIds ?? [proposal.callId]);
  const remaining = (changes ?? []).filter(
    (change) => !sourceCallIds.has(change.callId),
  );
  return upsertProjectFileChange(remaining, {
    callId: proposal.callId,
    relativePath: proposal.relativePath,
    operation: proposal.operation,
    revision: result.revision,
    previousRevision: result.previousRevision,
    occurredAt: Date.now(),
  });
}

function requestMetadata(
  turn: AssistantTurn,
  contextVersion: string,
  timeoutMs?: number,
): AgentRequestMetadata {
  if (!turn.threadId) {
    throw new Error("Agent turn has no thread identifier.");
  }
  return {
    requestId: createAgentId("request:command"),
    threadId: turn.threadId,
    turnId: turn.id,
    contextVersion: contextVersion || "context:unknown",
    deadline: commandDeadline(timeoutMs),
  };
}

function commandDeadline(timeoutMs?: number) {
  const turnBudget = Math.max(
    DEFAULT_TURN_TIMEOUT_MS,
    Math.max(timeoutMs ?? 0, 30_000) * 20,
  );
  return Date.now() + Math.min(turnBudget, MAX_TURN_TIMEOUT_MS);
}

function nextProcessSequence(process: readonly AssistantProcessItem[]) {
  return process.reduce(
    (sequence, item) => Math.max(sequence, item.sequence),
    0,
  ) + 1;
}

function clarificationAnswerLabel(clarification: AssistantClarification) {
  const answer = clarification.answer?.trim() ?? "";
  const option = clarification.options.find(
    (candidate) => (candidate.value || candidate.label) === answer,
  );
  return option?.label ?? answer;
}

function visibleProgressHeadline(content: string) {
  const normalized = content.replace(/\s+/gu, " ").trim();
  if (normalized.length <= 120) return normalized;
  return `${normalized.slice(0, 117).trimEnd()}...`;
}

function visibleProgressDetail(content: string) {
  const normalized = content.trim();
  const headline = visibleProgressHeadline(normalized);
  if (normalized === headline) return null;
  if (normalized.length <= 2_000) return normalized;
  return `${normalized.slice(0, 1_997).trimEnd()}...`;
}

function createAgentId(prefix: string) {
  const suffix = globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}:${suffix}`;
}

function newerContextMetrics(
  current: AgentContextMetrics | null,
  candidate: AgentContextMetrics,
) {
  if (!current || candidate.updatedAt > current.updatedAt) return candidate;
  if (candidate.updatedAt < current.updatedAt) return current;
  return contextMetricsScore(candidate) >= contextMetricsScore(current)
    ? candidate
    : current;
}

function contextMetricsScore(metrics: AgentContextMetrics) {
  return (
    (metrics.compaction?.count ?? 0) +
    (metrics.compaction?.offloadedArtifacts ?? 0) +
    (metrics.modelUsage?.calls ?? 0) +
    (metrics.modelUsage?.totalTokens ?? 0)
  );
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Agent Host command failed.";
}

function fileReviewError(error: unknown) {
  if (isProjectFileRevisionConflict(error)) {
    return "This file changed after the Agent edit, so OxideStudio did not undo it. Review the current file and retry from a fresh diff.";
  }
  return errorMessage(error);
}

function parentProjectPath(relativePath: string) {
  const separator = relativePath.lastIndexOf("/");
  return separator < 0 ? "" : relativePath.slice(0, separator);
}

function syncAppliedProjectFile(
  projectId: string,
  relativePath: string,
  content: string,
  revision: string,
) {
  const tabs = useTabStore.getState();
  const openTab = tabs.tabs.find(
    (tab) =>
      !tab.agentFileDiffPreview &&
      tab.fileProjectId === projectId &&
      tab.fileRelativePath === relativePath,
  );
  if (openTab && !openTab.isDirty) {
    tabs.updateTabSql(openTab.id, content);
    tabs.markProjectFileSaved(openTab.id, revision, content);
  }
  useProjectFilesStore.getState().syncActiveProject();
  void useProjectFilesStore
    .getState()
    .refreshDirectory(parentProjectPath(relativePath))
    .catch(() => undefined);
}

function restoreConversationTurns(value: unknown): AssistantTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((candidate): candidate is AssistantTurn => {
      if (!candidate || typeof candidate !== "object") return false;
      const turn = candidate as Partial<AssistantTurn>;
      return (
        typeof turn.id === "string" &&
        typeof turn.projectId === "string" &&
        typeof turn.userMessage === "string" &&
        typeof turn.status === "string" &&
        Array.isArray(turn.process) &&
        Array.isArray(turn.approvals) &&
        Array.isArray(turn.clarifications)
      );
    })
    .map((turn) => ({
      ...turn,
      draft: typeof turn.draft === "string" ? turn.draft : "",
      error:
        typeof turn.error === "string" || turn.error === null
          ? turn.error
          : null,
      errorDetail:
        typeof turn.errorDetail === "string" || turn.errorDetail === null
          ? turn.errorDetail
          : null,
      final: restoreAssistantFinal(turn.final, turn.updatedAt),
      fileChanges: restoreProjectFileChanges(turn.fileChanges),
      fileProposals: restoreProjectFileProposals(turn.fileProposals),
    }))
    .slice(-100);
}

function restoreAssistantFinal(
  value: unknown,
  fallbackCreatedAt: number,
): AssistantTurn["final"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const final = value as Record<string, unknown>;
  const artifactRefs = Array.isArray(final.artifactRefs)
    ? final.artifactRefs
        .filter(
          (reference): reference is string =>
            typeof reference === "string" && reference.length <= 2_000,
        )
        .slice(0, 128)
    : [];
  return {
    content: typeof final.content === "string" ? final.content : "",
    attachments: Array.isArray(final.attachments)
      ? final.attachments.filter(isRestoredAssistantAttachment).slice(0, 32)
      : [],
    ...(artifactRefs.length > 0 ? { artifactRefs } : {}),
    citations: Array.isArray(final.citations)
      ? final.citations.filter(isAgentCitation).slice(0, 8)
      : [],
    createdAt:
      typeof final.createdAt === "number" && Number.isFinite(final.createdAt)
        ? final.createdAt
        : Number.isFinite(fallbackCreatedAt)
          ? fallbackCreatedAt
          : Date.now(),
  };
}

function isRestoredAssistantAttachment(
  value: unknown,
): value is NonNullable<AssistantTurn["final"]>["attachments"][number] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const attachment = value as Record<string, unknown>;
  return (
    typeof attachment.id === "string" &&
    typeof attachment.kind === "string" &&
    typeof attachment.label === "string" &&
    isRestoredUiAction(attachment.action) &&
    (attachment.secondaryActions === undefined ||
      (Array.isArray(attachment.secondaryActions) &&
        attachment.secondaryActions.every(isRestoredUiAction)))
  );
}

function isRestoredUiAction(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const action = value as Record<string, unknown>;
  const target = action.target;
  const issuedAgainst = action.issuedAgainst;
  const presentation = action.presentation;
  return (
    typeof action.id === "string" &&
    typeof action.action === "string" &&
    Boolean(target && typeof target === "object" && !Array.isArray(target)) &&
    Boolean(
      issuedAgainst &&
        typeof issuedAgainst === "object" &&
        !Array.isArray(issuedAgainst),
    ) &&
    Boolean(
      presentation &&
        typeof presentation === "object" &&
        !Array.isArray(presentation) &&
        typeof (presentation as Record<string, unknown>).label === "string",
    )
  );
}

function restoreProjectFileChanges(
  value: unknown,
): NonNullable<AssistantTurn["fileChanges"]> {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (
        candidate,
      ): candidate is NonNullable<AssistantTurn["fileChanges"]>[number] => {
        if (!candidate || typeof candidate !== "object") return false;
        const change = candidate as Record<string, unknown>;
        return (
          typeof change.callId === "string" &&
          safeRestoredProjectPath(change.relativePath) &&
          (change.operation === "created" || change.operation === "updated") &&
          typeof change.revision === "string" &&
          /^[a-f0-9]{64}$/u.test(change.revision) &&
          (change.previousRevision === undefined ||
            change.previousRevision === null ||
            (typeof change.previousRevision === "string" &&
              /^[a-f0-9]{64}$/u.test(change.previousRevision))) &&
          (change.introducedLines === undefined ||
            (Array.isArray(change.introducedLines) &&
              change.introducedLines.length <= 2_048 &&
              change.introducedLines.every(
                (line, index, lines) =>
                  Number.isInteger(line) &&
                  Number(line) > 0 &&
                  (index === 0 || Number(line) > Number(lines[index - 1])),
              ))) &&
          (change.lineEvidenceTruncated === undefined ||
            typeof change.lineEvidenceTruncated === "boolean") &&
          (change.additions === undefined ||
            (typeof change.additions === "number" &&
              Number.isInteger(change.additions) &&
              change.additions >= 0)) &&
          (change.deletions === undefined ||
            (typeof change.deletions === "number" &&
              Number.isInteger(change.deletions) &&
              change.deletions >= 0)) &&
          typeof change.occurredAt === "number" &&
          Number.isFinite(change.occurredAt)
        );
      },
    )
    .slice(-128);
}

function restoreProjectFileProposals(
  value: unknown,
): NonNullable<AssistantTurn["fileProposals"]> {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (
        candidate,
      ): candidate is NonNullable<AssistantTurn["fileProposals"]>[number] => {
        if (!candidate || typeof candidate !== "object") return false;
        const proposal = candidate as Record<string, unknown>;
        return (
          typeof proposal.callId === "string" &&
          (proposal.sourceCallIds === undefined ||
            (Array.isArray(proposal.sourceCallIds) &&
              proposal.sourceCallIds.length <= 128 &&
              proposal.sourceCallIds.every(
                (callId) => typeof callId === "string" && callId.length > 0,
              ))) &&
          safeRestoredProjectPath(proposal.relativePath) &&
          (proposal.operation === "created" ||
            proposal.operation === "updated") &&
          typeof proposal.proposedRevision === "string" &&
          /^[a-f0-9]{64}$/u.test(proposal.proposedRevision) &&
          (proposal.baseRevision === undefined ||
            proposal.baseRevision === null ||
            (typeof proposal.baseRevision === "string" &&
              /^[a-f0-9]{64}$/u.test(proposal.baseRevision))) &&
          typeof proposal.originalContent === "string" &&
          proposal.originalContent.length <= 256 * 1024 &&
          typeof proposal.proposedContent === "string" &&
          proposal.proposedContent.length <= 256 * 1024 &&
          typeof proposal.additions === "number" &&
          Number.isInteger(proposal.additions) &&
          proposal.additions >= 0 &&
          typeof proposal.deletions === "number" &&
          Number.isInteger(proposal.deletions) &&
          proposal.deletions >= 0 &&
          (proposal.status === "pending" ||
            proposal.status === "accepted" ||
            proposal.status === "rejected" ||
            proposal.status === "mixed") &&
          (proposal.keptChanges === undefined ||
            typeof proposal.keptChanges === "boolean") &&
          (proposal.createdFileCanBeDeleted === undefined ||
            typeof proposal.createdFileCanBeDeleted === "boolean") &&
          (proposal.appliedImmediately === undefined ||
            typeof proposal.appliedImmediately === "boolean") &&
          typeof proposal.occurredAt === "number" &&
          Number.isFinite(proposal.occurredAt)
        );
      },
    )
    .map((proposal) =>
      proposal.status === "pending" && proposal.appliedImmediately !== true
        ? {
            ...proposal,
            status: "rejected" as const,
            error:
              "This review was created by the previous proposal-only workflow and was not applied to disk.",
            resolvedAt: Date.now(),
          }
        : proposal,
    )
    .slice(-128);
}

function safeRestoredProjectPath(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 2_000) return false;
  if (value.includes("\0") || /^[\\/]/u.test(value) || /^[a-z]:/iu.test(value)) {
    return false;
  }
  return !value.split(/[\\/]/u).some((segment) => segment === "..");
}

function restoreConversationRequests(value: unknown): AgentStartTurnRequest[] {
  if (!Array.isArray(value)) return [];
  return value.filter((candidate): candidate is AgentStartTurnRequest => {
    if (!candidate || typeof candidate !== "object") return false;
    const request = candidate as Partial<AgentStartTurnRequest>;
    return (
      typeof request.requestId === "string" &&
      typeof request.threadId === "string" &&
      typeof request.turnId === "string" &&
      typeof request.projectId === "string" &&
      typeof request.prompt === "string" &&
      Boolean(request.provider) &&
      Boolean(request.workspace)
    );
  });
}
