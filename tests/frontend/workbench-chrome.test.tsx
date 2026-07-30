/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WorkbenchGlobalTools,
  WorkbenchStatusBar,
  WorkbenchTitleTools,
} from "@/components/workspace/WorkbenchChrome";
import { APP_EVENT_OPEN_COMMAND_PALETTE } from "@/lib/actions";
import { useProjectStore } from "@/store/useProjectStore";
import { useTaskStore } from "@/store/useTaskStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { DEFAULT_APP_SETTINGS } from "@/lib/appSettings";
import {
  requestTaskReveal,
  useTaskNavigationStore,
} from "@/lib/taskNavigation";

const mocks = vi.hoisted(() => ({
  listAssistantTasks: vi.fn(async () => []),
  clearAssistantTasks: vi.fn(async () => undefined),
}));

vi.mock("@/services/tauri/assistant-task.service", () => ({
  assistantTaskService: {
    list: mocks.listAssistantTasks,
    clearFinished: mocks.clearAssistantTasks,
  },
}));

describe("WorkbenchChrome", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    useProjectStore.setState({ activeProjectName: "sqls" });
    useTaskStore.setState({ tasks: [] });
    useSettingsStore.setState({ settings: DEFAULT_APP_SETTINGS });
    useTaskNavigationStore.setState({ request: null });
  });

  afterEach(() => {
    root?.unmount();
    root = null;
    container.remove();
  });

  async function activateTaskStatusCenter() {
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Background Tasks"]',
    );
    expect(trigger).toBeTruthy();
    await act(async () => {
      trigger?.focus();
      await Promise.resolve();
    });
  }

  it("shows project context until an editor tab is active", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(
        <WorkbenchStatusBar
          isIntrospecting={false}
          secondaryPanelOpen={false}
          onToggleSecondaryPanel={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("sqls");
    expect(container.textContent).not.toContain("Database");

    await act(async () => {
      root?.render(
        <WorkbenchStatusBar
          activeConnectionName="Local Postgres"
          currentSchema="public"
          activeTabTitle="Query #1"
          isIntrospecting={false}
          secondaryPanelOpen={false}
          onToggleSecondaryPanel={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("Database");
    expect(container.textContent).toContain("Local Postgres");
    expect(container.textContent).toContain("public");
    expect(container.textContent).toContain("Query #1");
  });

  it("keeps title tool buttons wired to their tool windows", async () => {
    const onToggleDatabaseExplorer = vi.fn();
    const onToggleAssistant = vi.fn();
    const onToggleFiles = vi.fn();
    const onToggleCommit = vi.fn();
    const onToggleVersionControl = vi.fn();

    await act(async () => {
      root = createRoot(container);
      root.render(
        <WorkbenchTitleTools
          databaseExplorerOpen
          databaseExplorerSide="left"
          assistantOpen={false}
          assistantSide="right"
          projectFilesOpen={false}
          projectFilesSide="right"
          commitOpen={false}
          commitPinned={false}
          versionControlOpen={false}
          versionControlPinned={false}
          onToggleDatabaseExplorer={onToggleDatabaseExplorer}
          onToggleAssistant={onToggleAssistant}
          onToggleFiles={onToggleFiles}
          onToggleCommit={onToggleCommit}
          onToggleVersionControl={onToggleVersionControl}
          onSetCommitPinned={vi.fn()}
          onSetVersionControlPinned={vi.fn()}
        />,
      );
    });

    const buttons = container.querySelectorAll("button");
    expect(buttons[0]?.getAttribute("aria-pressed")).toBe("true");
    expect(buttons[1]?.getAttribute("aria-pressed")).toBe("false");
    expect(buttons[2]?.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      buttons[0]?.click();
      buttons[1]?.click();
      buttons[2]?.click();
    });

    expect(onToggleDatabaseExplorer).toHaveBeenCalledOnce();
    expect(onToggleAssistant).toHaveBeenCalledOnce();
    expect(onToggleFiles).toHaveBeenCalledOnce();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="More tool windows"]')
        ?.click();
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain("Commit");
    expect(document.body.textContent).toContain("Version Control");
    const menuButtons = Array.from(document.body.querySelectorAll("button"));
    await act(async () => {
      menuButtons.find((button) => button.textContent?.includes("Commit"))?.click();
      menuButtons
        .find((button) => button.textContent?.includes("Version Control"))
        ?.click();
    });
    expect(onToggleCommit).toHaveBeenCalledOnce();
    expect(onToggleVersionControl).toHaveBeenCalledOnce();
  });

  it("shows the configured shortcut in the title tool hover treatment", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(
        <WorkbenchTitleTools
          databaseExplorerOpen
          databaseExplorerSide="left"
          assistantOpen={false}
          assistantSide="right"
          projectFilesOpen={false}
          projectFilesSide="right"
          commitOpen={false}
          commitPinned={false}
          versionControlOpen={false}
          versionControlPinned={false}
          onToggleDatabaseExplorer={vi.fn()}
          onToggleAssistant={vi.fn()}
          onToggleFiles={vi.fn()}
          onToggleCommit={vi.fn()}
          onToggleVersionControl={vi.fn()}
          onSetCommitPinned={vi.fn()}
          onSetVersionControlPinned={vi.fn()}
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Toggle Database Explorer"]',
    );
    expect(trigger?.hasAttribute("title")).toBe(false);
    await act(async () => {
      trigger?.focus();
      await Promise.resolve();
    });
    const shortcut = document.body.querySelector<HTMLElement>(
      '[data-workbench-shortcut="workbench.toggleDatabaseExplorer"]',
    );
    expect(shortcut?.textContent).toMatch(/^(?:⌘|Ctrl) 1$/u);
    expect(document.body.textContent).toContain("Left tool window");
  });

  it("pins menu tools into the title bar and exposes unpin on the pinned tool", async () => {
    const onSetCommitPinned = vi.fn();
    const onSetVersionControlPinned = vi.fn();
    const commonProps = {
      databaseExplorerOpen: true,
      databaseExplorerSide: "left" as const,
      assistantOpen: false,
      assistantSide: "right" as const,
      projectFilesOpen: false,
      projectFilesSide: "right" as const,
      commitOpen: false,
      versionControlOpen: false,
      onToggleDatabaseExplorer: vi.fn(),
      onToggleAssistant: vi.fn(),
      onToggleFiles: vi.fn(),
      onToggleCommit: vi.fn(),
      onToggleVersionControl: vi.fn(),
      onSetCommitPinned,
      onSetVersionControlPinned,
    };

    await act(async () => {
      root = createRoot(container);
      root.render(
        <WorkbenchTitleTools
          {...commonProps}
          commitPinned={false}
          versionControlPinned={false}
        />,
      );
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="More tool windows"]')
        ?.click();
      await Promise.resolve();
    });
    const pinCommit = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Pin Commit to title bar"]',
    );
    expect(pinCommit).not.toBeNull();
    await act(async () => {
      pinCommit?.click();
    });
    expect(onSetCommitPinned).toHaveBeenCalledWith(true);

    await act(async () => {
      root?.render(
        <WorkbenchTitleTools
          {...commonProps}
          commitPinned
          versionControlPinned={false}
        />,
      );
    });
    expect(
      container.querySelector('button[aria-label="Toggle Commit"]'),
    ).not.toBeNull();
    const unpinCommit = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Unpin Commit from title bar"]',
    );
    expect(unpinCommit).not.toBeNull();
    await act(async () => {
      unpinCommit?.click();
    });
    expect(onSetCommitPinned).toHaveBeenCalledWith(false);

    await act(async () => {
      root?.render(
        <WorkbenchTitleTools
          {...commonProps}
          commitPinned
          versionControlPinned
        />,
      );
    });
    expect(
      container.querySelector('button[aria-label="More tool windows"]'),
    ).toBeNull();
  });

  it("opens the command palette from the global search control", async () => {
    const listener = vi.fn();
    window.addEventListener(APP_EVENT_OPEN_COMMAND_PALETTE, listener);

    await act(async () => {
      root = createRoot(container);
      root.render(<WorkbenchGlobalTools />);
    });

    await act(async () => {
      container.querySelector("button")?.click();
    });

    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(APP_EVENT_OPEN_COMMAND_PALETTE, listener);
  });

  it("hydrates interrupted and approval-waiting agent tasks for the active project", async () => {
    useProjectStore.setState({
      activeProjectId: "project-a",
      activeProjectName: "Project A",
    });
    mocks.listAssistantTasks.mockResolvedValueOnce([
      {
        id: "agent:waiting",
        projectId: "project-a",
        requestId: "request-1",
        sessionId: "old-session",
        status: "awaiting_approval",
        title: "Assistant agent task",
        detail: "Waiting for approval",
        progress: 0.5,
        checkpoint: {
          version: 1,
          mode: "agent",
          plan: [],
          completedSteps: [],
        },
        createdAt: 10,
        updatedAt: 20,
        finishedAt: null,
      },
      {
        id: "agent:interrupted",
        projectId: "project-a",
        requestId: "request-2",
        sessionId: "old-session",
        status: "interrupted",
        title: "Assistant agent task",
        detail: "Application closed before the task completed",
        checkpoint: {
          version: 1,
          mode: "agent",
          plan: [],
          completedSteps: [],
        },
        createdAt: 30,
        updatedAt: 40,
        finishedAt: 40,
      },
    ]);

    await act(async () => {
      root = createRoot(container);
      root.render(
        <WorkbenchStatusBar
          isIntrospecting={false}
          secondaryPanelOpen={false}
          onToggleSecondaryPanel={vi.fn()}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    await activateTaskStatusCenter();
    await vi.waitFor(() => {
      expect(mocks.listAssistantTasks).toHaveBeenCalledWith("project-a");
    });
    expect(useTaskStore.getState().tasks).toEqual([
      expect.objectContaining({ id: "agent:waiting", status: "waiting" }),
      expect.objectContaining({
        id: "agent:interrupted",
        status: "interrupted",
      }),
    ]);
  });

  it("opens an exact task summary and recorded steps from semantic navigation", async () => {
    useProjectStore.setState({
      activeProjectId: "project-a",
      activeProjectName: "Project A",
    });
    mocks.listAssistantTasks.mockResolvedValueOnce([
      {
        id: "agent:details",
        projectId: "project-a",
        requestId: "request-details",
        sessionId: "session-current",
        status: "awaiting_approval",
        title: "Assistant agent task",
        detail: "Waiting for approval",
        progress: 0.5,
        checkpoint: {
          version: 1,
          mode: "agent",
          plan: [
            {
              id: "step-1",
              title: "Inspect schema",
              toolName: "metadata.listObjects",
              requiresApproval: false,
            },
            {
              id: "step-2",
              title: "Apply reviewed change",
              toolName: "table.updateRows",
              requiresApproval: true,
            },
          ],
          completedSteps: [
            {
              id: "step-1",
              toolName: "metadata.listObjects",
              status: "success",
            },
          ],
        },
        createdAt: 10,
        updatedAt: 20,
        finishedAt: null,
      },
    ]);

    await act(async () => {
      root = createRoot(container);
      root.render(
        <WorkbenchStatusBar
          isIntrospecting={false}
          secondaryPanelOpen={false}
          onToggleSecondaryPanel={vi.fn()}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    await activateTaskStatusCenter();
    await vi.waitFor(() => {
      expect(mocks.listAssistantTasks).toHaveBeenCalledWith("project-a");
    });

    await act(async () => {
      requestTaskReveal({
        projectId: "project-a",
        taskId: "agent:details",
      });
    });

    await vi.waitFor(() => {
      expect(
        container.querySelector('[data-task-id="agent:details"]'),
      ).not.toBeNull();
    });
    expect(container.textContent).toContain("Recorded steps");
    expect(container.textContent).toContain("Inspect schema");
    expect(container.textContent).toContain("metadata.listObjects");
    expect(container.textContent).toContain("approval");
    expect(container.textContent).toContain("Safe summary only");

    await act(async () => {
      useTaskStore.getState().upsertTask({
        id: "agent:uncertain",
        kind: "agent",
        title: "Assistant agent task",
        detail: "Stopped with an action requiring verification",
        status: "cancelled",
        startedAt: 30,
        finishedAt: 40,
        projectId: "project-a",
        persistent: true,
        steps: [
          {
            id: "step-write",
            title: "Update rows",
            toolName: "query.runMutation",
            requiresApproval: true,
            status: "uncertain",
          },
        ],
      });
      requestTaskReveal({
        projectId: "project-a",
        taskId: "agent:uncertain",
      });
    });

    expect(container.textContent).toContain("may have reached the target");
    expect(container.textContent).toContain(
      "will not be replayed automatically",
    );
  });
});
