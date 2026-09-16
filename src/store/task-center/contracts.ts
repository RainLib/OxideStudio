import type { StoreApi } from "zustand";

export type TaskStatus =
  | "running"
  | "waiting"
  | "success"
  | "error"
  | "cancelled"
  | "interrupted";
export type TaskKind =
  | "agent"
  | "query"
  | "table"
  | "import"
  | "export"
  | "introspection"
  | "lsp"
  | "other";
export type WorkbenchTaskStepStatus =
  | "pending"
  | "running"
  | "success"
  | "requiresApproval"
  | "uncertain"
  | "error";

export interface WorkbenchTaskStep {
  id: string;
  title: string;
  toolName?: string | null;
  requiresApproval: boolean;
  status: WorkbenchTaskStepStatus;
}

export interface WorkbenchTask {
  id: string;
  kind: TaskKind;
  title: string;
  detail?: string | null;
  status: TaskStatus;
  progress?: number | null;
  startedAt: number;
  finishedAt?: number | null;
  error?: string | null;
  projectId?: string | null;
  persistent?: boolean;
  currentStepId?: string | null;
  steps?: WorkbenchTaskStep[];
}

export interface TaskState {
  tasks: WorkbenchTask[];
  startTask: (task: Pick<WorkbenchTask, "kind" | "title"> & Partial<Pick<WorkbenchTask, "detail" | "progress">>) => string;
  updateTask: (id: string, updates: Partial<Pick<WorkbenchTask, "title" | "detail" | "progress">>) => void;
  upsertTask: (task: WorkbenchTask) => void;
  setTaskRunning: (id: string, detail?: string | null) => void;
  setTaskWaiting: (id: string, detail?: string | null) => void;
  finishTask: (id: string, detail?: string | null) => void;
  failTask: (id: string, error: string, detail?: string | null) => void;
  cancelTask: (id: string, detail?: string | null) => void;
  interruptTask: (id: string, detail?: string | null) => void;
  replacePersistentAgentTasks: (projectId: string, tasks: WorkbenchTask[]) => void;
  clearFinished: () => void;
}

export type TaskSet = StoreApi<TaskState>["setState"];
