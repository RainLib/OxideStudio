/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceUiActionRegistry } from "@/ai/ui-actions/workspaceRegistry";
import {
  captureWorkspaceUiActionContext,
  resetUiActionContextTracker,
} from "@/ai/ui-actions/context";
import { APP_EVENT_REVEAL_PLAN_NODE } from "@/lib/explainPlanNavigation";
import { DEFAULT_APP_SETTINGS } from "@/lib/appSettings";
import { useProjectStore } from "@/store/useProjectStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTabStore } from "@/store/useTabStore";

vi.mock("@/services/tauri/settings.service", () => ({
  settingsService: {
    saveAppSettings: vi.fn(async () => undefined),
    getAppSettings: vi.fn(async () => ({})),
    resetAppSettings: vi.fn(async () => undefined),
  },
}));

describe("workspace Explain Plan UI action", () => {
  beforeEach(() => {
    resetUiActionContextTracker();
    useProjectStore.setState({
      activeProjectId: "project-a",
      activeProjectName: "Project A",
    });
    useSettingsStore.setState({
      settings: structuredClone(DEFAULT_APP_SETTINGS),
      isLoading: false,
      error: null,
    });
    useTabStore.setState({
      activeTabId: "tab-other",
      closedTabsStack: [],
      tabs: [
        {
          id: "tab-1",
          title: "Query",
          type: "query",
          sql: "SELECT 1",
          results: null,
          explainPlan: {
            id: "plan-1",
            driver: "postgres",
            mode: "estimate",
            format: "json",
            generatedInMs: 1,
            root: {
              id: "node-0",
              nodeType: "Result",
              children: [{ id: "node-1", nodeType: "Seq Scan", children: [] }],
            },
            rawPlan: {},
            warnings: [],
          },
          queryOutputView: "results",
          isExecuting: false,
          error: null,
          isPinned: false,
        },
        {
          id: "tab-other",
          title: "Other",
          type: "query",
          sql: "SELECT 2",
          results: null,
          isExecuting: false,
          error: null,
          isPinned: false,
        },
      ],
    });
    window.requestAnimationFrame = (callback) => {
      callback(0);
      return 1;
    };
  });

  it("activates the plan surface and emits the exact stable node target", async () => {
    const revealed = vi.fn();
    window.addEventListener(APP_EVENT_REVEAL_PLAN_NODE, revealed);
    const context = captureWorkspaceUiActionContext();
    const registry = createWorkspaceUiActionRegistry();

    const result = await registry.execute({
      id: "action-plan-1",
      action: "plan.revealNode",
      target: {
        projectId: "project-a",
        tabId: "tab-1",
        planId: "plan-1",
        nodeId: "node-1",
      },
      issuedAgainst: {
        projectId: context.projectId,
        contextVersion: context.contextVersion,
      },
      presentation: { label: "Reveal Seq Scan" },
    });

    expect(result).toMatchObject({ status: "success", code: "OK" });
    expect(useTabStore.getState().activeTabId).toBe("tab-1");
    expect(useTabStore.getState().tabs[0]?.queryOutputView).toBe("plan");
    expect(
      useSettingsStore.getState().settings.workbench.layout.visibility.results,
    ).toBe(true);
    expect(revealed).toHaveBeenCalledTimes(1);
    const event = revealed.mock.calls[0]?.[0] as CustomEvent;
    expect(event.detail).toEqual({
      tabId: "tab-1",
      planId: "plan-1",
      nodeId: "node-1",
    });
  });

  it("returns notFound when a stale plan node no longer exists", async () => {
    const context = captureWorkspaceUiActionContext();
    const result = await createWorkspaceUiActionRegistry().execute({
      id: "action-plan-stale",
      action: "plan.revealNode",
      target: {
        projectId: "project-a",
        tabId: "tab-1",
        planId: "plan-1",
        nodeId: "node-missing",
      },
      issuedAgainst: {
        projectId: context.projectId,
        contextVersion: context.contextVersion,
      },
      presentation: { label: "Reveal missing node" },
    });

    expect(result).toMatchObject({
      status: "notFound",
      code: "TARGET_NOT_FOUND",
    });
  });
});
