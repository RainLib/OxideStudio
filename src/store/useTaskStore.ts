import { createTaskStore } from "./task-center/createTaskStore";

export type {
  TaskKind,
  TaskStatus,
  WorkbenchTask,
  WorkbenchTaskStep,
  WorkbenchTaskStepStatus,
} from "./task-center/contracts";

export const useTaskStore = createTaskStore();
