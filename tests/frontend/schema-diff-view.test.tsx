/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SchemaDiffView } from "@/components/workspace/SchemaDiffView";
import type { SchemaDiffPlan, SchemaSnapshot } from "@/services/tauri/types";
import { useProjectStore } from "@/store/useProjectStore";
import { useTabStore } from "@/store/useTabStore";

vi.mock("@/services/tauri/settings.service", () => ({
  settingsService: {
    saveAppSettings: vi.fn(async () => undefined),
    getAppSettings: vi.fn(async () => ({})),
    resetAppSettings: vi.fn(async () => undefined),
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const snapshot: SchemaSnapshot = {
  version: 1,
  id: "snapshot-1",
  fingerprint: "fingerprint-1",
  projectId: "project-1",
  connectionId: "connection-1",
  connectionName: "Local PostgreSQL",
  driver: "postgres",
  databaseName: "app",
  schemaName: "public",
  capturedAt: 1,
  relations: [],
  warnings: [],
};

const plan: SchemaDiffPlan = {
  id: "diff-1",
  sourceSnapshotId: snapshot.id,
  targetSnapshotId: "snapshot-live",
  driver: "postgres",
  targetConnectionId: snapshot.connectionId,
  targetDatabaseName: snapshot.databaseName,
  targetSchemaName: snapshot.schemaName,
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
  migrationSql: "-- migration\nALTER TABLE users DROP COLUMN legacy;",
  preflightChecks: [
    {
      id: "check-1",
      changeId: "change-1",
      label: "Count populated values before column drop",
      sql: "SELECT COUNT(*) AS populated_rows FROM users;",
      expectation: "Review populated_rows.",
    },
  ],
  preflightSql: "-- preflight\nSELECT COUNT(*) AS populated_rows FROM users;",
  warnings: [],
};

describe("SchemaDiffView", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    useProjectStore.setState({ activeProjectId: "project-1" });
    useTabStore.setState({ tabs: [], activeTabId: null, closedTabsStack: [] });
    useTabStore.getState().openSchemaDiffTab(plan, snapshot, {
      ...snapshot,
      id: "snapshot-live",
    });
  });

  afterEach(() => {
    root?.unmount();
    root = null;
    container.remove();
  });

  it("switches to read-only preflight and opens those checks in a scoped console", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(<SchemaDiffView />);
    });

    expect(container.textContent).toContain("ALTER TABLE users DROP COLUMN legacy");
    const preflightButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Preflight 1"),
    );
    await act(async () => {
      preflightButton?.click();
    });

    expect(container.textContent).toContain("SELECT COUNT(*) AS populated_rows");
    expect(container.textContent).toContain("Read-only validation queries");

    const openButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Open in console"),
    );
    await act(async () => {
      openButton?.click();
    });

    const activeTab = useTabStore
      .getState()
      .tabs.find((tab) => tab.id === useTabStore.getState().activeTabId);
    expect(activeTab).toMatchObject({
      type: "query",
      connectionId: "connection-1",
      databaseName: "app",
      schemaName: "public",
      sql: plan.preflightSql,
    });
  });

  it("does not open a partial migration console while any change is blocked", async () => {
    const blockedPlan: SchemaDiffPlan = {
      ...plan,
      id: "diff-blocked",
      summary: { ...plan.summary, blocked: 1 },
      changes: [
        {
          ...plan.changes[0],
          blockedReason: "An exact dependency rebuild is unavailable.",
          sql: [],
          phase: "manualReview",
        },
      ],
      migrationSql: "-- PLAN BLOCKED",
    };
    useTabStore.setState({ tabs: [], activeTabId: null, closedTabsStack: [] });
    useTabStore.getState().openSchemaDiffTab(blockedPlan, snapshot, snapshot);

    await act(async () => {
      root = createRoot(container);
      root.render(<SchemaDiffView />);
    });

    const openButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Open in console"));
    expect(openButton?.disabled).toBe(true);
    expect(openButton?.title).toContain("Resolve blocked changes");
  });

  it("keeps descriptor-only schema object changes visible but out of executable migration SQL", async () => {
    const descriptorPlan: SchemaDiffPlan = {
      ...plan,
      id: "diff-schema-object",
      summary: { total: 1, safe: 0, review: 1, destructive: 0, blocked: 1 },
      changes: [
        {
          id: "schema-object-1",
          kind: "schemaObjectCreate",
          risk: "review",
          schemaName: "public",
          relationName: "audit_events_id_seq",
          objectType: "SEQUENCE",
          summary: "Review creation of SEQUENCE audit_events_id_seq",
          sql: [],
          reversible: false,
          manualReview: true,
          phase: "manualReview",
          order: 1,
          dependsOn: [],
          blockedReason:
            "Schema object descriptors do not include source/DDL; review and apply this change manually.",
        },
      ],
      migrationSql: "-- PLAN BLOCKED\n-- descriptor-only schema object",
    };
    useTabStore.setState({ tabs: [], activeTabId: null, closedTabsStack: [] });
    useTabStore.getState().openSchemaDiffTab(descriptorPlan, snapshot, snapshot);

    await act(async () => {
      root = createRoot(container);
      root.render(<SchemaDiffView />);
    });

    expect(container.querySelector("[data-schema-object-review-summary]")?.textContent)
      .toContain("Source DDL is not captured");
    const change = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("audit_events_id_seq"),
    );
    await act(async () => change?.click());
    expect(container.querySelector("[data-schema-object-review-detail]")?.textContent)
      .toContain("not emitted in this migration preview");
    const apply = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Apply safely"),
    );
    expect(apply?.disabled).toBe(true);
  });
});
