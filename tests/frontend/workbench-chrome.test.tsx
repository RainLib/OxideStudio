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
import { requestTaskReveal, useTaskNavigationStore } from "@/lib/taskNavigation";

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
    useTaskNavigationStore.setState({ request: null });
  });

  afterEach(() => {
    root?.unmount();
    root = null;
    container.remove();
  });

  it("shows project context until an editor tab is active", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(
        <WorkbenchStatusBar
          isIntrospecting={false}
          secondaryPanelOpen={false}
          onToggleSecondaryPanel={vi.fn()}
        />
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
        />
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

    await act(async () => {
      root = createRoot(container);
      root.render(
        <WorkbenchTitleTools
          databaseExplorerOpen
          databaseExplorerSide="left"
          secondaryPanelOpen={false}
          secondaryPanelView="assistant"
          assistantSide="right"
          onToggleDatabaseExplorer={onToggleDatabaseExplorer}
          onToggleAssistant={onToggleAssistant}
          onToggleFiles={onToggleFiles}
        />
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

    expect(mocks.listAssistantTasks).toHaveBeenCalledWith("project-a");
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

    await act(async () => {
      requestTaskReveal({
        projectId: "project-a",
        taskId: "agent:details",
      });
    });

    expect(container.querySelector('[data-task-id="agent:details"]')).not.toBeNull();
    expect(container.textContent).toContain("Recorded steps");
    expect(container.textContent).toContain("Inspect schema");
    expect(container.textContent).toContain("metadata.listObjects");
    expect(container.textContent).toContain("approval");
    expect(container.textContent).toContain("Safe summary only");
  });
});
