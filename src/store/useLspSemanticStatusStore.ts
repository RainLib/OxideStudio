import { create } from "zustand";
import type {LspSemanticContext} from "@/services/lsp/semanticContext";

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
  context?: LspSemanticContext;
  /** Process-health counters; never contain SQL text or object metadata. */
  telemetry: {
    staleResponses: number;
    syncFailures: number;
    restarts: number;
    lastFailureAt?: number;
    lastRecoveryMs?: number;
  };
}

interface LspSemanticStatusState {
  byConnectionId: Record<string, LspSemanticCompletionStatus>;
  setStatus: (
    connectionId: string,
    status: Omit<LspSemanticCompletionStatus, "updatedAt" | "telemetry"> &
      Partial<Pick<LspSemanticCompletionStatus, "telemetry">>,
  ) => void;
  clearStatus: (connectionId: string) => void;
  recordTelemetry: (connectionId: string, event: "stale" | "syncFailure" | "restart", durationMs?: number) => void;
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
            telemetry: current.byConnectionId[connectionId]?.telemetry || {
              staleResponses: 0,
              syncFailures: 0,
              restarts: 0,
            },
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
    recordTelemetry: (connectionId, event, durationMs) =>
      set((current) => {
        const previous = current.byConnectionId[connectionId] || {
          state: "limited" as const,
          totalObjects: 0,
          cacheHits: 0,
          cacheMisses: 0,
          failedObjects: 0,
          updatedAt: Date.now(),
          telemetry: { staleResponses: 0, syncFailures: 0, restarts: 0 },
        };
        const telemetry = { ...previous.telemetry };
        if (event === "stale") telemetry.staleResponses += 1;
        else if (event === "restart") {
          telemetry.restarts += 1;
          if (typeof durationMs === "number" && Number.isFinite(durationMs)) {
            telemetry.lastRecoveryMs = Math.max(0, Math.round(durationMs));
          }
        }
        else {
          telemetry.syncFailures += 1;
          telemetry.lastFailureAt = Date.now();
        }
        return {
          byConnectionId: {
            ...current.byConnectionId,
            [connectionId]: { ...previous, telemetry, updatedAt: Date.now() },
          },
        };
      }),
  }),
);

export function resetLspSemanticStatusStoreForTests() {
  useLspSemanticStatusStore.setState({ byConnectionId: {} });
}
