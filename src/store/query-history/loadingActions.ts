import { QUERY_HISTORY_LIMIT } from "@/lib/queryHistory";
import { queryHistoryService } from "@/services/tauri/query-history.service";
import type { HistorySet } from "./contracts";
import {
  readLegacyQueryHistory,
  removeLegacyQueryHistory,
} from "./legacyMigration";
import { beginHistoryLoad, isCurrentHistoryLoad } from "./runtime";
import { historyErrorMessage, sortedQueryHistory } from "./state";

export function createHistoryLoadingActions(set: HistorySet) {
  return {
    loadHistory: async (projectId: string) => {
      const loadId = beginHistoryLoad();
      set({ projectId, history: [], isLoading: true, error: null });
      try {
        let history = await queryHistoryService.getHistory(
          projectId,
          QUERY_HISTORY_LIMIT,
        );
        const legacyHistory = readLegacyQueryHistory(projectId);
        if (legacyHistory.length > 0) {
          await queryHistoryService.saveEntries(legacyHistory);
          removeLegacyQueryHistory();
          const byId = new Map(
            [...history, ...legacyHistory].map((item) => [item.id, item]),
          );
          history = [...byId.values()];
        }
        if (!isCurrentHistoryLoad(loadId)) return;
        set((state) => {
          const byId = new Map(
            [
              ...history,
              ...(state.projectId === projectId ? state.history : []),
            ].map((item) => [item.id, item]),
          );
          return {
            history: sortedQueryHistory([...byId.values()]),
            isLoading: false,
            error: null,
          };
        });
      } catch (error) {
        if (!isCurrentHistoryLoad(loadId)) return;
        set((state) => ({
          history: state.projectId === projectId ? state.history : [],
          isLoading: false,
          error: `Could not load query history: ${historyErrorMessage(error)}`,
        }));
      }
    },
  };
}
