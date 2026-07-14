/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceUiActionRegistry } from "@/ai/ui-actions/workspaceRegistry";
import {
  captureWorkspaceUiActionContext,
  resetUiActionContextTracker,
} from "@/ai/ui-actions/context";
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

describe("workspace editor patch UI action", () => {
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
      activeTabId: "tab-1",
      closedTabsStack: [],
      tabs: [
        {
          id: "tab-1",
          title: "Query",
          type: "query",
          sql: "SELECT * FROM users",
          results: null,
          isExecuting: false,
          error: null,
          isPinned: false,
        },
      ],
    });
  });

  it("opens a before/after preview without applying it", async () => {
    const context = captureWorkspaceUiActionContext();
    const result = await createWorkspaceUiActionRegistry().execute({
      id: "preview-patch-1",
      action: "editor.previewPatch",
      target: {
        projectId: "project-a",
        tabId: "tab-1",
        patchId: "patch-1",
        range: {
          startLine: 1,
          startColumn: 8,
          endLine: 1,
          endColumn: 9,
        },
        originalText: "*",
        sql: "id, email",
        title: "Select explicit columns",
        rationale: "Avoid SELECT *",
      },
      issuedAgainst: {
        projectId: context.projectId,
        contextVersion: context.contextVersion,
        documentRevision: context.documentRevision,
      },
      presentation: { label: "Preview patch" },
    });

    expect(result).toMatchObject({ status: "success", code: "OK" });
    expect(useTabStore.getState().tabs[0]).toMatchObject({
      sql: "SELECT * FROM users",
      editorPatchPreview: {
        id: "patch-1",
        originalText: "*",
        replacement: "id, email",
        expectedRevision: context.documentRevision,
      },
    });
  });

  it("rejects opening the patch after the document revision changes", async () => {
    const context = captureWorkspaceUiActionContext();
    useTabStore.getState().updateTabSql("tab-1", "SELECT id FROM users");
    const result = await createWorkspaceUiActionRegistry().execute({
      id: "preview-patch-stale",
      action: "editor.previewPatch",
      target: {
        projectId: "project-a",
        tabId: "tab-1",
        patchId: "patch-stale",
        range: { startLine: 1, startColumn: 8, endLine: 1, endColumn: 9 },
        originalText: "*",
        sql: "id",
      },
      issuedAgainst: {
        projectId: context.projectId,
        contextVersion: context.contextVersion,
        documentRevision: context.documentRevision,
      },
      presentation: { label: "Preview stale patch" },
    });
    expect(result).toMatchObject({
      status: "stale",
      code: "DOCUMENT_REVISION_STALE",
    });
    expect(useTabStore.getState().tabs[0]?.editorPatchPreview).toBeUndefined();
  });

  it("rejects a patch whose before text does not match its range", async () => {
    const context = captureWorkspaceUiActionContext();
    const result = await createWorkspaceUiActionRegistry().execute({
      id: "preview-patch-invalid-before",
      action: "editor.previewPatch",
      target: {
        projectId: "project-a",
        tabId: "tab-1",
        patchId: "patch-invalid-before",
        range: { startLine: 1, startColumn: 8, endLine: 1, endColumn: 9 },
        originalText: "forged",
        sql: "id",
      },
      issuedAgainst: {
        projectId: context.projectId,
        contextVersion: context.contextVersion,
        documentRevision: context.documentRevision,
      },
      presentation: { label: "Preview invalid patch" },
    });
    expect(result).toMatchObject({
      status: "stale",
      code: "DOCUMENT_REVISION_STALE",
    });
    expect(useTabStore.getState().tabs[0]?.editorPatchPreview).toBeUndefined();
  });

  it("rejects patch preview on a non-editor tab", async () => {
    useTabStore.setState((state) => ({
      tabs: state.tabs.map((tab) => ({
        ...tab,
        type: "table" as const,
      })),
    }));
    const context = captureWorkspaceUiActionContext();
    const result = await createWorkspaceUiActionRegistry().execute({
      id: "preview-patch-table",
      action: "editor.previewPatch",
      target: {
        projectId: "project-a",
        tabId: "tab-1",
        patchId: "patch-table",
        range: { startLine: 1, startColumn: 8, endLine: 1, endColumn: 9 },
        originalText: "*",
        sql: "id",
      },
      issuedAgainst: {
        projectId: context.projectId,
        contextVersion: context.contextVersion,
        documentRevision: context.documentRevision,
      },
      presentation: { label: "Preview table patch" },
    });
    expect(result).toMatchObject({
      status: "invalid",
      code: "INVALID_TARGET",
    });
    expect(useTabStore.getState().tabs[0]?.editorPatchPreview).toBeUndefined();
  });
});
