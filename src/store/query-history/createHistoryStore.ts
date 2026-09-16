import { create } from "zustand";
import type { HistoryState } from "./contracts";
import { createHistoryLoadingActions } from "./loadingActions";
import { createHistoryMutationActions } from "./mutationActions";

export function createHistoryStore() {
  return create<HistoryState>((set, get) => ({
    projectId: null,
    history: [],
    isLoading: false,
    error: null,
    ...createHistoryLoadingActions(set),
    ...createHistoryMutationActions(set, get),
    clearError: () => set({ error: null }),
  }));
}
