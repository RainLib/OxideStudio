import { v4 as uuidv4 } from "uuid";
import type { QueryHistoryExecution, QueryHistoryItem } from "@/lib/queryHistory";
import { queryHistoryService } from "@/services/tauri/query-history.service";
import type { HistoryGet, HistorySet } from "./contracts";
import { enqueueHistoryMutation } from "./runtime";
import { historyErrorMessage, sortedQueryHistory } from "./state";

export function createHistoryMutationActions(set: HistorySet, get: HistoryGet) {
  return {
    recordExecution: (execution: QueryHistoryExecution) => {
      const item: QueryHistoryItem = { id: uuidv4(), ...execution };
      set((state) =>
        state.projectId && state.projectId !== execution.projectId
          ? state
          : {
              projectId: execution.projectId,
              history: sortedQueryHistory([item, ...state.history]),
              error: null,
            },
      );
      void enqueueHistoryMutation(() =>
        queryHistoryService.saveEntries([item]),
      ).catch((error) => {
        if (get().projectId !== execution.projectId) return;
        set({
          error: `Could not save query history: ${historyErrorMessage(error)}`,
        });
      });
      return item;
    },

    removeHistory: async (id: string) => {
      const { projectId, history } = get();
      if (!projectId) return;
      const removed = history.find((item) => item.id === id);
      if (!removed) return;
      set({ history: history.filter((item) => item.id !== id), error: null });
      try {
        await enqueueHistoryMutation(() =>
          queryHistoryService.deleteEntry(projectId, id),
        );
      } catch (error) {
        if (get().projectId === projectId) {
          set((state) => ({
            history: sortedQueryHistory([removed, ...state.history]),
            error: `Could not delete query history: ${historyErrorMessage(error)}`,
          }));
        }
        throw error;
      }
    },

    clearHistory: async () => {
      const { projectId, history } = get();
      if (!projectId || history.length === 0) return;
      set({ history: [], error: null });
      try {
        await enqueueHistoryMutation(() =>
          queryHistoryService.clearHistory(projectId),
        );
      } catch (error) {
        if (get().projectId === projectId) {
          set({
            history,
            error: `Could not clear query history: ${historyErrorMessage(error)}`,
          });
        }
        throw error;
      }
    },
  };
}
