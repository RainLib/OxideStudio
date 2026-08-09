// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTaskStore } from "@/store/useTaskStore";
import { useConsoleFileController } from "./useConsoleFileController";

const mocks = vi.hoisted(() => ({
  importFile: vi.fn(),
  exportFile: vi.fn(),
}));

vi.mock("@/services/tauri", () => ({
  queryService: {
    importElasticsearchConsoleFile: mocks.importFile,
    exportElasticsearchConsoleFile: mocks.exportFile,
  },
}));

type ControllerOptions = Parameters<typeof useConsoleFileController>[0];
type Controller = ReturnType<typeof useConsoleFileController>;

let root: Root;
let container: HTMLDivElement;
let controller: Controller;

function Harness(props: ControllerOptions) {
  controller = useConsoleFileController(props);
  return null;
}

const updateTabSql = vi.fn();
const setPosition = vi.fn();
const focus = vi.fn();

function options(
  overrides: Partial<ControllerOptions> = {},
): ControllerOptions {
  return {
    activeTab: { id: "tab-1", sql: "" },
    enabled: true,
    editorRef: {
      current: {
        getModel: () => ({ getValue: () => "GET /_search\n{}" }),
        setPosition,
        focus,
      },
    },
    updateTabSql,
    ...overrides,
  };
}

async function renderController(next: ControllerOptions) {
  await act(async () => root.render(<Harness {...next} />));
}

describe("useConsoleFileController", () => {
  beforeEach(() => {
    mocks.importFile.mockReset().mockResolvedValue({
      fileName: "requests.es",
      content: "GET /users/_search\n{}",
    });
    mocks.exportFile.mockReset().mockResolvedValue({
      exported: true,
      byteCount: 16,
    });
    updateTabSql.mockReset();
    setPosition.mockReset();
    focus.mockReset();
    useTaskStore.setState({ tasks: [] });
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
  });

  it("imports Console requests into the original tab", async () => {
    await renderController(options());

    await act(async () => controller.handleImportConsoleRequests());

    expect(updateTabSql).toHaveBeenCalledWith(
      "tab-1",
      "GET /users/_search\n{}",
    );
    expect(useTaskStore.getState().tasks[0]?.status).toBe("success");
    expect(controller.operation).toBeNull();
  });

  it("drops imported content when the active tab changes", async () => {
    let finishImport: ((value: unknown) => void) | undefined;
    mocks.importFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishImport = resolve;
        }),
    );
    await renderController(options());

    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = controller.handleImportConsoleRequests();
      await Promise.resolve();
    });
    await renderController(
      options({ activeTab: { id: "tab-2", sql: "" } }),
    );
    await act(async () => {
      finishImport?.({
        fileName: "requests.es",
        content: "GET /users/_search\n{}",
      });
      await pending;
    });

    expect(updateTabSql).not.toHaveBeenCalled();
    expect(useTaskStore.getState().tasks[0]?.status).toBe("cancelled");
  });

  it("deduplicates exports and snapshots editor content", async () => {
    let finishExport: ((value: unknown) => void) | undefined;
    mocks.exportFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishExport = resolve;
        }),
    );
    await renderController(options());

    let first: Promise<void> | undefined;
    let duplicate: Promise<void> | undefined;
    await act(async () => {
      first = controller.handleExportConsoleRequests();
      duplicate = controller.handleExportConsoleRequests();
      await Promise.resolve();
    });
    expect(mocks.exportFile).toHaveBeenCalledOnce();
    expect(mocks.exportFile).toHaveBeenCalledWith("GET /_search\n{}");

    await act(async () => {
      finishExport?.({ exported: true, byteCount: 16 });
      await Promise.all([first, duplicate]);
    });
  });
});
