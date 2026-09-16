import type { TaskKind, TaskStatus, WorkbenchTask } from "./contracts";

const MAX_TASK_HISTORY = 30;

export function isActiveTask(task: Pick<WorkbenchTask, "status">) {
  return task.status === "running" || task.status === "waiting";
}

export function trimFinishedTaskHistory(tasks: WorkbenchTask[]) {
  const retained = new Set(
    tasks
      .filter((task) => !isActiveTask(task))
      .sort((left, right) =>
        (left.finishedAt ?? left.startedAt) - (right.finishedAt ?? right.startedAt),
      )
      .slice(-MAX_TASK_HISTORY),
  );
  return tasks.filter((task) => isActiveTask(task) || retained.has(task));
}

export function createTaskId(kind: TaskKind) {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${kind}:${suffix}`;
}

export function completeTask(
  tasks: WorkbenchTask[],
  id: string,
  status: Exclude<TaskStatus, "running" | "waiting">,
  detail?: string | null,
  error?: string | null,
) {
  return trimFinishedTaskHistory(
    tasks
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
          : task,
      )
      .sort((left, right) => Number(left.id === id) - Number(right.id === id)),
  );
}
