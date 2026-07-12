/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GridFilterRow } from "@/components/workspace/GridFilterRow";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("GridFilterRow", () => {
  let root: Root | null = null;
  let container: HTMLDivElement;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container?.remove();
  });

  it("keeps the default WHERE editor compact and applies on Enter", async () => {
    const onSearch = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      root = createRoot(container);
      root.render(
        <GridFilterRow
          columns={[{ id: "name", title: "name", width: 120 }]}
          mode="visual"
          visualFilters={[{ column: "name", operator: "contains", value: "Ada" }]}
          sqlFilter=""
          onModeChange={vi.fn()}
          onVisualFiltersChange={vi.fn()}
          onSqlFilterChange={vi.fn()}
          onSearch={onSearch}
        />
      );
    });

    expect(container.textContent).toContain("WHERE");
    expect(container.querySelectorAll("input")).toHaveLength(1);

    await act(async () => {
      container
        .querySelector("input")
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onSearch).toHaveBeenCalledOnce();
  });

  it("supports a direct SQL WHERE condition without the visual builder", async () => {
    const onModeChange = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      root = createRoot(container);
      root.render(
        <GridFilterRow
          columns={[]}
          mode="sql"
          visualFilters={[]}
          sqlFilter="status = 'active'"
          onModeChange={onModeChange}
          onVisualFiltersChange={vi.fn()}
          onSqlFilterChange={vi.fn()}
          onSearch={vi.fn()}
        />
      );
    });

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("WHERE"))
        ?.click();
    });
    expect(onModeChange).toHaveBeenCalledWith("visual");
  });
});
