// @vitest-environment happy-dom
import { useDataCompareSession } from "@/features/data-compare/hooks/useDataCompareSession";
import type { DataCompareSource } from "@/lib/dataCompare";
import type { TableDataCompareProgress } from "@/services/tauri/types/tableCompare";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const services = vi.hoisted(() => ({ listen: vi.fn(), cancel: vi.fn() }));
vi.mock("@/services/tauri", () => ({
  tableService: {
    listenTableDataCompareProgress: services.listen,
    cancelTableDataCompare: services.cancel,
  },
}));
type Options = Parameters<typeof useDataCompareSession>[0];
let root: Root;
let container: HTMLDivElement;
let controller: ReturnType<typeof useDataCompareSession>;
let onProgress: (progress: TableDataCompareProgress) => void;
function Harness(props: Options) {
  controller = useDataCompareSession(props);
  return null;
}
function source(id: string): DataCompareSource {
  return {
    id,
    tabId: id,
    label: id,
    sourceKind: "table",
    resultIndex: 0,
    columns: [{ name: "id", dataType: "int" }],
    rows: [[1]],
    suggestedKeyColumns: ["id"],
    truncated: false,
    capturedAt: 1,
  };
}
function options(): Options {
  return { left: source("left"), right: source("right") };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  services.listen.mockImplementation((callback) => {
    onProgress = callback;
    return Promise.resolve(vi.fn());
  });
  services.cancel.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it("unsubscribes a progress listener that registers after unmount", async () => {
  let finish!: (unsubscribe: () => void) => void;
  services.listen.mockReturnValue(
    new Promise<() => void>((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => root.render(<Harness {...options()} />));
  await act(async () => root.render(null));
  const unsubscribe = vi.fn();
  await act(async () => finish(unsubscribe));
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});
it("cancels the active comparison once when the source pair changes", async () => {
  const props = options();
  await act(async () => root.render(<Harness {...props} />));
  controller.activeCompareIdRef.current = "old";
  await act(async () =>
    root.render(<Harness {...props} right={source("next")} />),
  );
  expect(services.cancel).toHaveBeenCalledExactlyOnceWith("old");
  expect(controller.activeCompareIdRef.current).toBeNull();
  await act(async () => root.render(null));
  expect(services.cancel).toHaveBeenCalledTimes(1);
});
it("cancels and releases the active comparison when the page unmounts", async () => {
  const unsubscribe = vi.fn();
  services.listen.mockResolvedValue(unsubscribe);
  await act(async () => root.render(<Harness {...options()} />));
  controller.activeCompareIdRef.current = "running";
  await act(async () => root.render(null));
  expect(services.cancel).toHaveBeenCalledExactlyOnceWith("running");
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});
it("ignores progress from an obsolete comparison operation", async () => {
  await act(async () => root.render(<Harness {...options()} />));
  controller.activeCompareIdRef.current = "current";
  const old: TableDataCompareProgress = {
    compareId: "old",
    message: "old",
    phase: "validating",
    processedRows: 0,
    status: "running",
    terminal: false,
  };
  await act(async () => onProgress(old));
  expect(controller.fullComparisonProgress).toBeNull();
  const current = { ...old, compareId: "current", message: "current" };
  await act(async () => onProgress(current));
  expect(controller.fullComparisonProgress?.message).toBe("current");
});
