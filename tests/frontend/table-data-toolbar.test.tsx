/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TableDataToolbar } from "@/components/workspace/TableDataToolbar";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("TableDataToolbar", () => {
  let root: Root | null = null;
  let container: HTMLDivElement;

  afterEach(() => {
    root?.unmount();
    root = null;
    container?.remove();
  });

  it("routes the compact data editor commands", async () => {
    const onSearch = vi.fn();
    const onFitColumns = vi.fn();
    const onResetColumns = vi.fn();
    const noop = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      root = createRoot(container);
      root.render(
        <TableDataToolbar
          isExecuting={false}
          readOnly={false}
          editingEnabled
          hasEdits={false}
          editedCellCount={0}
          newRowCount={0}
          selectedRowCount={0}
          onRefresh={noop}
          onAddRow={noop}
          onDeleteRows={noop}
          onSave={noop}
          onRevert={noop}
          onSearch={onSearch}
          onFitColumns={onFitColumns}
          onResetColumns={onResetColumns}
          onToggleEditing={noop}
          onImport={noop}
          onExportCsv={noop}
          onExportJson={noop}
        />
      );
    });

    expect(
      container.querySelector<HTMLButtonElement>('[aria-label="Select rows to delete"]')
        ?.disabled
    ).toBe(true);

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Find in data grid"]')?.click();
      container.querySelector<HTMLButtonElement>('[aria-label="Fit all columns"]')?.click();
      container
        .querySelector<HTMLButtonElement>('[aria-label="Reset column layout"]')
        ?.click();
    });

    expect(onSearch).toHaveBeenCalledOnce();
    expect(onFitColumns).toHaveBeenCalledOnce();
    expect(onResetColumns).toHaveBeenCalledOnce();
  });

  it("disables mutation and unscoped transfer actions in read-only mode", async () => {
    const noop = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      root = createRoot(container);
      root.render(
        <TableDataToolbar
          isExecuting={false}
          readOnly
          exportDisabled
          editingEnabled
          hasEdits
          editedCellCount={2}
          newRowCount={1}
          selectedRowCount={2}
          onRefresh={noop}
          onAddRow={noop}
          onDeleteRows={noop}
          onSave={noop}
          onRevert={noop}
          onSearch={noop}
          onFitColumns={noop}
          onResetColumns={noop}
          onToggleEditing={noop}
          onImport={noop}
          onExportCsv={noop}
          onExportJson={noop}
        />
      );
    });

    for (const label of [
      "Add row",
      "Delete 2 selected rows",
      "Submit changes",
      "This object is read-only",
      "Import data",
      "Export CSV",
      "Export JSON",
    ]) {
      expect(
        container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)
          ?.disabled
      ).toBe(true);
    }

    expect(
      container.querySelector<HTMLButtonElement>('[aria-label="Refresh data"]')
        ?.disabled
    ).toBe(false);
  });

  it("keeps transpose view read-only and identifies the active presentation", async () => {
    const onToggleTranspose = vi.fn();
    const noop = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      root = createRoot(container);
      root.render(
        <TableDataToolbar
          isExecuting={false}
          readOnly={false}
          viewOnly
          editingEnabled
          hasEdits={false}
          editedCellCount={0}
          newRowCount={0}
          selectedRowCount={0}
          onRefresh={noop}
          onAddRow={noop}
          onDeleteRows={noop}
          onSave={noop}
          onRevert={noop}
          onSearch={noop}
          onFitColumns={noop}
          onResetColumns={noop}
          onToggleEditing={noop}
          transposed
          onToggleTranspose={onToggleTranspose}
          onImport={noop}
          onExportCsv={noop}
          onExportJson={noop}
          onExportSql={noop}
        />,
      );
    });

    const transposeButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Show standard grid"]',
    );
    expect(transposeButton?.getAttribute("aria-pressed")).toBe("true");
    expect(
      container.querySelector<HTMLButtonElement>(
        '[aria-label="Transpose view is read-only; return to the grid to edit"]',
      )?.disabled,
    ).toBe(true);

    await act(async () => {
      transposeButton?.click();
    });
    expect(onToggleTranspose).toHaveBeenCalledOnce();
  });
});
