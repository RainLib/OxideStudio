// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TableDataDialogs } from "@/features/table-data/ui/TableDataDialogs";
import { useFileImportNavigation } from "@/features/table-import/fileImportNavigation";
const mocks = vi.hoisted(() => ({ csv: vi.fn(() => null), json: vi.fn(() => null), native: vi.fn(() => true) }));
vi.mock("@/components/workspace/CsvImportDialog", () => ({ CsvImportDialog: mocks.csv }));
vi.mock("@/components/workspace/JsonImportDialog", () => ({ JsonImportDialog: mocks.json }));
vi.mock("@/components/workspace/TableDataTransferDialog", () => ({ TableDataTransferDialog: () => null }));
vi.mock("@tauri-apps/api/core", async importOriginal => ({ ...await importOriginal<object>(), isTauri: mocks.native }));
let root: Root, container: HTMLDivElement;
const preview = { contentDigest: "b".repeat(64), fileName: "items.json", sourceColumns: [], sampleRows: [], totalRows: null, truncated: true };
function props(overrides = {}) {
  return { isTableReadOnly: false, driver: "sqlite", activeProjectId: "p", tabConnectionId: "target", activeTab: { id: "tab", schemaName: "main", tableName: "items", databaseName: "db", isExecuting: false }, connections: [{ id: "target", driver: "sqlite", name: "Local", url: "items.db" }], jsonImportSource: { nativePath: "C:/private/items.json", preview }, csvImportSource: null, xlsxImportSource: null, setCsvImportSource: vi.fn(), setJsonImportSource: vi.fn(), setXlsxImportSource: vi.fn(), importInputRef: { current: null }, ...overrides } as unknown as ComponentProps<typeof TableDataDialogs>;
}
beforeEach(() => { vi.clearAllMocks(); mocks.native.mockReturnValue(true); useFileImportNavigation.getState().close(); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
function jsonProps() { return mocks.json.mock.calls[0]?.[0] as unknown as { onPrepareResumable?: (mode: "truncate") => void }; }
it("carries the reviewed native digest, exact target and selected replace mode into preparation navigation", async () => {
  const parameters = props(); await act(async () => root.render(<TableDataDialogs {...parameters} />));
  jsonProps().onPrepareResumable!("truncate");
  expect(useFileImportNavigation.getState().pending).toEqual(expect.objectContaining({ projectId: "p", connectionId: "target", driver: "sqlite", schema: "main", table: "items", database: "db", mode: "truncate", format: "json", expectedFileDigest: preview.contentDigest, filePath: "C:/private/items.json", firstRowHeader: true }));
  expect(parameters.setJsonImportSource).toHaveBeenCalledWith(null);
});
it.each([
  { isTableReadOnly: true }, { driver: "postgres" }, { activeTab: { tableName: "items", schemaName: "main", isExecuting: true } },
  { connections: [] }, { connections: [{ id: "target", origin: "managed" }] },
  { connections: [{ id: "target", driverPackageVersion: "1.0.0" }] }, { connections: [{ id: "target", sshTunnel: { enabled: true } }] },
  { jsonImportSource: { nativePath: "C:/items.json", preview: { ...preview, contentDigest: "" } } },
])("keeps ineligible target/source out of the opt-in flow (%j)", async overrides => {
  await act(async () => root.render(<TableDataDialogs {...props(overrides)} />)); expect(jsonProps().onPrepareResumable).toBeUndefined();
});
it("hides native preparation in a browser-only session", async () => {
  mocks.native.mockReturnValue(false); await act(async () => root.render(<TableDataDialogs {...props()} />)); expect(jsonProps().onPrepareResumable).toBeUndefined();
});
