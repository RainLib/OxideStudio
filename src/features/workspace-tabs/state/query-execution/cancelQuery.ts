import { queryService } from "@/services/tauri";
import type { TabSlice } from "../types";

/** Owns best-effort query cancellation without taking over completion state. */
export const createCancelQueryAction: TabSlice<"cancelTabQuery"> = (set, get) => ({
  cancelTabQuery: async (id) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab?.runningQueryId) return;
    const queryId = tab.runningQueryId;

    try {
      await queryService.cancelQuery(queryId);
    } catch (e: any) {
      const message = e?.message || String(e);
      console.error("Failed to cancel query:", e);
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === id && t.runningQueryId === queryId
            ? {
                ...t,
                error: `Failed to cancel query: ${message}`,
              }
            : t,
        ),
      }));
    }
  },
});
