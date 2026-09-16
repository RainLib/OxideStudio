import type { TaskSet, WorkbenchTask } from "./contracts";
import { isActiveTask, trimFinishedTaskHistory } from "./model";

export function createPersistentAgentTaskActions(set: TaskSet) {
  return {
    replacePersistentAgentTasks: (projectId: string, tasks: WorkbenchTask[]) => {
      set((state) => {
        const persistentTasks = tasks.filter(
          (task) => task.kind === "agent" && task.persistent,
        );
        const persistentTaskIds = new Set(persistentTasks.map((task) => task.id));
        const activeLocalTasks = state.tasks.filter(
          (task) => task.kind === "agent" && task.persistent && task.projectId === projectId && isActiveTask(task) && !persistentTaskIds.has(task.id),
        );
        return {
          tasks: trimFinishedTaskHistory([
            ...state.tasks.filter((task) => !(task.kind === "agent" && task.persistent)),
            ...activeLocalTasks,
            ...persistentTasks,
          ].sort((left, right) => left.startedAt - right.startedAt)),
        };
      });
    },
  };
}
