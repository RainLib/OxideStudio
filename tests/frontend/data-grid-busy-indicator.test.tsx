/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { DataGridBusyIndicator } from "@/components/workspace/DataGridBusyIndicator";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("DataGridBusyIndicator", () => {
  let root: Root | null = null;
  let container: HTMLDivElement;

  afterEach(() => {
    root?.unmount();
    root = null;
    container?.remove();
  });

  it("uses an inline DataGrip-style table loading status", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      root = createRoot(container);
      root.render(<DataGridBusyIndicator kind="table" />);
    });

    const overlay = container.querySelector(
      '[data-testid="data-grid-busy-indicator"]'
    );
    const status = container.querySelector('[role="status"]');

    expect(overlay?.className).not.toContain("backdrop-blur");
    expect(status?.className).not.toContain("border");
    expect(status?.className).not.toContain("shadow");
    expect(status?.className).not.toContain("bg-");
    expect(status?.getAttribute("aria-label")).toBe("Fetching data...");
    expect(status?.textContent).toBe("Fetching data...");
  });

  it("uses query-specific progress copy", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      root = createRoot(container);
      root.render(<DataGridBusyIndicator kind="query" />);
    });

    expect(container.querySelector('[role="status"]')?.getAttribute("aria-label"))
      .toBe("Executing query...");
  });
});
