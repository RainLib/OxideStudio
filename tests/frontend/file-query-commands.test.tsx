// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useFileQueryCommands } from "@/features/file-query/useFileQueryCommands";
import { registerLspCoreProviders } from "@/features/query-editor/hooks/useLspCoreProviderCoordinator";
import { LspClient } from "@/services/lsp/client";
import type { FileQueryFormatResult } from "@/features/file-query/model";
import { fileQuerySchema } from "@/features/file-query/useFileQueryIntelligence";
import { useTabStore } from "@/store/useTabStore";
import { APP_EVENT_FORMAT_SQL, APP_EVENT_RUN_CURRENT } from "@/lib/actionEvents";
import type { FileQuerySession } from "@/services/tauri/file-query.service";
import { defaultDatabaseCapabilities } from "@/lib/databaseDialect";

const api = vi.hoisted(() => ({ statement: vi.fn(), query: vi.fn(), invoke: vi.fn(), closeProject: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: api.invoke }));
vi.mock("@/services/tauri/file-query.service", () => ({ fileQueryService: api }));
const session: FileQuerySession = { id: "a1e2aab5-77bb-454b-9407-d2741b25241f", projectId: "sqls", fileName: "data.csv", format: "csv", sourceBytes: 12, driverId: "duckdb", packageVersion: "0.1.0", languageId: "duckdb", csvHeader: "auto", initialSql: "SELECT * FROM data", capabilities: { ...defaultDatabaseCapabilities("sqlite"), driver: "duckdb", lspLanguageId: "duckdb" } };
let root: Root, element: HTMLDivElement, id: string, sql: string, version: number, selection: string;
const formatResultRef: { current: FileQueryFormatResult | null } = { current: null };
const format = vi.fn();
const model = { getValue: () => sql, getValueInRange: () => selection, getOffsetAt: ({ column }: { column: number }) => column - 1, getVersionId: () => version };
const editor = { getModel: () => model, getPosition: () => ({ lineNumber: 1, column: sql.length }), getSelection: () => ({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: selection.length + 1 }), getAction: () => ({ run: format }) };
function Harness({ ready = true,liveReady }: { ready?: boolean;liveReady?:()=>boolean }) {
  useFileQueryCommands({ tab: useTabStore(state => state.tabs.find(t => t.id === id)!), editorRef: { current: editor }, mountedEditor: null, monaco: null, formatReady: ready,isFormatReady:liveReady, formatResultRef }); return null;
}
beforeEach(() => {
  vi.clearAllMocks(); formatResultRef.current = null; format.mockImplementation(async () => { formatResultRef.current = { ok: true }; }); sql = "SELECT '😀'; SELECT revenue FROM data"; version = 1; selection = "";
  api.query.mockResolvedValue([]); api.statement.mockResolvedValue({ sql: "SELECT revenue FROM data", startOffset: 13, endOffset: sql.length, statementIndex: 1, statementCount: 2 });
  useTabStore.setState({ tabs: [], activeTabId: null });
  id = useTabStore.getState().createTab("query", "data.csv", sql, { fileQuery: { source: { kind: "picker", projectId: "sqls" }, session, schema: [{ name: "revenue", data_type: "BIGINT" }], driverId: "duckdb", packageVersion: "0.1.0", csvHeader: "auto" } });
  element = document.createElement("div"); document.body.append(element); root = createRoot(element);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); });
it("resolves the current statement in the file session using UTF-16 editor offsets", async () => {
  await act(async () => root.render(<Harness />));
  await act(async () => { window.dispatchEvent(new Event(APP_EVENT_RUN_CURRENT)); });
  expect(api.statement).toHaveBeenCalledWith(session, sql, sql.length - 1);
  expect(api.query).toHaveBeenCalledWith(session, "SELECT revenue FROM data");
});
it("runs a selected expression without resolving a different statement", async () => {
  selection = "SELECT '😀'"; await act(async () => root.render(<Harness />));
  await act(async () => { window.dispatchEvent(new Event(APP_EVENT_RUN_CURRENT)); });
  expect(api.statement).not.toHaveBeenCalled(); expect(api.query).toHaveBeenCalledWith(session, selection);
});
it("discards late statement resolution after the document changes", async () => {
  let resolve!: (value: { sql: string }) => void; api.statement.mockReturnValue(new Promise(yes => { resolve = yes; }));
  await act(async () => root.render(<Harness />)); await act(async () => { window.dispatchEvent(new Event(APP_EVENT_RUN_CURRENT)); });
  version++; sql = "SELECT region FROM data";
  await act(async () => { useTabStore.getState().updateTabSql(id, sql); resolve({ sql: "SELECT revenue FROM data" }); });
  expect(api.query).not.toHaveBeenCalled();
});
it("routes Format to the active editor only after its scoped intelligence is ready", async () => {
  await act(async () => root.render(<Harness ready={false} />)); await act(async () => { window.dispatchEvent(new Event(APP_EVENT_FORMAT_SQL)); });
  expect(format).not.toHaveBeenCalled(); expect(useTabStore.getState().tabs[0].error).toContain("SQL");
  await act(async () => root.render(<Harness />)); await act(async () => { window.dispatchEvent(new Event(APP_EVENT_FORMAT_SQL)); });
  expect(format).toHaveBeenCalledTimes(1);
  expect(useTabStore.getState().tabs[0].error).toBeNull();
  await act(async () => { useTabStore.setState({ activeTabId: "another" }); });
  await act(async () => { window.dispatchEvent(new Event(APP_EVENT_FORMAT_SQL)); }); expect(format).toHaveBeenCalledTimes(1);
});
it("builds source metadata with the actual UUID and no database definition URI", () => {
  const schema = fileQuerySchema(useTabStore.getState().tabs[0])[0];
  expect(schema.id).toBe(session.id); expect(schema.source_uri).toBeNull();
  expect(schema.tables[0].columns[0].data_type).toBe("BIGINT"); expect(schema.tables[0].source_location).toBeNull();
});

it("reports real provider sync and formatting failures until a successful retry", async () => {
  const providerMap = new Map<string, any>();
  const languages = new Proxy({}, { get: (_target, name) => (_language: string, provider: any) => { providerMap.set(String(name), provider); return { dispose() {} }; } });
  const syncDocument = vi.fn().mockRejectedValueOnce(new Error("Document sync failed")).mockResolvedValue(undefined);
  let formatRequests = 0;
  api.invoke.mockImplementation(async (command: string) => {
    if (command === "lsp_initialize") return "initialized";
    if (command === "lsp_formatting") {
      if (++formatRequests === 1) throw new Error("Formatting service failed");
      return [];
    }
    throw new Error(`Unexpected LSP command: ${command}`);
  });
  const lspClient = new LspClient("document:file-query-format-regression");
  await lspClient.initialize("/fixture/sql-lsp");
  const coordinator = registerLspCoreProviders({ canUseLsp: true, documentUri: "oxide-file-query://test.sql", editorLanguageId: "sql", monaco: { languages }, lspClient,
    syncDocument, onDocumentFormatResult: result => { formatResultRef.current = result; } });
  const provider = providerMap.get("registerDocumentFormattingEditProvider");
  // Monaco can resolve its action after a provider returns no edits. Exercise
  // that actual provider, rather than making the editor action reject directly.
  format.mockImplementation(() => provider.provideDocumentFormattingEdits({ ...model, uri: { toString: () => "oxide-file-query://test.sql" } }, {}));
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => { window.dispatchEvent(new Event(APP_EVENT_FORMAT_SQL)); });
    expect(useTabStore.getState().tabs[0].error).toBe("Document sync failed");
    expect(formatRequests).toBe(0);
    await act(async () => { window.dispatchEvent(new Event(APP_EVENT_FORMAT_SQL)); });
    expect(useTabStore.getState().tabs[0].error).toBe("Formatting service failed");
    await act(async () => { window.dispatchEvent(new Event(APP_EVENT_FORMAT_SQL)); });
    expect(useTabStore.getState().tabs[0].error).toBeNull();
    expect(formatRequests).toBe(2);
  } finally { consoleError.mockRestore(); coordinator.dispose(); }
});

it("reads live configuration readiness before React updates its format-ready prop",async()=>{
  await act(async()=>root.render(<Harness ready liveReady={()=>false}/>));await act(async()=>window.dispatchEvent(new Event(APP_EVENT_FORMAT_SQL)));expect(format).not.toHaveBeenCalled();
});
it("does not report an old formatting failure into a replacement file session",async()=>{
  let reject!:(reason:Error)=>void;format.mockImplementation(()=>new Promise((_yes,no)=>{reject=no;}));await act(async()=>root.render(<Harness/>));await act(async()=>window.dispatchEvent(new Event(APP_EVENT_FORMAT_SQL)));
  await act(async()=>{useTabStore.setState(state=>({tabs:state.tabs.map(tab=>({...tab,error:"new file state",fileQuery:{...tab.fileQuery!,session:{...session,id:"replacement"}}}))}));reject(new Error("old format error"));});expect(useTabStore.getState().tabs[0].error).toBe("new file state");
});
it("does not report a late current-statement failure after a file session is replaced",async()=>{
  let reject!:(reason:Error)=>void;api.statement.mockImplementation(()=>new Promise((_yes,no)=>{reject=no;}));await act(async()=>root.render(<Harness/>));await act(async()=>window.dispatchEvent(new Event(APP_EVENT_RUN_CURRENT)));
  await act(async()=>{useTabStore.setState(state=>({tabs:state.tabs.map(tab=>({...tab,error:"replacement",fileQuery:{...tab.fileQuery!,session:{...session,id:"replacement"}}}))}));reject(new Error("old statement error"));});expect(useTabStore.getState().tabs[0].error).toBe("replacement");expect(api.query).not.toHaveBeenCalled();
});
