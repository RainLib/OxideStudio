import type {
  AssistantPreparedTurn,
  AssistantToolLoopEvent,
  AssistantToolLoopResult,
} from "./types";
import type {
  AssistantTaskRecord,
  AssistantTaskStatus,
} from "@/services/tauri/assistant-task.service";

export function createAssistantTaskRecord(input: {
  projectId: string;
  sessionId: string;
  turn: AssistantPreparedTurn;
  now?: number;
}): AssistantTaskRecord {
  const now = input.now ?? Date.now();
  return {
    id: `agent:${input.turn.requestId}`,
    projectId: input.projectId,
    requestId: input.turn.requestId,
    sessionId: input.sessionId,
    status: "running",
    title: "Assistant agent task",
    detail: "Preparing tools",
    currentStepId: null,
    currentToolName: null,
    progress: taskProgress(0, input.turn.suggestedPlan.length),
    checkpoint: {
      version: 1,
      mode: "agent",
      plan: input.turn.suggestedPlan.slice(0, 100).map(safePlanStep),
      completedSteps: [],
    },
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
  };
}

export function reduceAssistantTaskEvent(
  task: AssistantTaskRecord,
  event: AssistantToolLoopEvent,
  now = Date.now(),
): AssistantTaskRecord {
  if (event.type === "stepStarted") {
    return {
      ...task,
      status: "running",
      detail: boundedText(event.step.title, 2_000),
      currentStepId: boundedText(event.step.id, 120),
      currentToolName: event.step.toolName
        ? boundedText(event.step.toolName, 200)
        : null,
      updatedAt: now,
      finishedAt: null,
    };
  }
  if (event.type === "stepCompleted") {
    const completedSteps = [
      ...task.checkpoint.completedSteps.filter(
        (step) => step.id !== event.result.id,
      ),
      {
        id: boundedText(event.result.id, 120),
        toolName: boundedText(event.result.toolName, 200),
        status: event.result.status,
      },
    ].slice(-100);
    return {
      ...task,
      detail:
        event.result.status === "success"
          ? boundedText(event.step.title, 2_000)
          : "Tool execution stopped",
      progress: taskProgress(
        completedSteps.filter((step) => step.status === "success").length,
        task.checkpoint.plan.filter((step) => step.toolName).length,
      ),
      checkpoint: { ...task.checkpoint, completedSteps },
      updatedAt: now,
    };
  }
  if (event.type === "planExtended") {
    const ids = new Set(task.checkpoint.plan.map((step) => step.id));
    return {
      ...task,
      checkpoint: {
        ...task.checkpoint,
        plan: [
          ...task.checkpoint.plan,
          ...event.steps
            .filter((step) => !ids.has(step.id))
            .map(safePlanStep),
        ].slice(0, 100),
      },
      updatedAt: now,
    };
  }
  if (event.type === "limitReached") {
    return {
      ...task,
      detail: "Tool budget reached",
      updatedAt: now,
    };
  }
  return { ...task, updatedAt: now };
}

export function finishAssistantTask(
  task: AssistantTaskRecord,
  result:
    | AssistantToolLoopResult
    | "awaitingApproval"
    | "completed"
    | "cancelled"
    | "failed"
    | "interrupted",
  now = Date.now(),
): AssistantTaskRecord {
  const status = terminalStatus(result);
  const active = status === "running" || status === "awaiting_approval";
  return {
    ...task,
    status,
    detail: statusDetail(status),
    currentStepId: null,
    currentToolName: null,
    progress: status === "completed" ? 1 : task.progress,
    updatedAt: now,
    finishedAt: active ? null : now,
  };
}

export function assistantTaskHasPendingApproval(task: AssistantTaskRecord) {
  const completed = new Set(
    task.checkpoint.completedSteps
      .filter((step) => step.status === "success")
      .map((step) => step.id),
  );
  return task.checkpoint.plan.some(
    (step) => step.toolName && step.requiresApproval && !completed.has(step.id),
  );
}

function terminalStatus(
  result:
    | AssistantToolLoopResult
    | "awaitingApproval"
    | "completed"
    | "cancelled"
    | "failed"
    | "interrupted",
): AssistantTaskStatus {
  if (result === "awaitingApproval") return "awaiting_approval";
  if (result === "completed") return "completed";
  if (result === "cancelled") return "cancelled";
  if (result === "failed") return "failed";
  if (result === "interrupted") return "interrupted";
  if (result.status === "cancelled") return "cancelled";
  if (result.status === "failed") return "failed";
  if (result.status === "limitReached") return "interrupted";
  return "completed";
}

function statusDetail(status: AssistantTaskStatus) {
  if (status === "awaiting_approval") return "Waiting for approval";
  if (status === "completed") return "Completed";
  if (status === "cancelled") return "Cancelled";
  if (status === "interrupted") return "Stopped at the tool budget";
  if (status === "failed") return "Tool execution failed";
  return "Running";
}

function safePlanStep(step: AssistantPreparedTurn["suggestedPlan"][number]) {
  const toolName = step.toolName ? boundedText(step.toolName, 200) : null;
  return {
    id: boundedText(step.id, 120),
    title:
      boundedText(step.title, 200) ||
      boundedText(toolName ? `Run ${toolName}` : "Plan step", 200),
    toolName,
    requiresApproval: step.requiresApproval,
  };
}

function boundedText(value: string, limit: number) {
  return value.trim().slice(0, limit);
}

function taskProgress(completed: number, total: number) {
  return total > 0 ? Math.min(1, completed / total) : null;
}
