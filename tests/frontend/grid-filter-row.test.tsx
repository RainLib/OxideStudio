/**
 * @vitest-environment happy-dom
 */
import { act, useState } from "react";
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

    expect(container.textContent).toContain("SORT");

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("WHERE"))
        ?.click();
    });
    expect(onModeChange).toHaveBeenCalledWith("visual");
  });

  it("opens table-column completion with Ctrl+Space and accepts it", async () => {
    const onSqlFilterChange = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      root = createRoot(container);
      root.render(
        <GridFilterRow
          columns={[
            { id: "status", title: "status", width: 120 },
            { id: "created_at", title: "created_at", width: 120 },
          ]}
          mode="sql"
          visualFilters={[]}
          sqlFilter=""
          onModeChange={vi.fn()}
          onVisualFiltersChange={vi.fn()}
          onSqlFilterChange={onSqlFilterChange}
          onSearch={vi.fn()}
          driver="postgres"
          tabId="table-users"
          schemaName="public"
          tableName="users"
        />,
      );
    });

    const input = container.querySelector("input")!;
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "Space",
          key: " ",
          ctrlKey: true,
          bubbles: true,
        }),
      );
    });
    expect(container.querySelector('[role="listbox"]')).not.toBeNull();

    await act(async () => {
      Array.from(container.querySelectorAll('[role="option"]'))
        .find((option) => option.textContent?.includes("status"))
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSqlFilterChange).toHaveBeenCalledWith("status = ");
    expect(container.querySelector('[role="listbox"]')).not.toBeNull();
  });

  it("places the caret inside an accepted LIKE pattern snippet", async () => {
    function ControlledFilterRow() {
      const [filter, setFilter] = useState("name LIKE ");
      return (
        <GridFilterRow
          columns={[
            {
              id: "name",
              title: "name",
              width: 120,
              dataType: "varchar",
            } as never,
          ]}
          mode="sql"
          visualFilters={[]}
          sqlFilter={filter}
          onModeChange={vi.fn()}
          onVisualFiltersChange={vi.fn()}
          onSqlFilterChange={setFilter}
          onSearch={vi.fn()}
          driver="postgres"
          tabId="table-users"
          schemaName="public"
          tableName="users"
        />
      );
    }

    container = document.createElement("div");
    document.body.appendChild(container);

    await act(async () => {
      root = createRoot(container);
      root.render(<ControlledFilterRow />);
    });

    const input = container.querySelector("input")!;
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "Space",
          key: " ",
          ctrlKey: true,
          bubbles: true,
        }),
      );
    });
    const pattern = Array.from(container.querySelectorAll('[role="option"]')).find(
      (option) => option.textContent?.includes("'%…%'"),
    );
    expect(pattern).toBeDefined();

    await act(async () => {
      pattern?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(input.value).toBe("name LIKE '%%' ");
    expect(input.selectionStart).toBe("name LIKE '%".length);
    expect(input.selectionEnd).toBe("name LIKE '%".length);
  });
});
