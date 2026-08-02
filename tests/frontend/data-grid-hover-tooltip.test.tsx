/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { GridCellKind } from "@glideapps/glide-data-grid";
import {
  DataGridHoverTooltip,
  gridCellTooltipText,
} from "@/features/data-grid";

describe("data grid hover tooltip", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(async () => {
    if (root) {
      await act(async () => root?.unmount());
      root = null;
    }
    container?.remove();
    container = null;
  });

  it("uses the complete display value, including explicit NULL labels", () => {
    expect(
      gridCellTooltipText({
        kind: GridCellKind.Text,
        allowOverlay: false,
        displayData: "NULL",
        data: "",
      }),
    ).toBe("NULL");
    expect(
      gridCellTooltipText({
        kind: GridCellKind.Text,
        allowOverlay: false,
        displayData: "a long value that is clipped in the canvas",
        data: "a long value that is clipped in the canvas",
      }),
    ).toContain("clipped in the canvas");
  });

  it("replaces tooltip content when the hovered cell changes", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <DataGridHoverTooltip
          tooltip={{
            key: "0:0:first",
            x: 20,
            y: 20,
            columnName: "payload",
            columnType: "jsonb",
            columnComment: "Raw event payload from the ingest pipeline",
            content: "first value",
          }}
        />,
      );
    });
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
      "first value",
    );
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
      "Raw event payload from the ingest pipeline",
    );

    await act(async () => {
      root?.render(
        <DataGridHoverTooltip
          tooltip={{
            key: "0:1:second",
            x: 40,
            y: 40,
            columnName: "payload",
            columnType: "jsonb",
            content: "second value",
          }}
        />,
      );
    });
    const tooltips = document.querySelectorAll('[role="tooltip"]');
    expect(tooltips).toHaveLength(1);
    expect(tooltips[0]?.textContent).toContain("second value");
    expect(tooltips[0]?.textContent).not.toContain("first value");
  });
});
