import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import { fileQueryService, type FileQuerySession } from "@/services/tauri/file-query.service";
import { useTaskStore } from "@/store/useTaskStore";
import type { TabData, TabState } from "../../model/types";
import { runFileQuery } from "./fileQuery";

vi.mock("@/services/tauri/file-query.service", () => ({ fileQueryService: { query: vi.fn(), status: vi.fn() } }));
const session = { id: "snapshot", projectId: "project", fileName: "sales.csv", format: "csv" } as FileQuerySession;
const diagnostics = [{ message: "query diagnostic", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }];
function fixture() {
  const tab = { id: "query", type: "query", title: "sales.csv", sql: "SELECT * FROM data", isPinned: false,
    lspDiagnostics: diagnostics, fileQuery: { source: { kind: "picker", projectId: "project" }, session, driverId: "duckdb", packageVersion: "0.1.0", csvHeader: "auto" } } as TabData;
  return createStore<TabState>(() => ({ tabs: [tab], activeTabId: tab.id }) as TabState);
}
describe("file query error recovery", () => {
  beforeEach(() => { vi.resetAllMocks(); useTaskStore.setState({ tasks: [] }); });
  it("retains the known snapshot and diagnostics when a status IPC request fails, then allows retry", async () => {
    const store = fixture();
    vi.mocked(fileQueryService.query).mockRejectedValueOnce(new Error("SQL parser error"));
    vi.mocked(fileQueryService.status).mockRejectedValueOnce(new Error("temporary IPC failure"));
    await runFileQuery(store.setState, store.getState, "query");
    expect(store.getState().tabs[0]).toMatchObject({ error: "SQL parser error", isExecuting: false, runningQueryId: null, fileQuery: { session }, lspDiagnostics: diagnostics });
    expect(useTaskStore.getState().tasks[0]).toMatchObject({ status: "error", error: "SQL parser error" });
    const results = [{ columns: [{ name: "label", data_type: "VARCHAR" }], rows: [["雪"]] }];
    vi.mocked(fileQueryService.query).mockResolvedValueOnce(results);
    await runFileQuery(store.setState, store.getState, "query", "SELECT label FROM data");
    expect(fileQueryService.query).toHaveBeenLastCalledWith(session, "SELECT label FROM data");
    expect(store.getState().tabs[0]).toMatchObject({ error: null, results, isExecuting: false, fileQuery: { session } });
  });
  it("clears a snapshot and diagnostics when the Host confirms it has ended", async () => {
    const store = fixture();
    vi.mocked(fileQueryService.query).mockRejectedValue(new Error("Host exited"));
    vi.mocked(fileQueryService.status).mockResolvedValue(null);
    await runFileQuery(store.setState, store.getState, "query");
    expect(store.getState().tabs[0]).toMatchObject({ error: "Host exited", isExecuting: false, fileQuery: { session: null }, lspDiagnostics: [] });
  });
  it("does not replace a reopened snapshot with a delayed status reply", async () => {
    const store = fixture(); let reply!: (value: FileQuerySession | null) => void;
    vi.mocked(fileQueryService.query).mockRejectedValue(new Error("old query failed"));
    vi.mocked(fileQueryService.status).mockImplementation(() => new Promise(resolve => { reply = resolve; }));
    const pending = runFileQuery(store.setState, store.getState, "query");
    await vi.waitFor(() => expect(fileQueryService.status).toHaveBeenCalledOnce());
    const replacement = { ...store.getState().tabs[0]!, runningQueryId: "new-query", error: null,
      fileQuery: { ...store.getState().tabs[0]!.fileQuery!, session: { ...session, id: "replacement" } } };
    store.setState({ tabs: [replacement] }); reply(null); await pending;
    expect(store.getState().tabs[0]).toBe(replacement);
  });
  it("does not resurrect a closed tab after a delayed failed status request", async () => {
    const store = fixture(); let reject!: (error: Error) => void;
    vi.mocked(fileQueryService.query).mockRejectedValue(new Error("old query failed"));
    vi.mocked(fileQueryService.status).mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    const pending = runFileQuery(store.setState, store.getState, "query");
    await vi.waitFor(() => expect(fileQueryService.status).toHaveBeenCalledOnce());
    store.setState({ tabs: [], activeTabId: "" }); reject(new Error("IPC unavailable")); await pending;
    expect(store.getState().tabs).toEqual([]);
  });
});
