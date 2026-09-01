/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TabBar } from "@/components/workspace/TabBar";
import { DEFAULT_APP_SETTINGS } from "@/lib/appSettings";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTabStore, type TabData } from "@/store/useTabStore";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function tab(
  id: string,
  title: string,
  connectionId: string,
  createdAt: number,
  isPinned = false,
): TabData {
  return {
    id,
    title,
    type: "query",
    connectionId,
    createdAt,
    sql: "",
    results: null,
    isExecuting: false,
    error: null,
    isPinned,
  };
}

describe("TabBar organization", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    container.style.width = "900px";
    container.style.height = "500px";
    document.body.appendChild(container);
    useSettingsStore.setState({
      settings: structuredClone(DEFAULT_APP_SETTINGS),
      error: null,
    });
    useConnectionStore.setState({
      connections: [
        {
          id: "a-postgres",
          name: "Application",
          driver: "postgres",
          url: "postgres://localhost/app",
        },
        {
          id: "b-mysql",
          name: "Orders",
          driver: "mysql",
          url: "mysql://localhost/orders",
        },
      ],
      activeConnectionId: "a-postgres",
    });
    useTabStore.setState({
      tabs: [],
      activeTabId: null,
      closedTabsStack: [],
    });
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    container.remove();
    document.body.innerHTML = "";
  });

  it("renders the configured vertical edge and exact grouped title order", async () => {
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        editor: {
          ...state.settings.editor,
          tabPlacement: "right",
          tabGroupMode: "connection",
          tabSortMode: "title-asc",
        },
      },
    }));
    useTabStore.setState({
      tabs: [
        tab("zeta", "Query 10", "a-postgres", 3),
        tab("orders", "Orders", "b-mysql", 2),
        tab("alpha", "Query 2", "a-postgres", 1),
      ],
      activeTabId: "alpha",
    });

    await act(async () => {
      root = createRoot(container);
      root.render(<TabBar />);
    });

    const tabBar = container.querySelector('[data-tab-placement="right"]');
    expect(tabBar).not.toBeNull();
    expect(tabBar?.getAttribute("data-tab-group-mode")).toBe("connection");
    expect(tabBar?.textContent).toContain("Application");
    expect(tabBar?.textContent).toContain("Orders");
    expect(
      [...container.querySelectorAll<HTMLElement>("[data-tab-id]")].map(
        (element) => element.dataset.tabId,
      ),
    ).toEqual(["alpha", "zeta", "orders"]);
  });

  it("keeps a pinned region ahead of creation-time sorted regular tabs", async () => {
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        editor: {
          ...state.settings.editor,
          tabSortMode: "created-asc",
        },
      },
    }));
    useTabStore.setState({
      tabs: [
        tab("newer", "Newer", "a-postgres", 20),
        tab("pinned", "Pinned", "a-postgres", 30, true),
        tab("older", "Older", "a-postgres", 10),
      ],
      activeTabId: "older",
    });

    await act(async () => {
      root = createRoot(container);
      root.render(<TabBar />);
    });

    expect(
      [...container.querySelectorAll<HTMLElement>("[data-tab-id]")].map(
        (element) => element.dataset.tabId,
      ),
    ).toEqual(["pinned", "older", "newer"]);
    expect(
      container
        .querySelector<HTMLElement>('[data-tab-id="newer"]')
        ?.getAttribute("draggable"),
    ).not.toBe("true");
    await act(async () => {
      container
        .querySelector<HTMLElement>('[data-tab-id="older"]')
        ?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
        );
    });
    expect(useTabStore.getState().activeTabId).toBe("newer");
  });
});
