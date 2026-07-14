import { invokeRawCommand } from "./client";

export type AssistantTaskStatus =
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface AssistantTaskPlanStepRecord {
  id: string;
  title: string;
  toolName?: string | null;
  requiresApproval: boolean;
}

export interface AssistantTaskCompletedStepRecord {
  id: string;
  toolName: string;
  status: "success" | "requiresApproval" | "error";
}

export interface AssistantTaskExecutionReceiptRecord {
  stepId: string;
  toolName: string;
  status: "started" | "succeeded" | "failed";
  startedAt: number;
  finishedAt?: number | null;
}

export interface AssistantTaskCheckpointRecord {
  version: 1 | 2;
  mode: "agent";
  plan: AssistantTaskPlanStepRecord[];
  completedSteps: AssistantTaskCompletedStepRecord[];
  executionReceipts?: AssistantTaskExecutionReceiptRecord[];
}

export interface AssistantTaskRecord {
  id: string;
  projectId: string;
  requestId: string;
  sessionId: string;
  status: AssistantTaskStatus;
  title: string;
  detail?: string | null;
  currentStepId?: string | null;
  currentToolName?: string | null;
  progress?: number | null;
  checkpoint: AssistantTaskCheckpointRecord;
  createdAt: number;
  updatedAt: number;
  finishedAt?: number | null;
}

export const ASSISTANT_TASK_SESSION_ID = createSessionId();

export const assistantTaskService = {
  save: async (task: AssistantTaskRecord): Promise<void> => {
    await invokeRawCommand("save_assistant_task", { task });
  },

  list: async (
    projectId: string,
    limit = 50,
  ): Promise<AssistantTaskRecord[]> => {
    return await invokeRawCommand("get_assistant_tasks", {
      projectId,
      sessionId: ASSISTANT_TASK_SESSION_ID,
      limit,
    });
  },

  clearFinished: async (projectId: string): Promise<void> => {
    await invokeRawCommand("clear_finished_assistant_tasks", { projectId });
  },
};

function createSessionId() {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `assistant-session:${suffix}`;
}
