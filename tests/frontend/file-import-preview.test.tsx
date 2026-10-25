// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CsvImportDialog } from "@/components/workspace/CsvImportDialog";
import { JsonImportDialog } from "@/components/workspace/JsonImportDialog";
import { CsvImportSession } from "@/features/table-import/csvImportSession";

let root: Root, container: HTMLDivElement;
const columns = [{ name: "id", data_type: "INTEGER", is_nullable: false, is_primary_key: true }, { name: "name", data_type: "TEXT", is_nullable: true, is_primary_key: false }];
function button(label: string) {
  const result = [...document.body.querySelectorAll("button")].find(item => item.textContent?.includes(label));
  if (!result) throw new Error(`Missing button: ${label}`);
  return result;
}
beforeEach(() => { vi.useFakeTimers(); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });
it("prepares a truncated native CSV with the reviewed mapping/options without fetching all worker rows", async () => {
  const rows = vi.spyOn(CsvImportSession.prototype, "rows");
  const onImport = vi.fn(), onPrepare = vi.fn();
  const file = new File(["id,name\n1,Ada\n2,Lin\n"], "people.csv");
  await act(async () => root.render(<CsvImportDialog open file={file} tableName="people" columns={columns} isSubmitting={false} isNativeSource nativePreviewTruncated onClose={vi.fn()} onImport={onImport} onPrepareResumable={onPrepare} />));
  for (let i = 0; i < 4; i++) await act(async () => vi.advanceTimersByTimeAsync(100));
  expect(button("Prepare resumable").disabled).toBe(false);
  await act(async () => button("Prepare resumable").click());
  expect(onPrepare).toHaveBeenCalledWith(expect.objectContaining({ delimiter: ",", firstRowHeader: true, titleRow: 1, dataStartRow: 2, lastDataRow: 0, emptyFieldsAsNull: true, trimValues: false, encoding: "utf-8", columnMapping: [{ sourceIndex: 0, targetColumn: "id" }, { sourceIndex: 1, targetColumn: "name" }] }), "append");
  expect(rows).not.toHaveBeenCalled(); expect(onImport).not.toHaveBeenCalled();
  expect(button("Import 2 rows").disabled).toBe(true);
});
it.each(["JSON", "XLSX"] as const)("keeps the ordinary %s import separate from opt-in preparation", async format => {
  const onImport = vi.fn(), onPrepare = vi.fn();
  const preview = { fileName: `people.${format.toLowerCase()}`, contentDigest: "a".repeat(64), sourceColumns: ["id", "name"], sampleRows: [{ id: 1, name: "Ada" }], totalRows: 1, truncated: false };
  const props: ComponentProps<typeof JsonImportDialog> = { open: true, preview, format, tableName: "people", columns, isSubmitting: false, onClose: vi.fn(), onImport, onPrepareResumable: onPrepare };
  await act(async () => root.render(<JsonImportDialog {...props} />));
  await act(async () => button("Prepare resumable").click());
  expect(onPrepare).toHaveBeenCalledExactlyOnceWith("append"); expect(onImport).not.toHaveBeenCalled();
});
it("does not offer resumable import without an eligible native source/target callback", async () => {
  await act(async () => root.render(<JsonImportDialog open preview={null} format="JSON" tableName="people" columns={columns} isSubmitting={false} onClose={vi.fn()} onImport={vi.fn()} />));
  expect(document.body.textContent).not.toContain("Prepare resumable");
});
