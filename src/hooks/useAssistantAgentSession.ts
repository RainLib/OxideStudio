import {
  assistantTurnIsActive,
  createAssistantTurn,
  upsertAssistantProcessItem,
  type AssistantApproval,
  type AssistantClarification,
  type AssistantProcessItem,
  type AssistantProcessStatus,
  type AssistantTurn,
  type AssistantTurnStatus,
} from "@/ai/assistant/turns";
import type { AssistantMode } from "@/ai/assistant/modes";
import { presentAssistantError } from "@/ai/assistant/errorPresentation";
import {
  agentHostService,
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
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [handleCommandError, mutateTurns, projectId, refreshStatus]);

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
      const { requestedMode, contextVersion, deadline, provider, ...payload } =
        request;
      const threadId = threadIdRef.current;
      const turn: AssistantTurn = {
        ...createAssistantTurn({
          id: request.turnId,
          requestId: request.requestId,
          projectId: request.projectId,
          requestedMode,
          mode: request.profile,
          userMessage: request.prompt,
        }),
        threadId,
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
      contextFingerprint: string,
    ) => {
      const turn = turnsRef.current.find((candidate) => candidate.id === turnId);
      const approval = turn?.approvals.find(
        (candidate) => candidate.approvalId === approvalId,
      );
      if (!turn?.threadId || !approval || approval.decision) return;
      try {
        const acknowledgement = await agentHostService.approveAction({
          ...requestMetadata(turn, contextFingerprint),
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
      return {
        ...turn,
        ...common,
        status: event.type === "tool.started" ? "running" : turn.status,
        process: upsertAssistantProcessItem(
          turn.process,
          processItem(event, "tool", {
            id: `tool:${event.callId}`,
            title: event.label || event.toolName,
            detail: event.detail,
            toolName: event.toolName,
            status,
          }),
        ),
      };
    }
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
