import { create } from "zustand";

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
  upsertTask: (task: WorkbenchTask) => void;
  setTaskRunning: (id: string, detail?: string | null) => void;
  setTaskWaiting: (id: string, detail?: string | null) => void;
  finishTask: (id: string, detail?: string | null) => void;
  failTask: (id: string, error: string, detail?: string | null) => void;
  cancelTask: (id: string, detail?: string | null) => void;
  interruptTask: (id: string, detail?: string | null) => void;
  replacePersistentAgentTasks: (
    projectId: string,
    tasks: WorkbenchTask[],
  ) => void;
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
  status: Exclude<TaskStatus, "running" | "waiting">,
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

  upsertTask: (task) => {
    set((state) => ({
      tasks: [...state.tasks.filter((candidate) => candidate.id !== task.id), task]
        .sort((left, right) => left.startedAt - right.startedAt)
        .slice(-MAX_TASK_HISTORY),
    }));
  },

  setTaskRunning: (id, detail) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id
          ? {
              ...task,
              status: "running",
              detail: detail ?? task.detail,
              error: null,
              finishedAt: null,
            }
          : task,
      ),
    }));
  },

  setTaskWaiting: (id, detail) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id
          ? {
              ...task,
              status: "waiting",
              detail: detail ?? task.detail,
              error: null,
              finishedAt: null,
            }
          : task,
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

  interruptTask: (id, detail) => {
    set((state) => ({
      tasks: completeTask(state.tasks, id, "interrupted", detail),
    }));
  },

  replacePersistentAgentTasks: (projectId, tasks) => {
    set((state) => {
      const persistentTasks = tasks.filter(
        (task) => task.kind === "agent" && task.persistent,
      );
      const persistentTaskIds = new Set(
        persistentTasks.map((task) => task.id),
      );
      const activeLocalTasks = state.tasks.filter(
        (task) =>
          task.kind === "agent" &&
          task.persistent &&
          task.projectId === projectId &&
          (task.status === "running" || task.status === "waiting") &&
          !persistentTaskIds.has(task.id),
      );

      return {
        tasks: [
          ...state.tasks.filter(
            (task) => !(task.kind === "agent" && task.persistent),
          ),
          ...activeLocalTasks,
          ...persistentTasks,
        ]
        .sort((left, right) => left.startedAt - right.startedAt)
        .slice(-MAX_TASK_HISTORY),
      };
    });
  },

  clearFinished: () => {
    set((state) => ({
      tasks: state.tasks.filter(
        (task) => task.status === "running" || task.status === "waiting",
      ),
    }));
  },
}));
