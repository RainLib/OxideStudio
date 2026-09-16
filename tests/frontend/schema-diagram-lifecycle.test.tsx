// @vitest-environment happy-dom
import { useDiagramCanvasPersistence } from "@/features/schema-diagram/hooks/useDiagramCanvasPersistence";
import {
  commitSchemaDiagramCanvas,
  createSchemaDiagramCanvasHistory,
} from "@/lib/schemaDiagramCanvasHistory";
import type { PersistedSchemaDiagramCanvas } from "@/services/schemaDiagramCanvasStore";
import type { SchemaSnapshot } from "@/services/tauri/types";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

type Options = Parameters<typeof useDiagramCanvasPersistence>[0];
const services = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  tabs: [] as NonNullable<Options["activeTab"]>[],
}));
vi.mock("@/services/schemaDiagramCanvasStore", () => ({
  loadSchemaDiagramCanvas: services.load,
  saveSchemaDiagramCanvas: services.save,
}));
vi.mock("@/store/useTabStore", () => ({
  useTabStore: { getState: () => ({ tabs: services.tabs }) },
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function snapshot(id: string): SchemaSnapshot {
  return {
    version: 1,
    id,
    fingerprint: id,
    projectId: "project",
    connectionId: "connection",
    connectionName: "Local",
    driver: "postgres",
    schemaName: id,
    capturedAt: 1,
    relations: [],
    warnings: [],
  };
}
function canvas(name: string): PersistedSchemaDiagramCanvas {
  return {
    version: 1,
    baseFingerprint: name,
    updatedAt: 1,
    areas: [{ id: name, name, relationNames: [] }],
    notes: [],
  };
}
function options(id = "first"): Options {
  const activeTab = {
    id,
    schemaDiagramCanvasHistory: createSchemaDiagramCanvasHistory(),
  };
  services.tabs.push(activeTab);
  return {
    activeTab,
    snapshot: snapshot(id),
    areas: [],
    diagramNotes: [],
    setSchemaDiagramCanvasHistory: vi.fn(),
  };
}
let root: Root;
let container: HTMLDivElement;
let controller: ReturnType<typeof useDiagramCanvasPersistence>;
function Harness(props: Options) {
  controller = useDiagramCanvasPersistence(props);
  return null;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  services.tabs = [];
  services.load.mockResolvedValue(null);
  services.save.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("ignores a previous tab's late restoration after switching canvases", async () => {
  const first = deferred<PersistedSchemaDiagramCanvas>();
  const second = deferred<PersistedSchemaDiagramCanvas>();
  services.load
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const a = options("first"),
    b = options("second");
  await act(async () => root.render(<Harness {...a} />));
  await act(async () => root.render(<Harness {...b} />));
  await act(async () => second.resolve(canvas("current")));
  await act(async () => first.resolve(canvas("stale")));
  expect(a.setSchemaDiagramCanvasHistory).not.toHaveBeenCalled();
  expect(b.setSchemaDiagramCanvasHistory).toHaveBeenCalledWith(
    "second",
    createSchemaDiagramCanvasHistory(canvas("current").areas, []),
  );
  expect(controller.canvasPersistenceState).toBe("ready");
});

it("does not overwrite an edit made while the initial canvas load is pending", async () => {
  const request = deferred<PersistedSchemaDiagramCanvas>();
  services.load.mockReturnValue(request.promise);
  const props = options();
  await act(async () => root.render(<Harness {...props} />));
  services.tabs[0] = {
    id: "first",
    schemaDiagramCanvasHistory: createSchemaDiagramCanvasHistory(
      canvas("edited").areas,
    ),
  };
  await act(async () => request.resolve(canvas("persisted")));
  expect(props.setSchemaDiagramCanvasHistory).not.toHaveBeenCalled();
  expect(controller.canvasPersistenceReady).toBe(true);
});

it("preserves existing undo history when restoring a persisted canvas", async () => {
  const props = options();
  props.activeTab!.schemaDiagramCanvasHistory = commitSchemaDiagramCanvas(
    createSchemaDiagramCanvasHistory(),
    { areas: canvas("session").areas },
  );
  services.load.mockResolvedValue(canvas("persisted"));
  await act(async () => root.render(<Harness {...props} />));
  expect(props.setSchemaDiagramCanvasHistory).not.toHaveBeenCalled();
  expect(controller.canvasPersistenceReady).toBe(true);
});

it("flushes the latest debounced canvas once on unmount and cancels its timer", async () => {
  const props = options();
  await act(async () => root.render(<Harness {...props} />));
  const areas = canvas("latest").areas;
  await act(async () => root.render(<Harness {...props} areas={areas} />));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(449);
  });
  expect(services.save).not.toHaveBeenCalled();
  await act(async () => root.render(null));
  expect(services.save).toHaveBeenCalledExactlyOnceWith(
    props.snapshot,
    areas,
    [],
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(services.save).toHaveBeenCalledTimes(1);
});

it("serializes canvas writes and continues the queue after a failed save", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const first = deferred<void>();
  services.save.mockReturnValueOnce(first.promise);
  const props = options();
  await act(async () => root.render(<Harness {...props} />));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(450);
  });
  const areas = canvas("second-write").areas;
  await act(async () => root.render(<Harness {...props} areas={areas} />));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(450);
  });
  expect(services.save).toHaveBeenCalledTimes(1);
  await act(async () => first.reject(new Error("save failed")));
  expect(services.save).toHaveBeenCalledTimes(2);
  expect(services.save).toHaveBeenLastCalledWith(props.snapshot, areas, []);
  expect(controller.canvasPersistenceState).toBe("ready");
});

it("does not publish an old save's status over the next canvas load", async () => {
  const save = deferred<void>();
  services.save.mockReturnValueOnce(save.promise);
  const a = options("first");
  await act(async () => root.render(<Harness {...a} />));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(450);
  });
  const load = deferred<PersistedSchemaDiagramCanvas | null>();
  services.load.mockReturnValueOnce(load.promise);
  const b = options("second");
  await act(async () => root.render(<Harness {...b} />));
  expect(controller.canvasPersistenceState).toBe("loading");
  await act(async () => save.resolve());
  expect(controller.canvasPersistenceState).toBe("loading");
  expect(controller.canvasPersistenceReady).toBe(false);
  await act(async () => load.resolve(null));
  expect(controller.canvasPersistenceState).toBe("ready");
});
