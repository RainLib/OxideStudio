import { create } from "zustand";

export interface TaskNavigationTarget {
  projectId: string;
  taskId?: string;
}

interface TaskNavigationRequest {
  id: string;
  target: TaskNavigationTarget;
}

interface TaskNavigationState {
  request: TaskNavigationRequest | null;
  reveal: (target: TaskNavigationTarget) => string;
  clear: (requestId: string) => void;
}

export const useTaskNavigationStore = create<TaskNavigationState>((set) => ({
  request: null,
  reveal: (target) => {
    const id = createRequestId();
    set({ request: { id, target } });
    return id;
  },
  clear: (requestId) =>
    set((state) =>
      state.request?.id === requestId ? { request: null } : state,
    ),
}));

export function requestTaskReveal(target: TaskNavigationTarget) {
  return useTaskNavigationStore.getState().reveal(target);
}

function createRequestId() {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `task-navigation:${suffix}`;
}
