// @vitest-environment happy-dom
import { useDataCompareSession } from "@/features/data-compare/hooks/useDataCompareSession";
import { createCompareFilterActions } from "@/features/data-compare/model/createCompareFilterActions";
import { createCompareSyncActions } from "@/features/data-compare/model/createCompareSyncActions";
import { createFullComparisonActions } from "@/features/data-compare/model/createFullComparisonActions";
import {
  allSyncRowIds,
  selectSyncRows,
} from "@/features/data-compare/model/syncSelection";
import type { DataCompareSource } from "@/lib/dataCompare";
import type {
  TableDataCompareResult,
  TableDataCompareSyncPreview,
  TableDataCompareSyncReceipt,
} from "@/services/tauri/types/tableCompare";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({
  compare: vi.fn(),
  preview: vi.fn(),
  execute: vi.fn(),
  cancel: vi.fn(),
  copy: vi.fn(),
  id: 0,
}));
vi.mock("@/services/tauri", () => ({
  tableService: {
    createTableDataCompareId: () => `comparison-${++services.id}`,
    compareTableDataFull: services.compare,
    previewTableDataCompareSync: services.preview,
    executeTableDataCompareSync: services.execute,
    cancelTableDataCompare: services.cancel,
    listenTableDataCompareProgress: async () => () => {},
  },
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function source(id: string): DataCompareSource {
  return {
    id,
    tabId: id,
    label: id,
    sourceKind: "table",
    resultIndex: 0,
    connectionId: id,
    databaseName: "app",
    schemaName: "public",
    objectName: "users",
    columns: [
      { name: "id", dataType: "int" },
      { name: "name", dataType: "text" },
    ],
    rows: [[1, id]],
    suggestedKeyColumns: ["id"],
    truncated: false,
    capturedAt: 1,
  };
}
const comparison: TableDataCompareResult = {
  added: [{ key: "1", values: { id: 1, name: "Ada" } }],
  removed: [],
  modified: [],
  addedCount: 1,
  removedCount: 0,
  modifiedCount: 0,
  equalCount: 0,
  sourceRowCount: 1,
  targetRowCount: 0,
  comparedKeyCount: 1,
  batchSize: 100,
  detailLimitPerStatus: 100,
  detailsTruncated: false,
  degradationLevel: "full",
  samplingRate: 1,
  confidenceScore: 1,
  verificationMethod: "full_keyset",
  countsExact: true,
  sampledKeyCount: 1,
};
function preview(label: string): TableDataCompareSyncPreview {
  return {
    insertCount: 1,
    updateCount: 0,
    deleteCount: 0,
    statementCount: 1,
    statements: [label],
    sql: label,
    planDigest: label,
    reviewOnly: true,
    canExecute: true,
    planToken: label,
    expiresAt: Date.now() + 60_000,
    confirmationText: `SYNC ${label}`,
    warnings: [],
  };
}
const receipt: TableDataCompareSyncReceipt = {
  insertCount: 1,
  updateCount: 0,
  deleteCount: 0,
  rowsAffected: 1,
  planDigest: "old",
};
type Props = Parameters<typeof useDataCompareSession>[0] & {
  left: DataCompareSource;
  right: DataCompareSource;
};
let session: ReturnType<typeof useDataCompareSession>;
let sync: ReturnType<typeof createCompareSyncActions>;
let full: ReturnType<typeof createFullComparisonActions>;
let filter: ReturnType<typeof createCompareFilterActions>;
function Harness(props: Props) {
  session = useDataCompareSession(props);
  const columns = props.left.columns
    .map((column) => column.name)
    .filter(
      (column) =>
        session.keyColumns.includes(column) ||
        !session.ignoredColumns.has(column),
    );
  sync = createCompareSyncActions({
    ...session,
    canPreviewSync:
      !!session.fullComparisonPayload && session.selectedSyncRows.size > 0,
    selectedComparisonPayload: session.fullComparisonPayload
      ? selectSyncRows(session.fullComparisonPayload, session.selectedSyncRows)
      : null,
    rightConnection: { driver: "postgres" },
    right: props.right,
    effectiveColumns: columns,
  });
  full = createFullComparisonActions({
    ...session,
    canCompareFull: true,
    leftConnection: { driver: "postgres" },
    rightConnection: { driver: "postgres" },
    left: props.left,
    right: props.right,
    effectiveColumns: columns,
  });
  filter = createCompareFilterActions(session);
  return null;
}
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  services.cancel.mockResolvedValue(undefined);
  services.compare.mockResolvedValue(comparison);
  services.preview.mockResolvedValue(preview("ready"));
  services.execute.mockResolvedValue(receipt);
  services.copy.mockResolvedValue(undefined);
  vi.spyOn(navigator.clipboard, "writeText").mockImplementation(services.copy);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function mount(scopeId = "one") {
  const props = { scopeId, left: source("left"), right: source("right") };
  await act(async () => root.render(<Harness {...props} />));
  await seed();
  return props;
}
async function seed() {
  await act(async () => {
    session.setFullComparisonPayload(comparison);
    session.setSelectedSyncRows(allSyncRowIds(comparison));
  });
}
async function readyToExecute() {
  await act(async () => sync.previewSync());
  await act(async () =>
    session.setSyncConfirmation(session.syncPreview!.confirmationText),
  );
}

it("does not publish an old preview into another comparison tab with the same sources", async () => {
  const props = await mount(),
    pending = deferred<TableDataCompareSyncPreview>();
  services.preview.mockReturnValue(pending.promise);
  await act(async () => {
    void sync.previewSync();
  });
  await act(async () => root.render(<Harness {...props} scopeId="next" />));
  expect(session.isPlanningSync).toBe(false);
  await act(async () => pending.resolve(preview("old")));
  expect(session.syncPreview).toBeNull();
});
it("keeps the newest preview busy when an older request fails", async () => {
  await mount();
  const first = deferred<TableDataCompareSyncPreview>(),
    next = deferred<TableDataCompareSyncPreview>();
  services.preview
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(next.promise);
  await act(async () => {
    void sync.previewSync();
  });
  await act(async () => {
    void sync.previewSync();
  });
  await act(async () => first.reject(new Error("old failure")));
  expect(session.isPlanningSync).toBe(true);
  expect(session.syncPreviewError).toBeNull();
  await act(async () => next.resolve(preview("next")));
  expect(session.syncPreview?.planToken).toBe("next");
  expect(session.isPlanningSync).toBe(false);
});
it("invalidates a pending preview immediately when sync row selection changes", async () => {
  await mount();
  const request = deferred<TableDataCompareSyncPreview>();
  services.preview.mockReturnValue(request.promise);
  await act(async () => {
    void sync.previewSync();
  });
  await act(async () => sync.clearSyncRows());
  await act(async () => request.resolve(preview("obsolete-selection")));
  expect(session.syncPreview).toBeNull();
  expect(session.isPlanningSync).toBe(false);
  expect(session.selectedSyncRows.size).toBe(0);
});
it("cancels full comparison and ignores its result after a compared column changes", async () => {
  await mount();
  const request = deferred<TableDataCompareResult>();
  services.compare.mockReturnValue(request.promise);
  await act(async () => {
    void full.runFullComparison();
  });
  const id = session.activeCompareIdRef.current;
  await act(async () => filter.toggleComparedColumn("name"));
  expect(services.cancel).toHaveBeenCalledWith(id);
  await act(async () => request.resolve(comparison));
  expect(session.fullComparisonPayload).toBeNull();
  expect(session.isComparingFull).toBe(false);
  expect(session.ignoredColumns.has("name")).toBe(true);
});
it("does not clear the next target's plan when an old execution finishes", async () => {
  const props = await mount();
  await readyToExecute();
  const request = deferred<TableDataCompareSyncReceipt>();
  services.execute.mockReturnValue(request.promise);
  await act(async () => {
    void sync.executeSync();
  });
  await act(async () =>
    root.render(<Harness {...props} right={source("next-target")} />),
  );
  await seed();
  await act(async () => sync.previewSync());
  const nextPlan = session.syncPreview;
  await act(async () => request.resolve(receipt));
  expect(session.syncPreview).toBe(nextPlan);
  expect(session.fullComparisonPayload).toBe(comparison);
  expect(session.syncReceipt).toBeNull();
  expect(session.isExecutingSync).toBe(false);
});
it("admits only one execution before React rerenders and blocks overlapping preview and comparison", async () => {
  await mount();
  await readyToExecute();
  const request = deferred<TableDataCompareSyncReceipt>();
  services.execute.mockReturnValue(request.promise);
  await act(async () => {
    const execute = sync.executeSync;
    void execute();
    void execute();
    void sync.previewSync();
    void full.runFullComparison();
  });
  expect(services.execute).toHaveBeenCalledTimes(1);
  expect(services.preview).toHaveBeenCalledTimes(1);
  expect(services.compare).not.toHaveBeenCalled();
  await act(async () => request.reject(new Error("execution failed")));
  expect(session.isExecutingSync).toBe(false);
  expect(session.syncPreview).toBeNull();
  expect(session.fullComparisonPayload).toBeNull();
  expect(session.syncPreviewError).toContain("Compare and preview again");
});
it("ignores a clipboard failure after the reviewed plan has been replaced", async () => {
  await mount();
  await readyToExecute();
  const request = deferred<void>();
  services.copy.mockReturnValue(request.promise);
  await act(async () => {
    void sync.copySyncSql();
  });
  await act(async () => sync.previewSync());
  await act(async () => request.reject(new Error("old clipboard failure")));
  expect(session.syncPreviewError).toBeNull();
  expect(session.syncPreview?.planToken).toBe("ready");
});

it("does not preview stale results while a new full comparison starts before React rerenders", async () => {
  await mount();
  const request = deferred<TableDataCompareResult>();
  services.compare.mockReturnValue(request.promise);
  await act(async () => {
    void full.runFullComparison();
    void sync.previewSync();
  });
  expect(services.preview).not.toHaveBeenCalled();
  await act(async () => request.resolve(comparison));
  await act(async () => sync.previewSync());
  expect(services.preview).toHaveBeenCalledTimes(1);
});

it("rejects retained operation callbacks after the comparison page unmounts", async () => {
  await mount();
  await readyToExecute();
  const retained = {
    compare: full.runFullComparison,
    preview: sync.previewSync,
    execute: sync.executeSync,
    copy: sync.copySyncSql,
  };
  await act(async () => root.render(null));
  await act(async () => {
    await retained.compare();
    await retained.preview();
    await retained.execute();
    await retained.copy();
  });
  expect(services.compare).not.toHaveBeenCalled();
  expect(services.execute).not.toHaveBeenCalled();
  expect(services.copy).not.toHaveBeenCalled();
  expect(services.preview).toHaveBeenCalledTimes(1);
});

it("rejects a retained preview callback after switching to a new source pair", async () => {
  const props = await mount();
  const retained = sync.previewSync;
  await act(async () =>
    root.render(<Harness {...props} right={source("next-target")} />),
  );
  await seed();
  await act(async () => retained());
  expect(services.preview).not.toHaveBeenCalled();
});

it("rejects a retained execute callback after its reviewed plan is invalidated", async () => {
  await mount();
  await readyToExecute();
  const retained = sync.executeSync;
  await act(async () => sync.clearSyncRows());
  await act(async () => retained());
  expect(services.execute).not.toHaveBeenCalled();
});

it("does not let an old cancel callback cancel a replacement comparison", async () => {
  await mount();
  const old = deferred<TableDataCompareResult>(),
    current = deferred<TableDataCompareResult>();
  services.compare
    .mockReturnValueOnce(old.promise)
    .mockReturnValueOnce(current.promise);
  await act(async () => {
    void full.runFullComparison();
  });
  const retainedCancel = full.cancelFullComparison;
  const oldId = session.activeCompareIdRef.current;
  await act(async () => {
    void full.runFullComparison();
  });
  const currentId = session.activeCompareIdRef.current;
  expect(currentId).not.toBe(oldId);
  expect(services.cancel).toHaveBeenCalledExactlyOnceWith(oldId);
  await act(async () => retainedCancel());
  expect(services.cancel).toHaveBeenCalledTimes(1);
  await act(async () => {
    old.resolve(comparison);
    current.resolve(comparison);
  });
});
