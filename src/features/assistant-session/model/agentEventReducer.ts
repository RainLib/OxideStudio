import { presentAssistantError } from "@/ai/assistant/errorPresentation";
import {
  upsertAssistantProcessItem,
  type AssistantProcessStatus,
  type AssistantTurn,
} from "@/ai/assistant/turns";
import {
  upsertAppliedFileReview,
  upsertProjectFileChange,
  upsertProjectFileProposal,
} from "@/features/assistant-session/model/fileReviewState";
import {
  fallbackToolPhaseDescription,
  finishRunningProcess,
  hasRecentProcessDescription,
  processItem,
  reduceTurnStatus,
  upsertApproval,
  upsertClarification,
  visibleProgressDetail,
  visibleProgressHeadline,
} from "@/features/assistant-session/model/turnProgress";
import { type AgentHostEvent } from "@/services/tauri/agent-host.service";

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
          error:
            "This legacy proposal was not applied to disk and cannot be reviewed as an immediate Agent edit.",
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
          policyDigest: event.policyDigest,
          findings: event.findings,
          confirmation: event.confirmation,
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
          inputTokens: (turn.modelUsage?.inputTokens ?? 0) + event.inputTokens,
          outputTokens:
            (turn.modelUsage?.outputTokens ?? 0) + event.outputTokens,
          totalTokens: (turn.modelUsage?.totalTokens ?? 0) + event.totalTokens,
        },
      };
    case "provider.activity":
      return {
        ...turn,
        ...common,
        process: upsertAssistantProcessItem(
          turn.process,
          processItem(event, "commentary", {
            id: `provider:${event.provider}`,
            title: event.label,
            detail: event.detail,
            status:
              event.status === "error"
                ? "failed"
                : event.status === "completed"
                  ? "completed"
                  : "running",
          }),
        ),
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
        // The Host emits final.answer only after the provider execution has
        // completed. Treat it as a terminal fallback when the following
        // turn.status event is lost during an IPC or panel lifecycle race.
        status: "completed",
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
        process: finishRunningProcess(turn.process, "failed", event.occurredAt),
      };
    }
  }
}

export function applyBufferedAgentEvents(
  turns: AssistantTurn[],
  events: readonly AgentHostEvent[],
) {
  if (events.length === 0) return turns;
  const eventsByTurn = new Map<string, AgentHostEvent[]>();
  const eventsByTurnId = new Map<string, AgentHostEvent[]>();
  for (const event of events) {
    const key = `${event.threadId}\u0000${event.turnId}`;
    const grouped = eventsByTurn.get(key) ?? [];
    grouped.push(event);
    eventsByTurn.set(key, grouped);
    const byId = eventsByTurnId.get(event.turnId) ?? [];
    byId.push(event);
    eventsByTurnId.set(event.turnId, byId);
  }
  return turns.map((turn) =>
    applyTurnEvents(
      turn,
      turn.threadId
        ? (eventsByTurn.get(`${turn.threadId}\u0000${turn.id}`) ?? [])
        : (eventsByTurnId.get(turn.id) ?? []),
    ),
  );
}

export function applyTurnEvents(
  turn: AssistantTurn,
  events: readonly AgentHostEvent[],
) {
  return events.reduce(
    (current, event) =>
      current.id === event.turnId &&
      (!current.threadId || current.threadId === event.threadId)
        ? reduceAgentHostEvent(current, event)
        : current,
    turn,
  );
}

export function mergeAgentEvents(
  left: readonly AgentHostEvent[],
  right: readonly AgentHostEvent[],
) {
  const events = new Map<string, AgentHostEvent>();
  for (const event of [...left, ...right]) {
    events.set(
      `${event.threadId}\u0000${event.turnId}\u0000${event.sequence}`,
      event,
    );
  }
  return Array.from(events.values()).sort(
    (first, second) =>
      first.occurredAt - second.occurredAt || first.sequence - second.sequence,
  );
}
