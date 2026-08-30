// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TableDataToolbar } from "./TableDataToolbar";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("TableDataToolbar reviewed document actions", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
  });

  it("enables reviewed MongoDB actions for exactly one selected read-only grid row", async () => {
    const onEditDocument = vi.fn();
    const onDeleteDocument = vi.fn();
    const onCloneDocument = vi.fn();
    await act(async () => {
      root.render(
        <TableDataToolbar
          isExecuting={false}
          readOnly
          exportFormats={[]}
          editingEnabled={false}
          hasEdits={false}
          editedCellCount={0}
          newRowCount={0}
          selectedRowCount={1}
          onRefresh={() => undefined}
          onAddRow={() => undefined}
          onDeleteRows={() => undefined}
          onEditDocument={onEditDocument}
          onDeleteDocument={onDeleteDocument}
          onCloneDocument={onCloneDocument}
          onSave={() => undefined}
          onRevert={() => undefined}
          onSearch={() => undefined}
          onFitColumns={() => undefined}
          onResetColumns={() => undefined}
          onToggleEditing={() => undefined}
          onImportCsv={() => undefined}
          onImportJson={() => undefined}
          onImportXlsx={() => undefined}
          onExportCsv={() => undefined}
          onExportCsvBom={() => undefined}
          onExportJson={() => undefined}
          onExportJsonl={() => undefined}
          onExportMarkdown={() => undefined}
          onExportSql={() => undefined}
          onExportTsv={() => undefined}
          onExportXlsx={() => undefined}
          onExportParquet={() => undefined}
          onExportArrow={() => undefined}
        />,
      );
    });

    const edit = document.querySelector<HTMLButtonElement>(
      '[aria-label="Edit selected MongoDB document"]',
    );
    const clone = document.querySelector<HTMLButtonElement>(
      '[aria-label="Clone selected MongoDB document"]',
    );
    const remove = document.querySelector<HTMLButtonElement>(
      '[aria-label="Review deletion of selected MongoDB document"]',
    );
    expect(edit?.disabled).toBe(false);
    expect(clone?.disabled).toBe(false);
    expect(remove?.disabled).toBe(false);

    await act(async () => {
      edit?.click();
      clone?.click();
      remove?.click();
    });
    expect(onEditDocument).toHaveBeenCalledTimes(1);
    expect(onCloneDocument).toHaveBeenCalledTimes(1);
    expect(onDeleteDocument).toHaveBeenCalledTimes(1);
    expect(
      document.querySelector<HTMLButtonElement>('[aria-label="Add row"]')?.disabled,
    ).toBe(true);
  });
});
