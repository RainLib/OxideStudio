import { create } from "zustand";

export type LspSemanticCompletionState =
  | "syncing"
  | "full"
  | "cached"
  | "limited"
  | "error";

export interface LspSemanticCompletionStatus {
  state: LspSemanticCompletionState;
  totalObjects: number;
  cacheHits: number;
  cacheMisses: number;
  failedObjects: number;
  updatedAt: number;
  message?: string;
}

interface LspSemanticStatusState {
  byConnectionId: Record<string, LspSemanticCompletionStatus>;
  setStatus: (
    connectionId: string,
    status: Omit<LspSemanticCompletionStatus, "updatedAt">,
  ) => void;
  clearStatus: (connectionId: string) => void;
}

/**
 * Keeps semantic-completion quality separate from process health. An LSP
 * process can be ready while schema enrichment is still running, cached, or
 * partially unavailable.
 */
export const useLspSemanticStatusStore = create<LspSemanticStatusState>(
  (set) => ({
    byConnectionId: {},
    setStatus: (connectionId, status) =>
      set((current) => ({
        byConnectionId: {
          ...current.byConnectionId,
          [connectionId]: {
            ...status,
            updatedAt: Date.now(),
          },
        },
      })),
    clearStatus: (connectionId) =>
      set((current) => {
        if (!current.byConnectionId[connectionId]) return current;
        const { [connectionId]: _removed, ...byConnectionId } =
          current.byConnectionId;
        return { byConnectionId };
      }),
  }),
);

export function resetLspSemanticStatusStoreForTests() {
  useLspSemanticStatusStore.setState({ byConnectionId: {} });
}
