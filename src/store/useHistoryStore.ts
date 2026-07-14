import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import {
  QUERY_HISTORY_LIMIT,
  type QueryHistoryExecution,
  type QueryHistoryItem,
} from "@/lib/queryHistory";
import { queryHistoryService } from "@/services/tauri/query-history.service";

const LEGACY_HISTORY_KEY = "query-history";

interface HistoryState {
  projectId: string | null;
  history: QueryHistoryItem[];
  isLoading: boolean;
  error: string | null;
  loadHistory: (projectId: string) => Promise<void>;
  recordExecution: (execution: QueryHistoryExecution) => QueryHistoryItem;
  removeHistory: (id: string) => Promise<void>;
  clearHistory: () => Promise<void>;
  clearError: () => void;
}

interface LegacyHistoryItem {
  id?: string;
  sql?: string;
  timestamp?: number;
}

let latestLoad = 0;
let mutationQueue: Promise<void> = Promise.resolve();

function enqueueMutation(operation: () => Promise<void>) {
  const next = mutationQueue.then(operation, operation);
  mutationQueue = next.catch(() => undefined);
  return next;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function sortedHistory(items: QueryHistoryItem[]) {
  return [...items]
    .sort(
      (left, right) =>
        right.startedAt - left.startedAt || right.id.localeCompare(left.id)
    )
    .slice(0, QUERY_HISTORY_LIMIT);
}

function readLegacyHistory(projectId: string): QueryHistoryItem[] {
  try {
    const stored = localStorage.getItem(LEGACY_HISTORY_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as {
      state?: { history?: LegacyHistoryItem[] };
    };
    return (parsed.state?.history || []).flatMap((item, index) => {
      const sql = item.sql?.trim();
      if (!sql) return [];
      const timestamp = Number.isFinite(item.timestamp)
        ? Number(item.timestamp)
        : Date.now();
      return [
        {
          id: `legacy:${projectId}:${item.id || timestamp}:${index}`,
          projectId,
          connectionId: null,
          connectionName: null,
          driver: null,
          databaseName: null,
          schemaName: null,
          sql,
          status: "success" as const,
          durationMs: 0,
          rowCount: null,
          errorMessage: null,
          executionMode: "console" as const,
          startedAt: timestamp,
          finishedAt: timestamp,
        },
      ];
    });
  } catch {
    return [];
  }
}

function removeLegacyHistory() {
  try {
    localStorage.removeItem(LEGACY_HISTORY_KEY);
  } catch {
    // The SQLite history is already authoritative; storage cleanup is best effort.
  }
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  projectId: null,
  history: [],
  isLoading: false,
  error: null,

  loadHistory: async (projectId) => {
    const loadId = ++latestLoad;
    set({ projectId, history: [], isLoading: true, error: null });
    try {
      let history = await queryHistoryService.getHistory(
        projectId,
        QUERY_HISTORY_LIMIT
      );
      const legacyHistory = readLegacyHistory(projectId);
      if (legacyHistory.length > 0) {
        await queryHistoryService.saveEntries(legacyHistory);
        removeLegacyHistory();
        const byId = new Map(
          [...history, ...legacyHistory].map((item) => [item.id, item])
        );
        history = [...byId.values()];
      }
      if (loadId !== latestLoad) return;
      set((state) => {
        const byId = new Map(
          [
            ...history,
            ...(state.projectId === projectId ? state.history : []),
          ].map((item) => [item.id, item])
        );
        return {
          history: sortedHistory([...byId.values()]),
          isLoading: false,
          error: null,
        };
      });
    } catch (error) {
      if (loadId !== latestLoad) return;
      set((state) => ({
        history: state.projectId === projectId ? state.history : [],
        isLoading: false,
        error: `Could not load query history: ${errorMessage(error)}`,
      }));
    }
  },

  recordExecution: (execution) => {
    const item: QueryHistoryItem = { id: uuidv4(), ...execution };
    set((state) =>
      state.projectId && state.projectId !== execution.projectId
        ? state
        : {
            projectId: execution.projectId,
            history: sortedHistory([item, ...state.history]),
            error: null,
          }
    );
    void enqueueMutation(() => queryHistoryService.saveEntries([item])).catch(
      (error) => {
        if (get().projectId !== execution.projectId) return;
        set({ error: `Could not save query history: ${errorMessage(error)}` });
      }
    );
    return item;
  },

  removeHistory: async (id) => {
    const { projectId, history } = get();
    if (!projectId) return;
    const removed = history.find((item) => item.id === id);
    if (!removed) return;
    set({ history: history.filter((item) => item.id !== id), error: null });
    try {
      await enqueueMutation(() =>
        queryHistoryService.deleteEntry(projectId, id)
      );
    } catch (error) {
      if (get().projectId === projectId) {
        set((state) => ({
          history: sortedHistory([removed, ...state.history]),
          error: `Could not delete query history: ${errorMessage(error)}`,
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
      await enqueueMutation(() => queryHistoryService.clearHistory(projectId));
    } catch (error) {
      if (get().projectId === projectId) {
        set({
          history,
          error: `Could not clear query history: ${errorMessage(error)}`,
        });
      }
      throw error;
    }
  },

  clearError: () => set({ error: null }),
}));
