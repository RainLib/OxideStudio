// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ExplorerSegmentedVirtualList,
  ExplorerVirtualizationHost,
  ExplorerVirtualList,
} from "./ExplorerVirtualList";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("ExplorerVirtualList", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    host.dataset.explorerScrollRoot = "";
    Object.defineProperty(host, "clientHeight", {
      configurable: true,
      value: 240,
    });
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
  });

  it("renders small directories normally", async () => {
    await act(async () => {
      root.render(
        <ExplorerVirtualList
          items={["one", "two"]}
          getKey={(item) => item}
          renderItem={(item) => <div data-row={item}>{item}</div>}
        />,
      );
    });

    expect(host.querySelector('[data-virtualized="false"]')).not.toBeNull();
    expect(host.querySelectorAll("[data-row]")).toHaveLength(2);
  });

  it("windows large directories against the shared explorer scroller", async () => {
    const items = Array.from({ length: 600 }, (_, index) => `table-${index}`);
    await act(async () => {
      root.render(
        <ExplorerVirtualList
          items={items}
          getKey={(item) => item}
          renderItem={(item) => <div data-row={item}>{item}</div>}
        />,
      );
    });

    expect(host.querySelector('[data-virtualized="true"]')).not.toBeNull();
    expect(host.querySelectorAll("[data-row]").length).toBeGreaterThan(0);
    expect(host.querySelectorAll("[data-row]").length).toBeLessThan(600);
  });

  it("windows small directories when their shared tree budget is large", async () => {
    const first = Array.from({ length: 300 }, (_, index) => `table-${index}`);
    const second = Array.from({ length: 300 }, (_, index) => `view-${index}`);
    await act(async () => {
      root.render(
        <ExplorerVirtualizationHost>
          <div>
            <ExplorerVirtualList
              items={first}
              getKey={(item) => item}
              renderItem={(item) => <div data-row={item}>{item}</div>}
            />
            <ExplorerVirtualList
              items={second}
              getKey={(item) => item}
              renderItem={(item) => <div data-row={item}>{item}</div>}
            />
          </div>
        </ExplorerVirtualizationHost>,
      );
    });

    expect(host.querySelectorAll('[data-virtualized="true"]')).toHaveLength(2);
    expect(host.querySelectorAll("[data-row]").length).toBeLessThan(600);
  });

  it("keeps every row mounted while variable-height children are open", async () => {
    const items = Array.from({ length: 600 }, (_, index) => `table-${index}`);
    await act(async () => {
      root.render(
        <ExplorerVirtualList
          items={items}
          getKey={(item) => item}
          renderItem={(item) => <div data-row={item}>{item}</div>}
          disabled
        />,
      );
    });

    expect(host.querySelector('[data-virtualized="false"]')).not.toBeNull();
    expect(host.querySelectorAll("[data-row]")).toHaveLength(600);
  });

  it("inherits compact row height for nested metadata directories", async () => {
    const items = Array.from({ length: 600 }, (_, index) => `column-${index}`);
    await act(async () => {
      root.render(
        <ExplorerVirtualizationHost rowHeight={22}>
          <ExplorerVirtualList
            items={items}
            getKey={(item) => item}
            renderItem={(item) => <button>{item}</button>}
          />
        </ExplorerVirtualizationHost>,
      );
    });
    expect(
      host.querySelector<HTMLElement>('[data-virtualized="true"]')!.style
        .height,
    ).toBe("13200px");
    expect(
      host.querySelector<HTMLElement>("[data-explorer-virtual-index]")!.style
        .height,
    ).toBe("22px");
  });

  it("recomputes the window when an earlier subtree collapses without scrolling", async () => {
    const items = Array.from({ length: 600 }, (_, index) => `table-${index}`);
    await act(async () => {
      root.render(
        <ExplorerVirtualList
          items={items}
          getKey={(item) => item}
          renderItem={(item) => <button data-row={item}>{item}</button>}
        />,
      );
    });
    const directory = host.querySelector<HTMLElement>(
      '[data-virtualized="true"]',
    )!;
    directory.getBoundingClientRect = () => ({ top: -5600 }) as DOMRect;
    await act(async () => {
      host.insertBefore(document.createElement("div"), directory);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.querySelector('[data-row="table-200"]')).not.toBeNull();
    expect(host.querySelector('[data-row="table-0"]')).toBeNull();
  });

  it("keeps expanded rows in flow while windowing fixed runs around them", async () => {
    const items = Array.from({ length: 600 }, (_, index) => `table-${index}`);
    await act(async () => {
      root.render(
        <ExplorerVirtualizationHost>
          <ExplorerSegmentedVirtualList
            items={items}
            getKey={(item) => item}
            isExpanded={(item) => item === "table-300"}
            renderItem={(item) => (
              <div data-row={item}>
                {item}
                {item === "table-300" && <div data-expanded-metadata />}
              </div>
            )}
          />
        </ExplorerVirtualizationHost>,
      );
    });

    expect(host.querySelector('[data-row="table-300"]')).not.toBeNull();
    expect(host.querySelector("[data-expanded-metadata]")).not.toBeNull();
    expect(host.querySelectorAll('[data-virtualized="true"]')).toHaveLength(2);
    expect(host.querySelectorAll("[data-row]").length).toBeLessThan(600);
  });

  it("scrolls the shared tree when keyboard navigation crosses its window", async () => {
    const items = Array.from({ length: 600 }, (_, index) => `table-${index}`);
    await act(async () => {
      root.render(
        <ExplorerVirtualList
          items={items}
          getKey={(item) => item}
          renderItem={(item) => (
            <div role="treeitem" tabIndex={0} data-row={item}>
              {item}
            </div>
          )}
        />,
      );
    });

    const rows = host.querySelectorAll<HTMLElement>(
      "[data-explorer-virtual-index]",
    );
    const last = rows
      .item(rows.length - 1)
      .querySelector<HTMLElement>('[role="treeitem"]');
    await act(async () => {
      last?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });

    expect(host.scrollTop).toBeGreaterThan(0);
  });
});
