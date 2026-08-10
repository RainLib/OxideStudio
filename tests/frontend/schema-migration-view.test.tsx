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

const mocks = vi.hoisted(() => ({
  listJournal: vi.fn(async () => []),
  executeMigration: vi.fn(),
}));

vi.mock("@/services/tauri/schema.service", () => ({
  schemaService: {
    listSchemaMigrationJournal: mocks.listJournal,
    executeSchemaMigration: mocks.executeMigration,
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const source: SchemaSnapshot = {
  version: 1,
  id: "source-1",
  fingerprint: "source-fingerprint",
  projectId: "project-1",
  connectionId: "source-connection",
  connectionName: "Desired",
  driver: "postgres",
  databaseName: "app",
  schemaName: "public",
  capturedAt: 1,
  relations: [],
  warnings: [],
};

function plan(driver: "postgres" | "mysql"): SchemaDiffPlan {
  return {
    id: `plan-${driver}`,
    sourceSnapshotId: source.id,
    targetSnapshotId: "target-1",
    driver,
    targetConnectionId: "target-connection",
    targetDatabaseName: "app",
    targetSchemaName: "public",
    generatedAt: 2,
    transactional: driver === "postgres",
    summary: { total: 1, safe: 0, review: 0, destructive: 1, blocked: 0 },
    changes: [
      {
        id: "change-1",
        kind: "columnDrop",
        risk: "destructive",
        schemaName: "public",
        relationName: "users",
        childName: "legacy",
        summary: "Drop users.legacy",
        sql: ['ALTER TABLE "public"."users" DROP COLUMN "legacy";'],
        reversible: false,
        manualReview: true,
        phase: "alterRelations",
        order: 1,
        dependsOn: [],
      },
    ],
    migrationSql: "-- migration preview\nROLLBACK;",
    preflightChecks: [
      {
        id: "check-1",
        changeId: "change-1",
        label: "Count values",
        sql: "SELECT COUNT(*) AS populated_rows FROM users",
        expectation: "Review populated_rows",
        assertion: "advisory",
        resultColumn: "populated_rows",
      },
    ],
    preflightSql: "-- preflight",
    warnings: [],
  };
}

function target(driver: "postgres" | "mysql"): SchemaSnapshot {
  return {
    ...source,
    id: "target-1",
    fingerprint: "target-fingerprint",
    connectionId: "target-connection",
    connectionName: "Production",
    driver,
  };
}

describe("SchemaDiffView migration confirmation", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    useProjectStore.setState({
      activeProjectId: "project-1",
      activeProjectName: "Project",
    });
    useTabStore.setState({ tabs: [], activeTabId: null, closedTabsStack: [] });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function renderPlan(driver: "postgres" | "mysql") {
    const currentPlan = plan(driver);
    useTabStore.getState().openSchemaDiffTab(currentPlan, source, target(driver));
    await act(async () => {
      root.render(<SchemaDiffView />);
    });
  }

  it("requires the exact schema and both risk approvals before PostgreSQL apply", async () => {
    await renderPlan("postgres");
    const apply = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Apply safely"),
    );
    expect(apply?.disabled).toBe(false);

    await act(async () => apply?.click());
    expect(container.textContent).toContain("Confirm transactional migration");
    const run = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Run preflight & apply"),
    );
    expect(run?.disabled).toBe(true);

    const schemaInput = container.querySelector<HTMLInputElement>('input[type="text"]');
    const approvals = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    await act(async () => {
      if (schemaInput) {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set?.call(schemaInput, "Production / app / public");
        schemaInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
      approvals.forEach((approval) => approval.click());
    });
    expect(approvals).toHaveLength(2);
    expect(run?.disabled).toBe(false);
    expect(mocks.executeMigration).not.toHaveBeenCalled();
  });

  it("requires an explicit partial-commit acknowledgement for MySQL DDL", async () => {
    await renderPlan("mysql");
    const apply = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Apply reviewed plan"),
    );

    expect(apply?.disabled).toBe(false);
    expect(apply?.title).toContain("preflight/apply");
    await act(async () => apply?.click());
    expect(container.textContent).toContain("Confirm non-transactional migration");
    expect(container.textContent).toContain("may leave earlier statements applied");

    const run = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Run preflight & apply"),
    );
    const schemaInput = container.querySelector<HTMLInputElement>('input[type="text"]');
    const approvals = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    await act(async () => {
      if (schemaInput) {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set?.call(schemaInput, "Production / app / public");
        schemaInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
      approvals.forEach((approval) => approval.click());
    });
    expect(approvals).toHaveLength(3);
    expect(run?.disabled).toBe(false);
  });

  it("keeps MariaDB's reviewed migration flow aligned with the backend alias", async () => {
    const mariaPlan: SchemaDiffPlan = {
      ...plan("mysql"),
      id: "plan-mariadb",
      driver: "mariadb",
    };
    const mariaTarget: SchemaSnapshot = {
      ...target("mysql"),
      driver: "mariadb",
    };
    useTabStore.getState().openSchemaDiffTab(mariaPlan, source, mariaTarget);
    await act(async () => {
      root.render(<SchemaDiffView />);
    });

    const apply = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Apply reviewed plan"),
    );
    expect(apply?.disabled).toBe(false);
    await act(async () => apply?.click());
    expect(container.textContent).toContain("Confirm non-transactional migration");
  });

  it("keeps project DDL baselines review-only even when the target is PostgreSQL", async () => {
    const offlineSource: SchemaSnapshot = {
      ...source,
      id: "project-ddl-source",
      fingerprint: "offline-fingerprint",
      warnings: ["OFFLINE_PROJECT_DDL_REVIEW_ONLY", "Source: db/schema.sql"],
    };
    useTabStore.getState().openSchemaDiffTab(plan("postgres"), offlineSource, target("postgres"));
    await act(async () => {
      root.render(<SchemaDiffView />);
    });

    const apply = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Apply safely"),
    );
    expect(apply?.disabled).toBe(true);
    expect(apply?.title).toContain("Project DDL baselines are review-only");
    expect(container.textContent).toContain("Capture a live baseline before creating an executable migration");
  });
});
