import { invoke } from "@tauri-apps/api/core";
import type { QueryHistoryItem } from "@/lib/queryHistory";

export const queryHistoryService = {
  saveEntries: async (entries: QueryHistoryItem[]): Promise<void> => {
    await invoke("save_query_history_entries", { entries });
  },

  getHistory: async (
    projectId: string,
    limit = 500
  ): Promise<QueryHistoryItem[]> => {
    return await invoke("get_query_history", { projectId, limit });
  },

  deleteEntry: async (projectId: string, id: string): Promise<void> => {
    await invoke("delete_query_history_entry", { projectId, id });
  },

  clearHistory: async (projectId: string): Promise<void> => {
    await invoke("clear_query_history", { projectId });
  },
};
