import type {
  QueryHistoryExecution,
  QueryHistoryItem,
} from "@/lib/queryHistory";
import type { StoreApi } from "zustand";

export interface HistoryState {
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

export interface LegacyHistoryItem {
  id?: string;
  sql?: string;
  timestamp?: number;
}

export type HistorySet = StoreApi<HistoryState>["setState"];
export type HistoryGet = StoreApi<HistoryState>["getState"];
