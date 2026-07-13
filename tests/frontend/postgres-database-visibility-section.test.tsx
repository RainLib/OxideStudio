/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PostgresDatabaseVisibilitySection } from "@/components/workspace/PostgresDatabaseVisibilitySection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("PostgresDatabaseVisibilitySection", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    root?.unmount();
    root = null;
    container.remove();
  });

  it("shows every discovered database in the visibility picker", async () => {
    const onToggleDatabase = vi.fn();
    await act(async () => {
      root = createRoot(container);
      root.render(
        <PostgresDatabaseVisibilitySection
          databases={["app", "analytics", "warehouse"]}
          currentDatabase="app"
          showAll={false}
          visibleDatabases={new Set(["app", "analytics"])}
          checkboxClassName="checkbox"
          connectionColor="#5b8dd6"
          onToggleAll={vi.fn()}
          onToggleDatabase={onToggleDatabase}
        />
      );
    });

    expect(container.textContent).toContain("All databases");
    expect(container.textContent).toContain("app");
    expect(container.textContent).toContain("analytics");
    expect(container.textContent).toContain("warehouse");
    expect(container.textContent).toContain("default");
    expect(container.textContent).not.toContain("connected");
    expect(container.textContent).not.toContain("Schemas in");

    await act(async () => {
      container
        .querySelector(
          '[data-postgres-database-visibility="warehouse"] button'
        )
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onToggleDatabase).toHaveBeenCalledWith("warehouse", true);
  });
});
