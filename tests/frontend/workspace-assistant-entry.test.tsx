/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LeftPanel } from "@/components/workspace/LeftPanel";
import { WorkspacePage } from "@/pages/workspace";
import { DEFAULT_APP_SETTINGS } from "@/lib/appSettings";
import { moveSideToolWindow } from "@/lib/workbenchLayout";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTabStore } from "@/store/useTabStore";

const settingsMocks = vi.hoisted(() => ({
  getAppSettings: vi.fn(),
  saveAppSettings: vi.fn().mockResolvedValue(undefined),
  resetAppSettings: vi.fn(),
}));

vi.mock("@/theme/useTheme", () => ({
  useTheme: () => ({
    mode: "dark",
    theme: {},
    toggleTheme: vi.fn(),
    setTheme: vi.fn(),
  }),
}));

vi.mock("@/components/workspace/SchemaSidebar", () => ({
  SchemaSidebar: () => (
    <div data-testid="schema-sidebar">Database Explorer</div>
  ),
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
  AssistantSidebar: () => (
    <aside data-testid="assistant-sidebar">Assistant Panel</aside>
  ),
}));

vi.mock("@/services/tauri/settings.service", () => ({
  settingsService: settingsMocks,
}));

vi.mock("@/components/workspace/ProjectFilesSidebar", () => ({
  ProjectFilesSidebar: () => (
    <aside data-testid="project-files-sidebar">Project Files</aside>
  ),
}));

const initialTabState = useTabStore.getState();
const initialSettingsState = useSettingsStore.getState();

describe("database workspace entry", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    useTabStore.setState({
      ...initialTabState,
      tabs: [],
      activeTabId: null,
      closedTabsStack: [],
    });
    useSettingsStore.setState({ settings: DEFAULT_APP_SETTINGS });
    settingsMocks.getAppSettings.mockImplementation(
      async () => useSettingsStore.getState().settings,
    );
  });

  afterEach(() => {
    root?.unmount();
    root = null;
    container.remove();
    useTabStore.setState(initialTabState, true);
    useSettingsStore.setState(initialSettingsState, true);
  });

  it("renders the database explorer as the left panel without an activity rail", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(
        <LeftPanel
          activeTab="tables"
          onTabClick={vi.fn()}
          isDrawerOpen
          sidebarWidth={280}
          onDragStart={vi.fn()}
        />,
      );
    });

    expect(
      container.querySelector("[data-testid='schema-sidebar']"),
    ).toBeTruthy();
    const buttonTitles = Array.from(container.querySelectorAll("button"))
      .map((button) => button.getAttribute("title") || "")
      .filter(Boolean);
    expect(buttonTitles.some((title) => /assistant|ai/i.test(title))).toBe(
      false,
    );
  });

  it("opens directly into an empty database workspace", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<WorkspacePage />);
    });

    expect(
      container.querySelector("[data-testid='schema-sidebar']"),
    ).toBeTruthy();
    expect(
      container.querySelector("[data-testid='query-shortcuts']"),
    ).toBeTruthy();
    expect(container.querySelector("[data-testid='tab-bar']")).toBeFalsy();
    expect(
      container.querySelector("[data-testid='assistant-sidebar']"),
    ).toBeNull();
    expect(
      container.querySelector("[data-testid='project-files-sidebar']"),
    ).toBeNull();
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (button) =>
          button.getAttribute("title") === "Toggle AI Assistant (right)",
      ),
    ).toBe(true);
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (button) =>
          button.getAttribute("title") === "Toggle Project Files (right)",
      ),
    ).toBe(true);

    const filesButton = Array.from(container.querySelectorAll("button")).find(
      (button) =>
        button.getAttribute("title") === "Toggle Project Files (right)",
    );
    await act(async () => filesButton?.click());
    expect(
      container
        .querySelector("#secondary-panel-files")
        ?.classList.contains("hidden"),
    ).toBe(false);
    expect(container.querySelector("#secondary-panel-assistant")).toBeNull();
  });

  it("renders side tool windows in their configured dock positions", async () => {
    useSettingsStore.setState({
      settings: {
        ...DEFAULT_APP_SETTINGS,
        workbench: moveSideToolWindow(
          DEFAULT_APP_SETTINGS.workbench,
          "databaseExplorer",
          "right",
        ),
      },
    });

    await act(async () => {
      root = createRoot(container);
      root.render(<WorkspacePage />);
    });

    const assistantButton = Array.from(
      container.querySelectorAll("button"),
    ).find(
      (button) => button.getAttribute("title") === "Toggle AI Assistant (left)",
    );
    await act(async () => assistantButton?.click());

    const explorerDock = container
      .querySelector("[data-testid='schema-sidebar']")
      ?.closest("[data-tool-window-side]");
    const assistantDock = container
      .querySelector("[data-testid='assistant-sidebar']")
      ?.closest("[data-tool-window-side]");

    expect(explorerDock?.getAttribute("data-tool-window-side")).toBe("right");
    expect(assistantDock?.getAttribute("data-tool-window-side")).toBe("left");
  });
});
