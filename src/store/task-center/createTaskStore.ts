import { create } from "zustand";
import type { TaskState } from "./contracts";
import { createTaskLifecycleActions } from "./lifecycleActions";
import { createPersistentAgentTaskActions } from "./persistentAgentActions";

export function createTaskStore() {
  return create<TaskState>((set) => ({
    tasks: [],
    ...createTaskLifecycleActions(set),
    ...createPersistentAgentTaskActions(set),
  }));
}
