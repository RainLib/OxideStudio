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
import type { SchemaDiffPlan, SchemaSnapshot } from "@/services/tauri/types";
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

const snapshot: SchemaSnapshot = {
  version: 1,
  id: "snapshot-1",
  fingerprint: "fingerprint",
  projectId: "project-a",
  connectionId: "connection-1",
  connectionName: "Local",
  driver: "postgres",
  schemaName: "public",
  capturedAt: 1,
  relations: [],
  warnings: [],
};

const plan: SchemaDiffPlan = {
  id: "diff-1",
  sourceSnapshotId: "snapshot-1",
  targetSnapshotId: "snapshot-live",
  driver: "postgres",
  targetConnectionId: "connection-1",
  targetSchemaName: "public",
  generatedAt: 2,
  transactional: true,
  summary: { total: 1, safe: 0, review: 0, destructive: 1, blocked: 0 },
  changes: [
    {
      id: "change-1",
      kind: "columnDrop",
      risk: "destructive",
      schemaName: "public",
      relationName: "users",
      childName: "legacy",
      summary: "Drop target-only column users.legacy",
      sql: ["ALTER TABLE users DROP COLUMN legacy;"],
      reversible: false,
      manualReview: true,
      phase: "alterRelations",
      order: 1,
      dependsOn: [],
    },
  ],
  migrationSql: "-- preview",
  preflightChecks: [],
  preflightSql: "-- no checks",
  warnings: [],
};

describe("workspace schema diff UI action", () => {
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
      activeTabId: null,
      closedTabsStack: [],
      tabs: [],
    });
  });

  it("reuses a stable artifact tab and reveals the exact change", async () => {
    const tabStore = useTabStore.getState();
    const tabId = tabStore.openSchemaDiffTab(plan, snapshot, {
      ...snapshot,
      id: "snapshot-live",
    });
    expect(tabStore.openSchemaDiffTab(plan, snapshot, snapshot)).toBe(tabId);
    expect(useTabStore.getState().tabs).toHaveLength(1);

    useTabStore.setState({ activeTabId: null });
    const context = captureWorkspaceUiActionContext();
    const result = await createWorkspaceUiActionRegistry().execute({
      id: "reveal-change",
      action: "schemaDiff.revealChange",
      target: {
        projectId: "project-a",
        tabId,
        schemaDiffId: plan.id,
        schemaChangeId: "change-1",
      },
      issuedAgainst: {
        projectId: context.projectId,
        contextVersion: context.contextVersion,
      },
      presentation: { label: "Reveal schema change" },
    });

    expect(result).toMatchObject({ status: "success", code: "OK" });
    expect(useTabStore.getState().activeTabId).toBe(tabId);
    expect(useTabStore.getState().tabs[0]?.selectedSchemaChangeId).toBe(
      "change-1",
    );
  });

  it("returns notFound for a stale change id", async () => {
    const tabId = useTabStore
      .getState()
      .openSchemaDiffTab(plan, snapshot, snapshot);
    const context = captureWorkspaceUiActionContext();
    const result = await createWorkspaceUiActionRegistry().execute({
      id: "stale-change",
      action: "schemaDiff.revealChange",
      target: {
        projectId: "project-a",
        tabId,
        schemaDiffId: plan.id,
        schemaChangeId: "missing",
      },
      issuedAgainst: {
        projectId: context.projectId,
        contextVersion: context.contextVersion,
      },
      presentation: { label: "Reveal missing change" },
    });

    expect(result).toMatchObject({
      status: "notFound",
      code: "TARGET_NOT_FOUND",
    });
  });
});
