/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DataCompareView } from "@/components/workspace/DataCompareView";
import { useTabStore } from "@/store/useTabStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("DataCompareView", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
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
});
