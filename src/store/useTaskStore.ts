import { create } from "zustand";

export type TaskStatus = "running" | "success" | "error" | "cancelled";
export type TaskKind =
  | "query"
  | "table"
  | "import"
  | "export"
  | "introspection"
  | "lsp"
  | "other";

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
}

interface TaskState {
  tasks: WorkbenchTask[];
  startTask: (
    task: Pick<WorkbenchTask, "kind" | "title"> &
      Partial<Pick<WorkbenchTask, "detail" | "progress">>
  ) => string;
  updateTask: (
    id: string,
    updates: Partial<Pick<WorkbenchTask, "title" | "detail" | "progress">>
  ) => void;
  finishTask: (id: string, detail?: string | null) => void;
  failTask: (id: string, error: string, detail?: string | null) => void;
  cancelTask: (id: string, detail?: string | null) => void;
  clearFinished: () => void;
}

const MAX_TASK_HISTORY = 30;

function taskId(kind: TaskKind) {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${kind}:${suffix}`;
}

function completeTask(
  tasks: WorkbenchTask[],
  id: string,
  status: Exclude<TaskStatus, "running">,
  detail?: string | null,
  error?: string | null
) {
  return tasks
    .map((task) =>
      task.id === id
        ? {
            ...task,
            status,
            detail: detail ?? task.detail,
            error: error ?? task.error,
            progress: status === "success" ? 1 : task.progress,
            finishedAt: Date.now(),
          }
        : task
    )
    .slice(-MAX_TASK_HISTORY);
}

export const useTaskStore = create<TaskState>((set) => ({
  tasks: [],

  startTask: (task) => {
    const id = taskId(task.kind);
    const nextTask: WorkbenchTask = {
      id,
      kind: task.kind,
      title: task.title,
      detail: task.detail ?? null,
      status: "running",
      progress: task.progress ?? null,
      startedAt: Date.now(),
      finishedAt: null,
      error: null,
    };
    set((state) => ({
      tasks: [...state.tasks, nextTask].slice(-MAX_TASK_HISTORY),
    }));
    return id;
  },

  updateTask: (id, updates) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id ? { ...task, ...updates } : task
      ),
    }));
  },

  finishTask: (id, detail) => {
    set((state) => ({
      tasks: completeTask(state.tasks, id, "success", detail),
    }));
  },

  failTask: (id, error, detail) => {
    set((state) => ({
      tasks: completeTask(state.tasks, id, "error", detail, error),
    }));
  },

  cancelTask: (id, detail) => {
    set((state) => ({
      tasks: completeTask(state.tasks, id, "cancelled", detail),
    }));
  },

  clearFinished: () => {
    set((state) => ({
      tasks: state.tasks.filter((task) => task.status === "running"),
    }));
  },
}));
