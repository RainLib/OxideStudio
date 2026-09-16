import type { QueryHistoryItem } from "@/lib/queryHistory";
import type { LegacyHistoryItem } from "./contracts";

const LEGACY_HISTORY_KEY = "query-history";

export function readLegacyQueryHistory(projectId: string): QueryHistoryItem[] {
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

export function removeLegacyQueryHistory() {
  try {
    localStorage.removeItem(LEGACY_HISTORY_KEY);
  } catch {
    // The SQLite history is already authoritative; cleanup is best effort.
  }
}
