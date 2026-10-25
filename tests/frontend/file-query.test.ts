// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFileQueryStore } from "@/features/file-query/store";
import { useTabStore } from "@/store/useTabStore";
import { useProjectStore } from "@/store/useProjectStore";
import { releaseTabRuntimeResources, tabAfterReleasingRuntimePayload } from "@/features/workspace-tabs/model/tabLifecycle";
import type { FileQuerySession } from "@/services/tauri/file-query.service";
import type { DatabaseDriverInstallation } from "@/services/tauri/types";
import { createOpenFileQueryAction } from "@/lib/workbench-actions/files";

const api = vi.hoisted(() => ({ pick: vi.fn(), openProject: vi.fn(), close: vi.fn(), closeProject: vi.fn(), cancelOpen: vi.fn(), query: vi.fn(), status: vi.fn(), list: vi.fn(), databaseQuery: vi.fn(), databaseCancel: vi.fn() }));
vi.mock("@/services/tauri/file-query.service", () => ({ fileQueryService: api }));
vi.mock("@/services/tauri", async importOriginal => {
  const actual = await importOriginal<typeof import("@/services/tauri")>();
  return { ...actual, databaseService: { ...actual.databaseService, listDatabaseDriverInstallations: api.list }, queryService: { ...actual.queryService, executeQuery: api.databaseQuery, cancelQuery: api.databaseCancel } };
});
const source = { kind: "picker" as const, projectId: "file-query-test" };
const session: FileQuerySession = { id: "session-1", projectId: source.projectId, fileName: "sales.csv", format: "csv", sourceBytes: 22, driverId: "duckdb", packageVersion: "0.1.0", initialSql: "SELECT * FROM data", languageId: "sql", csvHeader: "auto" };
const provider = { driver: "duckdb", packageVersion: "0.1.0", distribution: "external", active: true, status: "ready", runtimeReady: true, capabilities: { fileQueryFormats: ["csv"] } } as DatabaseDriverInstallation;
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fileTab() {
  return useTabStore.getState().createTab("query", "sales.csv · SQL", session.initialSql, { fileQuery: { source, session, driverId: session.driverId, packageVersion: session.packageVersion, csvHeader: "auto" } });
}
beforeEach(() => {
  api.cancelOpen.mockResolvedValue(undefined); api.closeProject.mockResolvedValue(undefined);
  useFileQueryStore.getState().cancel();
  useProjectStore.setState({ activeProjectId: source.projectId });
  useTabStore.setState({ tabs: [], activeTabId: null });
  vi.resetAllMocks();
  api.list.mockResolvedValue([provider]); api.close.mockResolvedValue(undefined); api.closeProject.mockResolvedValue(undefined); api.cancelOpen.mockResolvedValue(undefined);
  api.query.mockResolvedValue([{ columns: [], rows: [], affectedRows: 0, executionTimeMs: 1 }]);
  api.pick.mockResolvedValue(session); api.status.mockResolvedValue(session);
});
describe("file query workspace ownership", () => {
  it("keeps edited SQL on reopening and releases the old snapshot before opening a replacement", async () => {
    const id = fileTab(); useTabStore.getState().updateTabSql(id, "SELECT count(*) FROM data");
    const fresh = { ...session, id: "replacement" }; api.pick.mockResolvedValue(fresh);
    await useFileQueryStore.getState().show(source, id); await useFileQueryStore.getState().open();
    expect(api.close).toHaveBeenCalledWith(session);
    expect(api.close.mock.invocationCallOrder[0]).toBeLessThan(api.pick.mock.invocationCallOrder[0]);
    expect(useTabStore.getState().tabs).toHaveLength(1); expect(useTabStore.getState().tabs[0].id).toBe(id);
    expect(api.query).toHaveBeenCalledWith(fresh, "SELECT count(*) FROM data");
  });
  it("discards source metadata returned after opening was cancelled", async () => {
    const pending = deferred<unknown[]>(); api.query.mockReturnValue(pending.promise);
    await useFileQueryStore.getState().show(source); const opening = useFileQueryStore.getState().open();
    await Promise.resolve(); useFileQueryStore.getState().cancel(); pending.resolve([{ columns: [{ name: "id", data_type: "BIGINT" }], rows: [] }]); await opening;
    expect(useTabStore.getState().tabs).toHaveLength(0); expect(api.close).toHaveBeenCalledWith(session);
  });
  it("offers an independent open-file command for the active project", async () => {
    await createOpenFileQueryAction().run();
    expect(useFileQueryStore.getState().source).toEqual(source);
  });
  it("only offers active launchable packages granted the source format", async () => {
    api.list.mockResolvedValue([provider, { ...provider, active: false }, { ...provider, runtimeReady: false }, { ...provider, status: "untrusted" }, { ...provider, capabilities: { fileQueryFormats: ["json"] } }]);
    await useFileQueryStore.getState().show({ kind: "project", projectId: source.projectId, expectedRoot: "C:/project", relativePath: "sales.csv" });
    expect(useFileQueryStore.getState().providers).toEqual([provider]);
  });
  it("runs the snapshot in a connection-free query tab", async () => {
    await useFileQueryStore.getState().show(source); await useFileQueryStore.getState().open();
    const tab = useTabStore.getState().tabs[0];
    expect(tab.connectionId).toBeUndefined(); expect(tab.fileRelativePath).toBeUndefined();
    expect(api.query).toHaveBeenCalledWith(session, session.initialSql); expect(api.databaseQuery).not.toHaveBeenCalled();
  });
  it("cancels just the pending request and disposes its late result", async () => {
    const pending = deferred<FileQuerySession>(); api.pick.mockReturnValue(pending.promise);
    const other = fileTab();
    await useFileQueryStore.getState().show(source); const opening = useFileQueryStore.getState().open();
    const requestId = useFileQueryStore.getState().requestId;
    useFileQueryStore.getState().cancel(); pending.resolve({ ...session, id: "late" }); await opening;
    expect(api.cancelOpen).toHaveBeenCalledWith(source.projectId, requestId);
    expect(api.close).toHaveBeenCalledWith(expect.objectContaining({ id: "late" }));
    expect(useTabStore.getState().tabs.find(t => t.id === other)?.fileQuery?.session?.id).toBe(session.id);
    expect(api.closeProject).not.toHaveBeenCalled();
  });
  it("discards a picker result after changing projects", async () => {
    const pending = deferred<FileQuerySession>(); api.pick.mockReturnValue(pending.promise);
    await useFileQueryStore.getState().show(source); const opening = useFileQueryStore.getState().open();
    useProjectStore.setState({ activeProjectId: "another-project" }); pending.resolve(session); await opening;
    expect(api.closeProject).toHaveBeenCalledWith(source.projectId); expect(api.close).toHaveBeenCalledWith(session);
    expect(useTabStore.getState().tabs).toHaveLength(0);
  });
  it("retains a healthy session after SQL errors and ends it when the Host reports closure", async () => {
    const id = fileTab(); api.query.mockRejectedValue(new Error("Unknown column"));
    await useTabStore.getState().runTabQuery(id, "");
    expect(useTabStore.getState().tabs[0].fileQuery?.session).toEqual(session);
    api.status.mockResolvedValue(null); await useTabStore.getState().runTabQuery(id, "");
    expect(useTabStore.getState().tabs[0].fileQuery?.session).toBeNull();
  });
  it("ignores a cancelled query's late success", async () => {
    const pending = deferred<unknown[]>(); api.query.mockReturnValue(pending.promise);
    const id = fileTab(); const query = useTabStore.getState().runTabQuery(id, "");
    await useTabStore.getState().cancelTabQuery(id); pending.resolve([]); await query;
    const tab = useTabStore.getState().tabs[0]; expect(tab.fileQuery?.session).toBeNull(); expect(tab.results).toBeNull(); expect(tab.isExecuting).toBe(false);
  });
  it("closing a running file tab uses its session and reopened history has no live resource", () => {
    fileTab(); const tab = { ...useTabStore.getState().tabs[0], runningQueryId: "file:pending", isExecuting: true };
    releaseTabRuntimeResources([tab]);
    expect(api.close).toHaveBeenCalledWith(session); expect(api.databaseCancel).not.toHaveBeenCalled();
    const restored = tabAfterReleasingRuntimePayload(tab); expect(restored.fileQuery?.session).toBeNull(); expect(restored.sql).toBe(session.initialSql);
  });
});

it("withdraws old-project file sessions and diagnostics immediately while preserving SQL",()=>{
  const id=fileTab();useTabStore.setState(state=>({tabs:state.tabs.map(tab=>({...tab,isExecuting:true,runningQueryId:"file:old",lspDiagnostics:[{message:"old field",range:{start:{line:0,character:0},end:{line:0,character:1}}}]}))}));
  useProjectStore.setState({activeProjectId:"other-project"});const tab=useTabStore.getState().tabs.find(value=>value.id===id)!;
  expect(tab.fileQuery?.session).toBeNull();expect(tab.sql).toBe(session.initialSql);expect(tab.isExecuting).toBe(false);expect(tab.runningQueryId).toBeNull();expect(tab.lspDiagnostics).toEqual([]);expect(api.closeProject).toHaveBeenCalledWith(source.projectId);
});
