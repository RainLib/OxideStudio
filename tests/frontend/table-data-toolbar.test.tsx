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

  it("routes visible grid commands and exposes zoom state", async () => {
    const onSearch = vi.fn();
    const onFitColumns = vi.fn();
    const onZoomIn = vi.fn();
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
          selectedRowCount={0}
          zoomPercent={100}
          onRefresh={noop}
          onAddRow={noop}
          onDeleteRows={noop}
          onSave={noop}
          onRevert={noop}
          onSearch={onSearch}
          onFitColumns={onFitColumns}
          onResetColumns={noop}
          onZoomOut={noop}
          onZoomReset={noop}
          onZoomIn={onZoomIn}
          onToggleEditing={noop}
          onImport={noop}
          onExportCsv={noop}
          onExportJson={noop}
        />
      );
    });

    expect(container.textContent).toContain("100%");
    expect(
      container.querySelector<HTMLButtonElement>('[aria-label="Select rows to delete"]')
        ?.disabled
    ).toBe(true);

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="Find in data grid"]')?.click();
      container.querySelector<HTMLButtonElement>('[aria-label="Fit all columns"]')?.click();
      container
        .querySelector<HTMLButtonElement>('[aria-label^="Zoom in"]')
        ?.click();
    });

    expect(onSearch).toHaveBeenCalledOnce();
    expect(onFitColumns).toHaveBeenCalledOnce();
    expect(onZoomIn).toHaveBeenCalledOnce();
  });
});
