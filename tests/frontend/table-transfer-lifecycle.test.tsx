// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTransferProgress } from "@/features/table-transfer/hooks/useTransferProgress";
import { useTransferSourceInventory } from "@/features/table-transfer/hooks/useTransferSourceInventory";
import { useTransferDriverEligibility } from "@/features/table-transfer/hooks/useTransferDriverEligibility";
import type { TableDataTransferProgress } from "@/services/tauri/types";

const api = vi.hoisted(() => ({
  listen: vi.fn(),
  ready: vi.fn(),
  tables: vi.fn(),
  capabilities: vi.fn(),
}));
vi.mock("@/services/tauri", () => ({
  tableService: { listenTableDataTransferProgress: api.listen },
  schemaService: { getTables: api.tables },
  databaseService: { getDatabaseCapabilities: api.capabilities },
}));
vi.mock("@/store/useConnectionStore", () => ({
  ensureConnectionReady: api.ready,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let root: Root;
let container: HTMLDivElement;
let sourceState: ReturnType<typeof useTransferSourceInventory>;
let eligibility: ReturnType<typeof useTransferDriverEligibility>;

function ProgressHarness(props: Parameters<typeof useTransferProgress>[0]) {
  useTransferProgress(props);
  return null;
}
function SourceHarness(
  props: Parameters<typeof useTransferSourceInventory>[0],
) {
  sourceState = useTransferSourceInventory(props);
  return null;
}
function EligibilityHarness(
  props: Parameters<typeof useTransferDriverEligibility>[0],
) {
  eligibility = useTransferDriverEligibility(props);
  return null;
}

beforeEach(() => {
  vi.resetAllMocks();
  api.ready.mockResolvedValue({ status: "ready" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function progress(transferId: string): TableDataTransferProgress {
  return {
    transferId,
    rowsTransferred: 10,
    maxRows: 100,
    batches: 1,
    status: "running",
    terminal: false,
  };
}

describe("transfer progress subscription ownership", () => {
  it("releases a listener that finishes registering after the dialog closes", async () => {
    const pending = deferred<() => void>();
    const unlisten = vi.fn();
    const setProgress = vi.fn();
    const setError = vi.fn();
    api.listen.mockReturnValue(pending.promise);
    await act(async () =>
      root.render(
        <ProgressHarness
          open
          transferId="closing"
          setProgress={setProgress}
          setError={setError}
        />,
      ),
    );
    const listener = api.listen.mock.calls[0]![0];
    await act(async () => root.render(null));
    await act(async () => pending.resolve(unlisten));
    act(() => listener(progress("closing")));
    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(setProgress).not.toHaveBeenCalled();
    expect(setError).not.toHaveBeenCalled();
  });

  it("accepts only the active transfer and ignores callbacks from the previous subscription", async () => {
    const unlisten = vi.fn();
    api.listen.mockResolvedValue(unlisten);
    const props = {
      open: true,
      transferId: "first",
      setProgress: vi.fn(),
      setError: vi.fn(),
    };
    await act(async () => root.render(<ProgressHarness {...props} />));
    const first = api.listen.mock.calls[0]![0];
    act(() => first(progress("unrelated")));
    expect(props.setProgress).not.toHaveBeenCalled();
    await act(async () =>
      root.render(<ProgressHarness {...props} transferId="second" />),
    );
    const second = api.listen.mock.calls[1]![0];
    act(() => {
      first(progress("first"));
      second(progress("second"));
    });
    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(props.setProgress.mock.calls).toEqual([[progress("second")]]);
  });
});

function sourceOptions(): Parameters<typeof useTransferSourceInventory>[0] {
  return {
    open: true,
    sourceSupportsTransfer: true,
    source: {
      connectionId: "source",
      driver: "postgres",
      schema: "first",
      table: "seed",
    },
    activeSourceSchema: "first",
    setSourceTables: vi.fn(),
    setSourceTransferObjects: vi.fn(),
    setSelectedTransferObjectKeys: vi.fn(),
    setSelectedSourceTables: vi.fn(),
    initialSourceScope: "schema",
    initialSourceTables: undefined,
  };
}

describe("transfer source and target discovery ownership", () => {
  it("keeps the selected schema inventory when the previous schema query returns last", async () => {
    const first = deferred<Array<{ name: string; type: string }>>();
    const second = deferred<Array<{ name: string; type: string }>>();
    api.tables.mockImplementation((_connection: string, schema: string) =>
      schema === "first" ? first.promise : second.promise,
    );
    const props = sourceOptions();
    await act(async () => root.render(<SourceHarness {...props} />));
    await act(async () =>
      root.render(<SourceHarness {...props} activeSourceSchema="second" />),
    );
    await act(async () =>
      second.resolve([{ name: "current_table", type: "TABLE" }]),
    );
    await act(async () =>
      first.resolve([{ name: "stale_table", type: "TABLE" }]),
    );
    expect(props.setSourceTables).toHaveBeenCalledTimes(1);
    expect(props.setSourceTables).toHaveBeenCalledWith(["current_table"]);
    expect(sourceState.isSourceObjectsLoading).toBe(false);
  });

  it("does not start metadata requests after closing while connection readiness is pending", async () => {
    const ready = deferred<{ status: string }>();
    api.ready.mockReturnValue(ready.promise);
    const props = sourceOptions();
    await act(async () => root.render(<SourceHarness {...props} />));
    await act(async () => root.render(null));
    await act(async () => ready.resolve({ status: "ready" }));
    expect(api.tables).not.toHaveBeenCalled();
    expect(props.setSourceTables).not.toHaveBeenCalled();
  });

  it("does not re-add an old external target after the connection list changes", async () => {
    const first = deferred<{ supportsTableDataTransfer: boolean }>();
    const second = deferred<{ supportsTableDataTransfer: boolean }>();
    api.capabilities.mockImplementation((driver: string) =>
      driver === "external-first" ? first.promise : second.promise,
    );
    const connection = (id: string) => ({
      id,
      name: id,
      driver: `external-${id}`,
      url: "",
      driverPackageVersion: "1",
    });
    await act(async () =>
      root.render(
        <EligibilityHarness open connections={[connection("first")]} />,
      ),
    );
    await act(async () =>
      root.render(
        <EligibilityHarness open connections={[connection("second")]} />,
      ),
    );
    await act(async () => second.resolve({ supportsTableDataTransfer: true }));
    await act(async () => first.resolve({ supportsTableDataTransfer: true }));
    expect([...eligibility.externalTransferConnectionIds]).toEqual(["second"]);
  });
});
