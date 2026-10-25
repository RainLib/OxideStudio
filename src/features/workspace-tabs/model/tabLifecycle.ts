import { confirmAction } from "@/lib/appDialogs";
import { TabData } from "@/features/workspace-tabs/model/types";
import { QueryResult, queryService, schemaService } from "@/services/tauri";
import { fileQueryService } from "@/services/tauri/file-query.service";

export function hasPendingTableChanges(
  tab: Pick<TabData, "type" | "pendingEdits" | "newRowsCount">,
) {
  return (
    tab.type === "table" &&
    ((tab.pendingEdits?.size || 0) > 0 || (tab.newRowsCount || 0) > 0)
  );
}

export function hasUnsavedTabChanges(
  tab: Pick<
    TabData,
    | "type"
    | "fileRelativePath"
    | "savedSqlFileId"
    | "isDirty"
    | "pendingEdits"
    | "newRowsCount"
  >,
) {
  return (
    Boolean((tab.fileRelativePath || tab.savedSqlFileId) && tab.isDirty) ||
    hasPendingTableChanges(tab)
  );
}

export async function confirmDiscardTabChanges(tabs: TabData[], action: string) {
  const dirtyFiles = tabs.filter(
    (tab) => (tab.fileRelativePath || tab.savedSqlFileId) && tab.isDirty,
  );
  const dirtyTables = tabs.filter(hasPendingTableChanges);
  if (dirtyFiles.length === 0 && dirtyTables.length === 0) return true;

  const details: string[] = [];
  if (dirtyFiles.length > 0) {
    const names = dirtyFiles
      .slice(0, 3)
      .map((tab) => tab.fileRelativePath || tab.title)
      .join(", ");
    const remaining = dirtyFiles.length - Math.min(3, dirtyFiles.length);
    details.push(
      `${dirtyFiles.length} editor file${dirtyFiles.length === 1 ? "" : "s"}: ${names}${
        remaining > 0 ? ` and ${remaining} more` : ""
      }`,
    );
  }
  if (dirtyTables.length > 0) {
    const editedCells = dirtyTables.reduce(
      (total, tab) => total + (tab.pendingEdits?.size || 0),
      0,
    );
    const newRows = dirtyTables.reduce(
      (total, tab) => total + (tab.newRowsCount || 0),
      0,
    );
    details.push(
      `${dirtyTables.length} table tab${dirtyTables.length === 1 ? "" : "s"} (${editedCells} edited cell${
        editedCells === 1 ? "" : "s"
      }, ${newRows} new row${newRows === 1 ? "" : "s"})`,
    );
  }

  return (await confirmAction(
    `Unsaved changes will be discarded when you ${action}.\n\n${details.join(
      "\n",
    )}\n\nUse Submit Changes or save the file first to keep them. Choose Discard changes to discard, or Cancel to stay.`,
    { title: "Unsaved changes", confirmLabel: "Discard changes" },
  ));
}

/**
 * Closed tabs retain editor/navigation state so they can be reopened, but a
 * result grid may own hundreds of megabytes. Never move that payload into the
 * bounded closed-tab history: reopening reruns or reloads data explicitly.
 */
export function tabAfterReleasingRuntimePayload(tab: TabData): TabData {
  return {
    ...tab,
    fileQuery: tab.fileQuery ? { ...tab.fileQuery, session: null } : undefined,
    results: null,
    resultSql: undefined,
    nativeQueryCursor: undefined,
    nativeQueryHasMore: false,
    nativeQueryPageSize: undefined,
    explainPlan: null,
    queryOutputView: "results",
    activeResultIndex: 0,
    executingResultIndex: undefined,
    executingResultRunId: undefined,
    resultGridStates: undefined,
    resultRuns: undefined,
    activeResultRunId: undefined,
    isExecuting: false,
    runningQueryId: null,
    error: null,
    queryError: null,
    pendingEdits: new Map<string, any>(),
    newRowsCount: 0,
    newRowPlacements: [],
    tablePage: tab.documentPageCursors?.some(Boolean) ? 0 : tab.tablePage,
    documentPageCursors: undefined,
    documentHasNextCursor: false,
  };
}

export function releaseQueryResultPayload(result: QueryResult) {
  result.columns = [];
  result.rows = [];
  result.message = undefined;
  result.responseMeta = undefined;
}

export function releaseTabResultPayloads(tabs: readonly TabData[]) {
  const released = new Set<QueryResult>();
  for (const tab of tabs) {
    for (const result of tab.results || []) {
      if (released.has(result)) continue;
      released.add(result);
      releaseQueryResultPayload(result);
    }
    for (const run of tab.resultRuns || []) {
      for (const result of run.results) {
        if (released.has(result)) continue;
        released.add(result);
        releaseQueryResultPayload(result);
      }
    }
  }
}

export function releaseTabRuntimeResources(tabs: readonly TabData[]) {
  const released = new Set<string>();
  const cancelledQueries = new Set<string>();
  for (const tab of tabs) {
    if (tab.fileQuery) {
      if (tab.fileQuery.session) void fileQueryService.close(tab.fileQuery.session).catch(() => undefined);
      continue;
    }
    if (tab.runningQueryId && !cancelledQueries.has(tab.runningQueryId)) {
      cancelledQueries.add(tab.runningQueryId);
      void queryService.cancelQuery(tab.runningQueryId).catch(() => undefined);
    }
    if (!tab.connectionId) continue;
    if (tab.nativeQueryCursor) {
      const nativeKey = `${tab.connectionId}\u0000native\u0000${tab.nativeQueryCursor}`;
      if (!released.has(nativeKey)) {
        released.add(nativeKey);
        void queryService
          .closeNativeQueryPage(tab.connectionId, tab.nativeQueryCursor)
          .catch(() => undefined);
      }
    }
    const cursor = [...(tab.documentPageCursors || [])]
      .reverse()
      .find((value): value is string => Boolean(value));
    if (!cursor) continue;
    const key = `${tab.connectionId}\u0000${cursor}`;
    if (released.has(key)) continue;
    released.add(key);
    void schemaService
      .closeDocumentCursor(tab.connectionId, cursor)
      .catch(() => undefined);
  }
  releaseTabResultPayloads(tabs);
}
