/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LeftPanel } from "@/components/workspace/LeftPanel";
import { WorkspacePage } from "@/pages/workspace";
import { useTabStore } from "@/store/useTabStore";

vi.mock("@/theme/useTheme", () => ({
  useTheme: () => ({
    mode: "dark",
    theme: {},
    toggleTheme: vi.fn(),
    setTheme: vi.fn(),
  }),
}));

vi.mock("@/components/workspace/SchemaSidebar", () => ({
  SchemaSidebar: () => <div data-testid="schema-sidebar" />,
}));

vi.mock("@/components/workspace/HistorySidebar", () => ({
  HistorySidebar: () => <div data-testid="history-sidebar" />,
}));

vi.mock("@/components/workspace/SavedQueriesSidebar", () => ({
  SavedQueriesSidebar: () => <div data-testid="saved-queries-sidebar" />,
}));

vi.mock("@/components/workspace/QueryEditor", () => ({
  QueryEditor: () => <div data-testid="query-editor" />,
}));

vi.mock("@/components/workspace/DataGrid", () => ({
  DataGrid: () => <div data-testid="data-grid" />,
}));

vi.mock("@/components/workspace/QueryShortcuts", () => ({
  QueryShortcuts: () => <div data-testid="query-shortcuts" />,
}));

vi.mock("@/components/workspace/TabBar", () => ({
  TabBar: () => <div data-testid="tab-bar" />,
}));

vi.mock("@/components/workspace/TableDataView", () => ({
  TableDataView: () => <div data-testid="table-data-view" />,
}));

vi.mock("@/components/workspace/CreateTableTab", () => ({
  CreateTableTab: () => <div data-testid="create-table-tab" />,
}));

vi.mock("@/components/workspace/CommandPalette", () => ({
  CommandPalette: () => <div data-testid="command-palette" />,
}));

vi.mock("@/components/workspace/AssistantSidebar", () => ({
  AssistantSidebar: () => <aside data-testid="assistant-sidebar">Assistant Panel</aside>,
}));

const initialTabState = useTabStore.getState();

function buttonWithText(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.includes(text)
  );
}

describe("workspace assistant entry", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    useTabStore.setState({
      ...initialTabState,
      tabs: [
        {
          id: "query-1",
          title: "Query #1",
          type: "query",
          sql: "select 1",
          results: null,
          isExecuting: false,
          error: null,
          isPinned: false,
        },
      ],
      activeTabId: "query-1",
      closedTabsStack: [],
    });
  });

  afterEach(() => {
    root?.unmount();
    root = null;
    container.remove();
    useTabStore.setState(initialTabState, true);
  });

  it("keeps assistant out of the left activity bar", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(
        <LeftPanel
          activeTab="tables"
          onTabClick={vi.fn()}
          isDrawerOpen
          sidebarWidth={280}
          onDragStart={vi.fn()}
        />
      );
    });

    const buttonTitles = Array.from(container.querySelectorAll("button"))
      .map((button) => button.getAttribute("title") || "")
      .filter(Boolean);

    expect(buttonTitles).toEqual(
      expect.arrayContaining([
        "Entities (Tables)",
        "History",
        "Saved Queries",
      ])
    );
    expect(buttonTitles.some((title) => /assistant|ai/i.test(title))).toBe(false);
  });

  it("exposes a working assistant toggle in the top app bar", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<WorkspacePage />);
    });

    const assistantToggle = buttonWithText(container, "Assistant");
    expect(assistantToggle).toBeTruthy();
    expect(assistantToggle?.getAttribute("title")).toBe("Hide AI Assistant");
    expect(assistantToggle?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector("[data-testid='assistant-sidebar']")).toBeTruthy();

    await act(async () => {
      assistantToggle?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });

    expect(assistantToggle?.getAttribute("title")).toBe("Show AI Assistant");
    expect(assistantToggle?.getAttribute("aria-pressed")).toBe("false");
  });
});
