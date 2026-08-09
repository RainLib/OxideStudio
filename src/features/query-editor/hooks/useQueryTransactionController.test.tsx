// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQueryTransactionController } from "./useQueryTransactionController";

const transactionMocks = vi.hoisted(() => ({
  begin: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
}));

vi.mock("@/services/tauri", () => ({
  transactionService: {
    beginTransaction: transactionMocks.begin,
    commitTransaction: transactionMocks.commit,
    rollbackTransaction: transactionMocks.rollback,
  },
}));

type ControllerOptions = Parameters<typeof useQueryTransactionController>[0];
type Controller = ReturnType<typeof useQueryTransactionController>;

let root: Root;
let container: HTMLDivElement;
let controller: Controller;

function Harness(props: ControllerOptions) {
  controller = useQueryTransactionController(props);
  return null;
}

const loadSchemas = vi.fn(async () => undefined);
const loadTables = vi.fn(async () => undefined);
const bumpMetadataVersion = vi.fn();

function options(
  overrides: Partial<ControllerOptions> = {},
): ControllerOptions {
  return {
    tabs: [{ id: "tab-1", connectionId: "connection-1" }],
    connections: [{ id: "connection-1", driver: "postgres" }],
    activeConnectionId: "connection-1",
    activeTabId: "tab-1",
    activeTargetSchema: "public",
    effectiveConnectionId: "connection-1",
    currentSchema: "public",
    supportsTransactions: true,
    loadSchemas,
    loadTables,
    bumpMetadataVersion,
    ...overrides,
  };
}

async function renderController(next: ControllerOptions) {
  await act(async () => {
    root.render(<Harness {...next} />);
  });
}

describe("useQueryTransactionController", () => {
  beforeEach(() => {
    transactionMocks.begin.mockReset().mockResolvedValue(undefined);
    transactionMocks.commit.mockReset().mockResolvedValue(undefined);
    transactionMocks.rollback.mockReset().mockResolvedValue(undefined);
    loadSchemas.mockClear();
    loadTables.mockClear();
    bumpMetadataVersion.mockClear();
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
  });

  it("owns a manual transaction and refreshes metadata after commit", async () => {
    await renderController(options());
    await act(async () => controller.handleTransactionModeChange("manual"));
    await act(async () => controller.handleBeginTransaction());

    expect(transactionMocks.begin).toHaveBeenCalledWith(
      "connection-1",
      "connection-1:tab-1",
      "public",
    );
    expect(controller.transactionState).toBe("active");
    expect(controller.transactionIdForExecution()).toBe(
      "connection-1:tab-1",
    );

    await act(async () => controller.handleCommitTransaction());
    expect(transactionMocks.commit).toHaveBeenCalledWith(
      "connection-1",
      "connection-1:tab-1",
    );
    expect(controller.transactionState).toBe("idle");
    expect(controller.transactionOperation).toBeNull();
    expect(loadSchemas).toHaveBeenCalledWith("connection-1", true);
    expect(loadTables).toHaveBeenCalledWith(
      "connection-1",
      "public",
      true,
    );
    expect(bumpMetadataVersion).toHaveBeenCalledOnce();
  });

  it("keeps manual mode when switching to auto cannot commit", async () => {
    await renderController(options());
    await act(async () => controller.handleTransactionModeChange("manual"));
    await act(async () => controller.handleBeginTransaction());
    transactionMocks.commit.mockRejectedValueOnce(new Error("commit failed"));

    await act(async () => {
      controller.handleTransactionModeChange("auto");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(controller.transactionMode).toBe("manual");
    expect(controller.transactionState).toBe("active");
    expect(controller.transactionOperation).toBeNull();
  });

  it("deduplicates a transaction operation before React rerenders", async () => {
    let resolveBegin: (() => void) | undefined;
    transactionMocks.begin.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveBegin = resolve;
        }),
    );
    await renderController(options());
    await act(async () => controller.handleTransactionModeChange("manual"));

    await act(async () => {
      const first = controller.handleBeginTransaction();
      const duplicate = controller.handleBeginTransaction();
      expect(transactionMocks.begin).toHaveBeenCalledOnce();
      resolveBegin?.();
      await Promise.all([first, duplicate]);
    });

    expect(controller.transactionState).toBe("active");
  });

  it("rolls back a begin request that finishes after its tab closes", async () => {
    let resolveBegin: (() => void) | undefined;
    transactionMocks.begin.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveBegin = resolve;
        }),
    );
    await renderController(options());
    await act(async () => controller.handleTransactionModeChange("manual"));

    let pendingBegin: Promise<void> | undefined;
    await act(async () => {
      pendingBegin = controller.handleBeginTransaction();
      await Promise.resolve();
    });
    await renderController(options({ tabs: [], activeTabId: null }));
    await act(async () => {
      resolveBegin?.();
      await pendingBegin;
    });

    expect(transactionMocks.rollback).toHaveBeenCalledWith(
      "connection-1",
      "connection-1:tab-1",
    );
    expect(controller.transactionState).toBe("idle");
  });

  it("rolls back a session when its tab disappears", async () => {
    await renderController(options());
    await act(async () => controller.handleTransactionModeChange("manual"));
    await act(async () => controller.handleBeginTransaction());

    await renderController(options({ tabs: [], activeTabId: null }));

    expect(transactionMocks.rollback).toHaveBeenCalledWith(
      "connection-1",
      "connection-1:tab-1",
    );
  });
});
