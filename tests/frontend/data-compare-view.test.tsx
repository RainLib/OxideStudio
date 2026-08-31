/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataCompareView } from "@/components/workspace/DataCompareView";
import { tableService } from "@/services/tauri";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useTabStore } from "@/store/useTabStore";
import type { TableDataCompareResult } from "@/services/tauri";
import compareResultFixture from "../fixtures/table-data-compare-result.json";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("DataCompareView", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    useConnectionStore.setState({ connections: [] });
    useTabStore.setState({ tabs: [], activeTabId: null, closedTabsStack: [] });
    const leftId = useTabStore.getState().createTab("table", "Before");
    const rightId = useTabStore.getState().createTab("table", "After");
    useTabStore.setState((state) => ({
      tabs: state.tabs.map((tab) => ({
        ...tab,
        tableColumns: [
          {
            name: "id",
            data_type: "int8",
            is_nullable: false,
            is_primary_key: true,
          },
        ],
        results: [
          {
            columns: [
              { name: "id", data_type: "int8" },
              { name: "score", data_type: "numeric" },
            ],
            rows:
              tab.id === leftId
                ? [
                    [1, 100],
                    [2, 20],
                  ]
                : [
                    [1, 101],
                    [3, 30],
                  ],
          },
        ],
      })),
    }));
    useTabStore.getState().openDataCompareTab(leftId, rightId);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows row status, changed values, and exact source identities", async () => {
    await act(async () => {
      root.render(<DataCompareView />);
    });

    expect(container.textContent).toContain("Before");
    expect(container.textContent).toContain("After");
    expect(container.textContent).toContain("Changed 1");
    expect(container.textContent).toContain("Left only 1");
    expect(container.textContent).toContain("Right only 1");
    expect(container.textContent).toContain("id=1");
    expect(container.textContent).toContain("score");
  });

  it("recalculates numeric differences when relative tolerance changes", async () => {
    await act(async () => {
      root.render(<DataCompareView />);
    });
    const relative = container.querySelector<HTMLInputElement>(
      'input[aria-label="Relative tolerance percent"]',
    );
    await act(async () => {
      if (!relative) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        relative,
        "1",
      );
      relative.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(container.textContent).toContain("Changed 0");
    expect(container.textContent).toContain("Equal 1");
    expect(container.textContent).not.toContain("id=1");
  });

  it("keeps the full-compare IPC fixture bounded while totals remain exact", () => {
    const result = compareResultFixture as TableDataCompareResult;
    expect(result.addedCount).toBe(2_500);
    expect(result.modifiedCount).toBe(1_400);
    expect(result.detailLimitPerStatus).toBe(1_000);
    expect(result.detailsTruncated).toBe(true);
    expect(result.degradationLevel).toBe("full");
    expect(result.countsExact).toBe(true);
    expect(result.added).toHaveLength(1);
    expect(result.modified).toHaveLength(1);
  });

  it("keeps full-compare totals exact when the host returns a bounded detail preview", async () => {
    const [leftTab, rightTab] = useTabStore.getState().tabs.filter(
      (tab) => tab.type === "table",
    );
    if (!leftTab || !rightTab) throw new Error("Expected source table tabs");
    useTabStore.setState((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === leftTab.id
          ? { ...tab, connectionId: "left", databaseName: "app", schemaName: "public", tableName: "users" }
          : tab.id === rightTab.id
            ? { ...tab, connectionId: "right", databaseName: "app", schemaName: "public", tableName: "users" }
            : tab.type === "data_compare"
              ? {
                  ...tab,
                  dataCompareLeft: tab.dataCompareLeft && {
                    ...tab.dataCompareLeft,
                    connectionId: "left",
                    databaseName: "app",
                    schemaName: "public",
                    objectName: "users",
                  },
                  dataCompareRight: tab.dataCompareRight && {
                    ...tab.dataCompareRight,
                    connectionId: "right",
                    databaseName: "app",
                    schemaName: "public",
                    objectName: "users",
                  },
                }
            : tab,
      ),
    }));
    useConnectionStore.setState({
      connections: [
        { id: "left", name: "Left", driver: "postgresql", connectionUrl: "postgresql://left" },
        { id: "right", name: "Right", driver: "postgresql", connectionUrl: "postgresql://right" },
      ] as never,
    });
    const compare = vi.spyOn(tableService, "compareTableDataFull").mockResolvedValue({
      added: [{ key: "1", values: { id: 1, score: 100 } }],
      removed: [],
      modified: [],
      addedCount: 2_500,
      removedCount: 0,
      modifiedCount: 0,
      equalCount: 42,
      sourceRowCount: 2_542,
      targetRowCount: 42,
      comparedKeyCount: 2_542,
      batchSize: 1_000,
      detailLimitPerStatus: 1_000,
      detailsTruncated: true,
      degradationLevel: "full",
      samplingRate: 1,
      confidenceScore: 1,
      verificationMethod: "full_keyset",
      countsExact: true,
      sampledKeyCount: 2_542,
      checksumsMatch: false,
    });

    await act(async () => {
      root.render(<DataCompareView />);
    });
    const button = [...container.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("Compare table data"),
    );
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(compare).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Left only 2,500");
    expect(container.textContent).toContain("Showing up to 1,000 details per status; totals remain exact.");
    expect(container.textContent).toContain("Difference details are limited to 1,000 rows per status. Counts above remain exact.");
    compare.mockRestore();
  });

  it("uses the same operation id when cancelling an active full comparison", async () => {
    const [leftTab, rightTab] = useTabStore.getState().tabs.filter(
      (tab) => tab.type === "table",
    );
    if (!leftTab || !rightTab) throw new Error("Expected source table tabs");
    useTabStore.setState((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === leftTab.id
          ? { ...tab, connectionId: "left", schemaName: "public", tableName: "users" }
          : tab.id === rightTab.id
            ? { ...tab, connectionId: "right", schemaName: "public", tableName: "users" }
            : tab.type === "data_compare"
              ? {
                  ...tab,
                  dataCompareLeft: tab.dataCompareLeft && {
                    ...tab.dataCompareLeft,
                    connectionId: "left",
                    schemaName: "public",
                    objectName: "users",
                  },
                  dataCompareRight: tab.dataCompareRight && {
                    ...tab.dataCompareRight,
                    connectionId: "right",
                    schemaName: "public",
                    objectName: "users",
                  },
                }
              : tab,
      ),
    }));
    useConnectionStore.setState({
      connections: [
        { id: "left", name: "Left", driver: "postgresql", connectionUrl: "postgresql://left" },
        { id: "right", name: "Right", driver: "postgresql", connectionUrl: "postgresql://right" },
      ] as never,
    });

    let rejectComparison: ((reason?: unknown) => void) | undefined;
    const compare = vi
      .spyOn(tableService, "compareTableDataFull")
      .mockImplementation(
        () =>
          new Promise<TableDataCompareResult>((_resolve, reject) => {
            rejectComparison = reject;
          }),
      );
    const cancel = vi
      .spyOn(tableService, "cancelTableDataCompare")
      .mockResolvedValue("Comparison cancellation requested");

    await act(async () => root.render(<DataCompareView />));
    const start = [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) =>
      item.textContent?.includes("Compare table data"),
    );
    await act(async () => start?.click());
    const request = compare.mock.calls[0]?.[0];
    expect(request?.compareId).toMatch(/^table-compare-/);
    const stop = [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) =>
      item.textContent?.includes("Cancel comparison"),
    );
    await act(async () => stop?.click());
    expect(cancel).toHaveBeenCalledWith(request?.compareId);

    await act(async () => {
      rejectComparison?.(new Error("Table data comparison cancelled"));
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain("Cancel comparison");
    compare.mockRestore();
    cancel.mockRestore();
  });

  it("offers a frozen sync plan only after an exact untruncated comparison", async () => {
    const [leftTab, rightTab] = useTabStore.getState().tabs.filter(
      (tab) => tab.type === "table",
    );
    if (!leftTab || !rightTab) throw new Error("Expected source table tabs");
    useTabStore.setState((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === leftTab.id
          ? { ...tab, connectionId: "left", schemaName: "public", tableName: "users" }
          : tab.id === rightTab.id
            ? { ...tab, connectionId: "right", schemaName: "public", tableName: "users" }
            : tab.type === "data_compare"
              ? {
                  ...tab,
                  dataCompareLeft: tab.dataCompareLeft && {
                    ...tab.dataCompareLeft,
                    connectionId: "left",
                    schemaName: "public",
                    objectName: "users",
                  },
                  dataCompareRight: tab.dataCompareRight && {
                    ...tab.dataCompareRight,
                    connectionId: "right",
                    schemaName: "public",
                    objectName: "users",
                  },
                }
              : tab,
      ),
    }));
    useConnectionStore.setState({
      connections: [
        { id: "left", name: "Left", driver: "postgresql", connectionUrl: "postgresql://left" },
        { id: "right", name: "Right", driver: "postgresql", connectionUrl: "postgresql://right" },
      ] as never,
    });
    const comparison: TableDataCompareResult = {
      added: [{ key: "2", values: { id: 2, score: 20 } }],
      removed: [{ key: "3", values: { id: 3, score: 30 } }],
      modified: [],
      addedCount: 1,
      removedCount: 1,
      modifiedCount: 0,
      equalCount: 1,
      sourceRowCount: 2,
      targetRowCount: 2,
      comparedKeyCount: 3,
      batchSize: 1_000,
      detailLimitPerStatus: 1_000,
      detailsTruncated: false,
      degradationLevel: "full",
      samplingRate: 1,
      confidenceScore: 1,
      verificationMethod: "full_keyset",
      countsExact: true,
      sampledKeyCount: 3,
    };
    const compare = vi
      .spyOn(tableService, "compareTableDataFull")
      .mockResolvedValue(comparison);
    const preview = vi
      .spyOn(tableService, "previewTableDataCompareSync")
      .mockResolvedValue({
        insertCount: 1,
        updateCount: 0,
        deleteCount: 0,
        statementCount: 1,
        statements: ['INSERT INTO "public"."users" ("id", "score") VALUES (2, 20);'],
        sql: '-- Review-only\nBEGIN;\nINSERT INTO "public"."users" ("id", "score") VALUES (2, 20);\nCOMMIT;',
        planDigest: "digest",
        reviewOnly: true,
        canExecute: true,
        planToken: "single-use-token",
        expiresAt: Date.now() + 60_000,
        confirmationText: "SYNC public.users",
        warnings: ["Review artifact; execution uses the frozen plan."],
      });
    const execute = vi
      .spyOn(tableService, "executeTableDataCompareSync")
      .mockResolvedValue({
        insertCount: 1,
        updateCount: 0,
        deleteCount: 0,
        rowsAffected: 1,
        planDigest: "digest",
      });

    await act(async () => root.render(<DataCompareView />));
    const compareButton = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.textContent?.includes("Compare table data"),
    );
    await act(async () => {
      compareButton?.click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("2 selected for sync");
    const removedSelection = container.querySelector<HTMLInputElement>(
      'input[aria-label="Include rightOnly row id=3 in synchronization"]',
    );
    expect(removedSelection?.checked).toBe(true);
    await act(async () => removedSelection?.click());
    expect(container.textContent).toContain("1 selected for sync");
    const previewButton = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.textContent?.includes("Preview sync SQL"),
    );
    expect(previewButton?.disabled).toBe(false);
    await act(async () => {
      previewButton?.click();
      await Promise.resolve();
    });

    expect(preview).toHaveBeenCalledWith(
      expect.objectContaining({
        comparison: expect.objectContaining({
          added: comparison.added,
          removed: [],
          modified: [],
          addedCount: 1,
          removedCount: 0,
          modifiedCount: 0,
        }),
        keyColumns: ["id"],
      }),
    );
    expect(
      container.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Data compare synchronization SQL"]',
      )?.value,
    ).toContain("INSERT INTO");
    expect(container.textContent).toContain("Synchronization plan");
    await act(async () => removedSelection?.click());
    expect(
      container.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="Data compare synchronization SQL"]',
      ),
    ).toBeNull();
    await act(async () => removedSelection?.click());
    await act(async () => {
      previewButton?.click();
      await Promise.resolve();
    });
    expect(preview).toHaveBeenCalledTimes(2);
    const apply = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.textContent?.includes("Apply atomically"),
    );
    expect(apply?.disabled).toBe(true);
    const confirmation = container.querySelector<HTMLInputElement>(
      'input[aria-label="Synchronization confirmation phrase"]',
    );
    await act(async () => {
      if (!confirmation) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
        confirmation,
        "SYNC public.users",
      );
      confirmation.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(apply?.disabled).toBe(false);
    await act(async () => {
      apply?.click();
      await Promise.resolve();
    });
    expect(execute).toHaveBeenCalledWith({
      planToken: "single-use-token",
      planDigest: "digest",
      confirmationText: "SYNC public.users",
    });
    expect(container.textContent).toContain("Applied 1 frozen operation(s) atomically");
    compare.mockRestore();
    preview.mockRestore();
    execute.mockRestore();
  });

  it("requires the complete shared primary key before enabling full-table compare", async () => {
    const [leftTab, rightTab] = useTabStore.getState().tabs.filter(
      (tab) => tab.type === "table",
    );
    if (!leftTab || !rightTab) throw new Error("Expected source table tabs");
    useTabStore.setState((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === leftTab.id
          ? { ...tab, connectionId: "left", databaseName: "app", schemaName: "public", tableName: "users" }
          : tab.id === rightTab.id
            ? { ...tab, connectionId: "right", databaseName: "app", schemaName: "public", tableName: "users" }
            : tab.type === "data_compare"
              ? {
                  ...tab,
                  dataCompareLeft: tab.dataCompareLeft && { ...tab.dataCompareLeft, connectionId: "left", databaseName: "app", schemaName: "public", objectName: "users" },
                  dataCompareRight: tab.dataCompareRight && { ...tab.dataCompareRight, connectionId: "right", databaseName: "app", schemaName: "public", objectName: "users" },
                }
              : tab,
      ),
    }));
    useConnectionStore.setState({
      connections: [
        { id: "left", name: "Left", driver: "postgresql", connectionUrl: "postgresql://left" },
        { id: "right", name: "Right", driver: "postgresql", connectionUrl: "postgresql://right" },
      ] as never,
    });
    await act(async () => {
      root.render(<DataCompareView />);
    });
    const fullCompare = () => [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((item) => item.textContent?.includes("Compare table data"));
    expect(fullCompare()?.disabled).toBe(false);

    const key = container.querySelector<HTMLInputElement>(
      'aside input[type="checkbox"]',
    );
    await act(async () => key?.click());
    expect(fullCompare()?.disabled).toBe(true);
    expect(container.textContent).toContain("complete shared primary key");
  });

  it("labels degraded results as deterministic samples without claiming exact totals", async () => {
    const [leftTab, rightTab] = useTabStore.getState().tabs.filter(
      (tab) => tab.type === "table",
    );
    if (!leftTab || !rightTab) throw new Error("Expected source table tabs");
    useTabStore.setState((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === leftTab.id
          ? { ...tab, connectionId: "left", databaseName: "app", schemaName: "public", tableName: "users" }
          : tab.id === rightTab.id
            ? { ...tab, connectionId: "right", databaseName: "app", schemaName: "public", tableName: "users" }
            : tab.type === "data_compare"
              ? {
                  ...tab,
                  dataCompareLeft: tab.dataCompareLeft && { ...tab.dataCompareLeft, connectionId: "left", databaseName: "app", schemaName: "public", objectName: "users" },
                  dataCompareRight: tab.dataCompareRight && { ...tab.dataCompareRight, connectionId: "right", databaseName: "app", schemaName: "public", objectName: "users" },
                }
              : tab,
      ),
    }));
    useConnectionStore.setState({
      connections: [
        { id: "left", name: "Left", driver: "postgresql", connectionUrl: "postgresql://left" },
        { id: "right", name: "Right", driver: "postgresql", connectionUrl: "postgresql://right" },
      ] as never,
    });
    const compare = vi.spyOn(tableService, "compareTableDataFull").mockResolvedValue({
      added: [],
      removed: [],
      modified: [],
      addedCount: 0,
      removedCount: 0,
      modifiedCount: 0,
      equalCount: 20_000,
      sourceRowCount: 2_000_000,
      targetRowCount: 2_000_000,
      comparedKeyCount: 20_000,
      batchSize: 1_000,
      detailLimitPerStatus: 1_000,
      detailsTruncated: false,
      degradationLevel: "sample",
      samplingStrategy: "extremeValues",
      samplingRate: 0.01,
      verificationMethod: "extreme_key_sample",
      countsExact: false,
      sampledKeyCount: 20_000,
      checksumsMatch: true,
    });

    await act(async () => root.render(<DataCompareView />));
    const button = [...container.querySelectorAll("button")].find((item) =>
      item.textContent?.includes("Compare table data"),
    );
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("20,000 deterministic extreme keys inspected");
    expect(container.textContent).toContain("1.00% key coverage · sampled counts only");
    expect(container.textContent).toContain("does not claim a statistical confidence score");
    expect(container.textContent).toContain("Inspected-column checksums match");
    compare.mockRestore();
  });
});
