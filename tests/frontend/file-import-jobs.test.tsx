// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useFileImportJobs } from "@/features/table-import/useFileImportJobs";
import { FileImportJobsDialog } from "@/features/table-import/FileImportJobsDialog";
import { useFileImportNavigation } from "@/features/table-import/fileImportNavigation";
import type { LargeTransferPreview, LargeTransferSummary } from "@/services/tauri/types/largeTransfer";
import type { FileImportPreparationSummary, PrepareTableImportJobRequest } from "@/services/tauri/types/resumableImport";

const api = vi.hoisted(() => Object.fromEntries(["preparations", "list", "get", "preview", "prepare", "resumePreparation", "discardPreparation", "cancelPreparation", "start", "pause", "cancel"].map(key => [key, vi.fn()])));
vi.mock("@/services/tauri/file-import-jobs.service", () => ({ fileImportJobService: api }));
vi.mock("@/store/useConnectionStore", () => ({ useConnectionStore: (selector: (state: unknown) => unknown) => selector({ connections: [{ id: "target", name: "Warehouse" }] }) }));
const request: PrepareTableImportJobRequest = { projectId: "p", importId: "import", connectionId: "target", driver: "sqlite", schema: "main", table: "items", filePath: "C:/private/items.json", format: "json", mode: "truncate", expectedFileDigest: "a".repeat(64) };
const prep: FileImportPreparationSummary = { id: "one", importId: "import", phase: "normalizing", sourceBytes: 12345, normalizedRows: 5000, active: false, display: { fileName: "items.json", format: "json", connectionId: "target", schema: "main", table: "items", mode: "truncate" } };
const job: LargeTransferSummary = { id: "one", projectId: "p", source: { connectionId: "file-import", driver: "file", schema: "", table: "data" }, target: { connectionId: "target", driver: "sqlite", schema: "main", table: "items" }, mode: "overwrite", phase: "awaitingReview", sourceRows: 12001, rowsStaged: 0, batches: 0, snapshotBytes: 12345, reviewReady: true, createdAt: 1700000000000, updatedAt: 1700000000000 };
const review: LargeTransferPreview = { job, confirmationToken: "IMPORT ABC123", targetRowsBefore: 12, mappedColumns: [], skippedColumns: [], warnings: [], fileImport: { fileName: "items.json", format: "json", sourceDigest: "a".repeat(64), normalizedDigest: "b".repeat(64), columns: [], options: {} } };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
let root: Root, container: HTMLDivElement;
let state: ReturnType<typeof useFileImportJobs>;
function Harness({ open = true, projectId = "p" }: { open?: boolean; projectId?: string }) { state = useFileImportJobs(open, projectId); return null; }
async function render(open = true, projectId = "p") { await act(async () => root.render(<Harness open={open} projectId={projectId} />)); }
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  useFileImportNavigation.getState().close();
  api.preparations.mockResolvedValue({ preparations: [prep], nextCursor: null });
  api.list.mockResolvedValue({ jobs: [], nextCursor: null }); api.preview.mockResolvedValue(review);
  api.resumePreparation.mockResolvedValue(review); api.prepare.mockResolvedValue(review); api.start.mockResolvedValue({ ...job, phase: "copying" });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });

it("continues an interrupted preparation, then requires a fresh exact token before starting", async () => {
  await render();
  expect(state.preparation?.normalizedRows).toBe(5000);
  await act(async () => state.resumePreparation());
  expect(api.resumePreparation).toHaveBeenCalledWith("p", "one");
  expect(state.controller.review?.fileImport?.fileName).toBe("items.json");
  expect(api.start).not.toHaveBeenCalled();
  await act(async () => state.controller.start()); expect(api.start).not.toHaveBeenCalled();
  await act(async () => state.controller.setConfirmation("IMPORT ABC123"));
  await act(async () => state.controller.start());
  expect(api.start).toHaveBeenCalledExactlyOnceWith("p", "one", "IMPORT ABC123");
});
it("does not import or reveal a stale preparation result after switching project", async () => {
  const pending = deferred<LargeTransferPreview>(); api.resumePreparation.mockReturnValue(pending.promise);
  await render(); let work!: Promise<void>;
  await act(async () => { work = state.resumePreparation(); });
  api.preparations.mockResolvedValue({ preparations: [] }); await render(true, "other");
  await act(async () => { pending.resolve(review); await work; });
  expect(state.controller.jobs).toEqual([]); expect(state.action).toBeNull(); expect(api.start).not.toHaveBeenCalled();
});
it("allows cancellation while a long resume call is still waiting", async () => {
  const pending = deferred<LargeTransferPreview>(); api.resumePreparation.mockReturnValue(pending.promise);
  await render(); let work!: Promise<void>; await act(async () => { work = state.resumePreparation(); });
  api.preparations.mockResolvedValue({ preparations: [{ ...prep, active: true }] });
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  await act(async () => state.stopPreparation());
  expect(api.cancelPreparation).toHaveBeenCalledWith("import"); expect(state.notice).toContain("Cancellation requested");
  await act(async () => { pending.resolve(review); await work; });
});
it("keeps a failed preparation available for retry and discards only the selected project/id", async () => {
  api.resumePreparation.mockRejectedValue(new Error("Target changed; prepare a new review"));
  await render(); await act(async () => state.resumePreparation());
  expect(state.error).toContain("Target changed"); expect(state.preparation?.id).toBe("one");
  expect(api.start).not.toHaveBeenCalled(); await act(async () => state.discardPreparation());
  expect(api.discardPreparation).toHaveBeenCalledWith("p", "one");
});
it("does not resume or discard an active leased preparation", async () => {
  api.preparations.mockResolvedValue({ preparations: [{ ...prep, active: true }] }); await render();
  await act(async () => { await state.resumePreparation(); await state.discardPreparation(); });
  expect(api.resumePreparation).not.toHaveBeenCalled(); expect(api.discardPreparation).not.toHaveBeenCalled();
});
it("retains paginated preparations and replaces duplicate ready handoffs with their one saved job", async () => {
  api.preparations.mockImplementation((_project, cursor) => Promise.resolve(cursor ? { preparations: [{ ...prep, id: "older" }] } : { preparations: [prep], nextCursor: "cursor" }));
  await render(); await act(async () => state.loadMorePreparations());
  expect(state.preparations.map(value => value.id)).toEqual(["one", "older"]);
  await act(async () => state.selectPreparation("one")); api.list.mockResolvedValue({ jobs: [job] });
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(state.preparations.map(value => value.id)).toEqual(["older"]);
  expect(state.preparation).toBeUndefined(); expect(state.controller.job?.id).toBe("one");
});
it("recovers a failed preparation poll and stops polling when closed", async () => {
  api.preparations.mockRejectedValueOnce(new Error("Cannot load saved preparations")); await render();
  expect(state.error).toContain("Cannot load"); await act(async () => vi.advanceTimersByTimeAsync(1000)); expect(state.error).toBeNull();
  await render(false); const calls = api.preparations.mock.calls.length;
  await act(async () => vi.advanceTimersByTimeAsync(5000)); expect(api.preparations).toHaveBeenCalledTimes(calls);
});
it("consumes a native preview request once under StrictMode and never auto-starts publication", async () => {
  useFileImportNavigation.getState().show("p", request);
  await act(async () => root.render(<StrictMode><FileImportJobsDialog projectId="p" /></StrictMode>));
  expect(api.prepare).toHaveBeenCalledExactlyOnceWith(request);
  expect(useFileImportNavigation.getState().pending).toBeNull(); expect(api.start).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain("C:/private");
});
