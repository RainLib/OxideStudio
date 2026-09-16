import type { TaskSet, WorkbenchTask } from "./contracts";
import { completeTask, createTaskId, isActiveTask, trimFinishedTaskHistory } from "./model";

export function createTaskLifecycleActions(set: TaskSet) {
  const setActiveStatus = (
    id: string,
    status: "running" | "waiting",
    detail?: string | null,
  ) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id
          ? { ...task, status, detail: detail ?? task.detail, error: null, finishedAt: null }
          : task,
      ),
    }));
  };
  return {
    startTask: (task: Pick<WorkbenchTask, "kind" | "title"> & Partial<Pick<WorkbenchTask, "detail" | "progress">>) => {
      const id = createTaskId(task.kind);
      const nextTask: WorkbenchTask = {
        id, kind: task.kind, title: task.title, detail: task.detail ?? null,
        status: "running", progress: task.progress ?? null, startedAt: Date.now(),
        finishedAt: null, error: null,
      };
      set((state) => ({ tasks: trimFinishedTaskHistory([...state.tasks, nextTask]) }));
      return id;
    },
    updateTask: (id: string, updates: Partial<Pick<WorkbenchTask, "title" | "detail" | "progress">>) =>
      set((state) => ({ tasks: state.tasks.map((task) => task.id === id ? { ...task, ...updates } : task) })),
    upsertTask: (task: WorkbenchTask) =>
      set((state) => ({
        tasks: trimFinishedTaskHistory([...state.tasks.filter((candidate) => candidate.id !== task.id), task]
          .sort((left, right) => left.startedAt - right.startedAt)),
      })),
    setTaskRunning: (id: string, detail?: string | null) => setActiveStatus(id, "running", detail),
    setTaskWaiting: (id: string, detail?: string | null) => setActiveStatus(id, "waiting", detail),
    finishTask: (id: string, detail?: string | null) =>
      set((state) => ({ tasks: completeTask(state.tasks, id, "success", detail) })),
    failTask: (id: string, error: string, detail?: string | null) =>
      set((state) => ({ tasks: completeTask(state.tasks, id, "error", detail, error) })),
    cancelTask: (id: string, detail?: string | null) =>
      set((state) => ({ tasks: completeTask(state.tasks, id, "cancelled", detail) })),
    interruptTask: (id: string, detail?: string | null) =>
      set((state) => ({ tasks: completeTask(state.tasks, id, "interrupted", detail) })),
    clearFinished: () => set((state) => ({ tasks: state.tasks.filter(isActiveTask) })),
  };
}
