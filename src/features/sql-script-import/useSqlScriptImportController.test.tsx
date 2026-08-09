// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTaskStore } from "@/store/useTaskStore";
import {
  useSqlScriptImportController,
  type SqlScriptImportTarget,
} from "./useSqlScriptImportController";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  preview: vi.fn(),
  importScript: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
vi.mock("@/services/tauri", () => ({
  queryService: {
    previewSqlScriptImport: mocks.preview,
    importSqlScript: mocks.importScript,
  },
}));

type ControllerOptions = Parameters<typeof useSqlScriptImportController>[0];
type Controller = ReturnType<typeof useSqlScriptImportController>;

let root: Root;
let container: HTMLDivElement;
let controller: Controller;

function Harness(props: ControllerOptions) {
  controller = useSqlScriptImportController(props);
  return null;
}

const target: SqlScriptImportTarget = {
  connectionId: "connection-1",
  schema: "public",
  label: "Development · public",
  driver: "postgres",
  contextKey: "tab-1:connection-1",
};
const refreshMetadata = vi.fn(async () => undefined);
const ensureTargetReady = vi.fn(async () => undefined);
const onError = vi.fn();

function options(
  overrides: Partial<ControllerOptions> = {},
): ControllerOptions {
  return {
    activeContextKey: target.contextKey,
    availabilityKey: "connection-1",
    isTargetAvailable: (candidate) =>
      candidate.connectionId === "connection-1",
    ensureTargetReady,
    refreshMetadata,
    onError,
    ...overrides,
  };
}

async function renderController(next: ControllerOptions) {
  await act(async () => root.render(<Harness {...next} />));
}

describe("useSqlScriptImportController", () => {
  beforeEach(() => {
    mocks.open.mockReset().mockResolvedValue("C:\\tmp\\schema.sql");
    mocks.preview.mockReset().mockResolvedValue({
      fileName: "schema.sql",
      totalBytes: 100,
      statementCount: 2,
      statementPreview: ["CREATE TABLE users(id INT)"],
      truncated: false,
      reviewDigest: "digest-1",
    });
    mocks.importScript.mockReset().mockResolvedValue({
      filePath: "C:\\tmp\\schema.sql",
      statementsExecuted: 2,
      rowsAffected: 0,
    });
    refreshMetadata.mockReset().mockResolvedValue(undefined);
    ensureTargetReady.mockReset().mockResolvedValue(undefined);
    onError.mockReset();
    useTaskStore.setState({ tasks: [] });
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
  });

  it("binds a native preview digest to the selected target", async () => {
    await renderController(options());

    await act(async () => controller.requestImport(target));

    expect(mocks.preview).toHaveBeenCalledWith(
      "connection-1",
      "C:\\tmp\\schema.sql",
    );
    expect(controller.pendingImport?.preview.reviewDigest).toBe("digest-1");
    expect(controller.pendingImport?.target).toEqual(target);
    expect(useTaskStore.getState().tasks[0]?.status).toBe("waiting");
  });

  it("deduplicates preview requests before React rerenders", async () => {
    let finishPreview: ((value: unknown) => void) | undefined;
    mocks.preview.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishPreview = resolve;
        }),
    );
    await renderController(options());

    let first: Promise<void> | undefined;
    let duplicate: Promise<void> | undefined;
    await act(async () => {
      first = controller.requestImport(target);
      duplicate = controller.requestImport(target);
      await Promise.resolve();
    });
    expect(mocks.open).toHaveBeenCalledOnce();
    expect(mocks.preview).toHaveBeenCalledOnce();

    await act(async () => {
      finishPreview?.({
        fileName: "schema.sql",
        totalBytes: 100,
        statementCount: 1,
        statementPreview: ["SELECT 1"],
        truncated: false,
        reviewDigest: "digest-1",
      });
      await Promise.all([first, duplicate]);
    });
  });

  it("discards a preview when its editor context changes", async () => {
    let finishPreview: ((value: unknown) => void) | undefined;
    mocks.preview.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishPreview = resolve;
        }),
    );
    await renderController(options());

    let pending: Promise<void> | undefined;
    await act(async () => {
      pending = controller.requestImport(target);
      await Promise.resolve();
    });
    await renderController(options({ activeContextKey: "tab-2:connection-1" }));
    await act(async () => {
      finishPreview?.({
        fileName: "schema.sql",
        totalBytes: 100,
        statementCount: 1,
        statementPreview: ["SELECT 1"],
        truncated: false,
        reviewDigest: "digest-1",
      });
      await pending;
    });

    expect(controller.pendingImport).toBeNull();
    expect(useTaskStore.getState().tasks[0]?.status).toBe("cancelled");
  });

  it("keeps a completed import successful when metadata refresh fails", async () => {
    refreshMetadata.mockRejectedValueOnce(new Error("metadata unavailable"));
    await renderController(options());
    await act(async () => controller.requestImport(target));

    await act(async () => controller.confirmImport());

    expect(mocks.importScript).toHaveBeenCalledWith(
      "connection-1",
      "C:\\tmp\\schema.sql",
      "digest-1",
      "public",
      undefined,
    );
    const tasks = useTaskStore.getState().tasks;
    expect(tasks.find((task) => task.kind === "import")?.status).toBe(
      "success",
    );
    expect(tasks.find((task) => task.kind === "introspection")?.status).toBe(
      "error",
    );
    expect(controller.pendingImport).toBeNull();
    expect(onError).toHaveBeenCalledWith(
      "metadata unavailable",
      "refresh",
      target,
    );
  });

  it("retains the reviewed request when native import fails", async () => {
    mocks.importScript.mockRejectedValueOnce(new Error("digest changed"));
    await renderController(options());
    await act(async () => controller.requestImport(target));

    await act(async () => controller.confirmImport());

    expect(controller.pendingImport?.preview.reviewDigest).toBe("digest-1");
    expect(useTaskStore.getState().tasks[0]?.status).toBe("error");
    expect(onError).toHaveBeenCalledWith(
      "digest changed",
      "import",
      target,
    );
  });
});
