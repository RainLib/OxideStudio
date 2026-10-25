import { fileQueryService } from "@/services/tauri/file-query.service";
import { boundedQueryResultRuns, snapshotActiveQueryResultRun } from "../../model/queryResults";
import type { TabSlice } from "../types";
import { v4 as uuid } from "uuid";
import { useTaskStore } from "@/store/useTaskStore";

type Set = Parameters<TabSlice<"runTabQuery">>[0];
type Get = Parameters<TabSlice<"runTabQuery">>[1];

export async function runFileQuery(set: Set, get: Get, id: string, override?: string) {
  const tab = get().tabs.find(tab => tab.id === id);
  const session = tab?.fileQuery?.session;
  if (!tab || !session || tab.isExecuting) return;
  const sql = override ?? tab.sql;
  if (!sql.trim()) return;
  const queryId = `file:${uuid()}`;
  const task = useTaskStore.getState();
  const taskId = task.startTask({ kind: "query", title: `Query ${session.fileName}`, detail: "Reading file snapshot" });
  set(state => ({ tabs: state.tabs.map(t => t.id === id ? { ...t, isExecuting: true, runningQueryId: queryId, error: null, queryError: null, queryOutputView: "results" } : t) }));
  try {
    const results = await fileQueryService.query(session, sql);
    if (get().tabs.find(t => t.id === id)?.runningQueryId !== queryId) { task.cancelTask(taskId, "File query cancelled or workspace changed"); return; }
    set(state => ({ tabs: state.tabs.map(t => {
      if (t.id !== id || t.runningQueryId !== queryId || t.fileQuery?.session?.id !== session.id) return t;
      const previous = snapshotActiveQueryResultRun(t);
      const run = { id: `run:${uuid()}`, completedAt: Date.now(), sql, results, activeResultIndex: 0, pinned: false };
      return { ...previous, results, resultSql: sql, isExecuting: false, runningQueryId: null, activeResultIndex: 0,
        resultRuns: boundedQueryResultRuns([...(previous.resultRuns ?? []), run]), activeResultRunId: run.id };
    }) }));
    task.finishTask(taskId, `${results[0]?.rows.length ?? 0} rows`);
  } catch (error) {
    if (get().tabs.find(t => t.id === id)?.runningQueryId !== queryId) { task.cancelTask(taskId, "File query cancelled or workspace changed"); return; }
    // A failed status request leaves liveness unknown. Only a confirmed null
    // response can invalidate the snapshot and its editor intelligence.
    const live = await fileQueryService.status(session).catch(() => session);
    const message = error instanceof Error ? error.message : String(error);
    set(state => ({ tabs: state.tabs.map(t => t.id === id && t.runningQueryId === queryId && t.fileQuery?.session?.id === session.id
      ? { ...t, isExecuting: false, runningQueryId: null, error: message,lspDiagnostics:live?t.lspDiagnostics:[], fileQuery: { ...t.fileQuery, session: live } } : t) }));
    task.failTask(taskId, message);
  }
}

export async function cancelFileQuery(set: Set, get: Get, id: string) {
  const session = get().tabs.find(t => t.id === id)?.fileQuery?.session;
  if (!session) return;
  set(state => ({ tabs: state.tabs.map(t => t.id === id && t.fileQuery?.session?.id === session.id
    ? { ...t, isExecuting: false, runningQueryId: null,lspDiagnostics:[], error: "Query cancelled. Reopen the file to start a new snapshot.", fileQuery: { ...t.fileQuery, session: null } } : t) }));
  try { await fileQueryService.close(session); }
  catch (error) {
    set(state => ({ tabs: state.tabs.map(t => t.id === id ? { ...t, error: `Could not close the file session: ${error instanceof Error ? error.message : String(error)}` } : t) }));
  }
}
