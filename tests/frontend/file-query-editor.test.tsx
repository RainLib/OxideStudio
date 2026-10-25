// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FileQueryEditor } from "@/features/file-query/FileQueryEditor";
import { useTabStore } from "@/store/useTabStore";
import { APP_EVENT_RUN_QUERY } from "@/lib/actionEvents";
import type { FileQuerySession } from "@/services/tauri/file-query.service";

const api = vi.hoisted(() => ({ status: vi.fn(), query: vi.fn(), closeProject: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/services/tauri/file-query.service", () => ({ fileQueryService: api }));
vi.mock("@monaco-editor/react", () => ({ useMonaco: () => null }));
vi.mock("@/features/query-editor/hooks/useEditorPresentation", () => ({ useEditorPresentation: () => ({ editorOptions: {} }) }));
vi.mock("@/features/query-editor/ui/QueryEditorSurface", () => ({ QueryEditorSurface: () => <div>SQL editor surface</div> }));
let root: Root;
let element: HTMLDivElement;
const session: FileQuerySession = { id: "first", projectId: "sqls", fileName: "data.csv", format: "csv", sourceBytes: 12, driverId: "duckdb", packageVersion: "0.1.0", languageId: "sql", csvHeader: "auto", initialSql: "SELECT * FROM data" };
function add(id: string) {
  return useTabStore.getState().createTab("query", "data.csv", session.initialSql, { fileQuery: { source: { kind: "picker", projectId: "sqls" }, session: { ...session, id }, driverId: "duckdb", packageVersion: "0.1.0", csvHeader: "auto" } });
}
beforeEach(() => {
  vi.clearAllMocks(); api.status.mockImplementation(async session => session); api.query.mockResolvedValue([]);
  useTabStore.setState({ tabs: [], activeTabId: null });
  element = document.createElement("div"); document.body.append(element); root = createRoot(element);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => { await act(async () => root.unmount()); element.remove(); });
it("global Run executes only the active file editor when split editors are mounted", async () => {
  const first = add("first"); const second = add("second");
  await act(async () => root.render(<>{useTabStore.getState().tabs.map(tab => <FileQueryEditor key={tab.id} tab={tab} />)}</>));
  expect(useTabStore.getState().activeTabId).toBe(second);
  await act(async () => { window.dispatchEvent(new Event(APP_EVENT_RUN_QUERY)); });
  expect(api.query).toHaveBeenCalledTimes(1); expect(api.query).toHaveBeenCalledWith(expect.objectContaining({ id: "second" }), session.initialSql);
  expect(useTabStore.getState().tabs.find(t => t.id === first)?.isExecuting).toBe(false);
});
it("an ended Host session disables future execution without touching the saved SQL", async () => {
  add("first"); api.status.mockResolvedValue(null);
  await act(async () => root.render(<FileQueryEditor tab={useTabStore.getState().tabs[0]} />));
  expect(useTabStore.getState().tabs[0].fileQuery?.session).toBeNull();
  expect(useTabStore.getState().tabs[0].sql).toBe(session.initialSql);
});
it("a transient status failure preserves the session", async () => {
  add("first"); api.status.mockRejectedValue(new Error("Transport unavailable"));
  await act(async () => root.render(<FileQueryEditor tab={useTabStore.getState().tabs[0]} />));
  expect(useTabStore.getState().tabs[0].fileQuery?.session?.id).toBe("first");
});
