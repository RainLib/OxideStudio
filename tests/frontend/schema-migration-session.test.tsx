// @vitest-environment happy-dom
import { useSchemaMigrationSession } from "@/features/schema-diff/hooks/useSchemaMigrationSession";
import type {
  SchemaDiffPlan,
  SchemaMigrationJournalEntry,
} from "@/services/tauri/types";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ listJournal: vi.fn() }));
vi.mock("@/services/tauri/schema.service", () => ({
  schemaService: { listSchemaMigrationJournal: mocks.listJournal },
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function plan(id: string): SchemaDiffPlan {
  return {
    id,
    sourceSnapshotId: "source",
    targetSnapshotId: id,
    driver: "postgres",
    targetConnectionId: id,
    targetSchemaName: "public",
    generatedAt: 1,
    transactional: true,
    summary: { total: 0, safe: 0, review: 0, destructive: 0, blocked: 0 },
    changes: [],
    migrationSql: `-- ${id}`,
    preflightChecks: [],
    preflightSql: "-- checks",
    warnings: [],
  };
}
function journal(id: string): SchemaMigrationJournalEntry {
  return {
    id,
    projectId: "project",
    connectionId: id,
    connectionName: id,
    schemaName: "public",
    planId: id,
    sourceFingerprint: "source",
    targetFingerprintBefore: id,
    status: "succeeded",
    startedAt: 1,
    statementCount: 0,
    committedStatements: 0,
    preflightResults: [],
    rollback: { available: false, changeCount: 0, requiresManualReview: false },
    warnings: [],
  };
}
let root: Root;
let container: HTMLDivElement;
let session: ReturnType<typeof useSchemaMigrationSession>;
function Harness(props: Parameters<typeof useSchemaMigrationSession>[0]) {
  session = useSchemaMigrationSession(props);
  return null;
}
beforeEach(() => {
  mocks.listJournal.mockReset().mockResolvedValue([]);
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
});

it("keeps the current plan journal when a previous plan finishes loading later", async () => {
  const old = deferred<SchemaMigrationJournalEntry[]>();
  mocks.listJournal
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce([journal("new")]);
  await act(async () =>
    root.render(<Harness activeProjectId="project" plan={plan("old")} />),
  );
  await act(async () =>
    root.render(<Harness activeProjectId="project" plan={plan("new")} />),
  );
  await act(async () => old.resolve([journal("old")]));
  expect(session.recentExecutions.map((entry) => entry.id)).toEqual(["new"]);
  expect(mocks.listJournal).toHaveBeenLastCalledWith("project", "new", 12);
});

it("clears approvals and receipts when moving to a different plan", async () => {
  await act(async () =>
    root.render(<Harness activeProjectId="project" plan={plan("old")} />),
  );
  await act(async () => {
    session.setConfirmationOpen(true);
    session.setConfirmationTarget("old / public");
    session.setAllowReview(true);
    session.setAllowDestructive(true);
    session.setAllowNonTransactional(true);
    session.setExecution(journal("old"));
    session.setExecutionError("previous failure");
    session.setPreviewSurface("run");
  });
  await act(async () =>
    root.render(<Harness activeProjectId="project" plan={plan("new")} />),
  );
  expect(session.confirmationOpen).toBe(false);
  expect(session.confirmationTarget).toBe("");
  expect([
    session.allowReview,
    session.allowDestructive,
    session.allowNonTransactional,
  ]).toEqual([false, false, false]);
  expect(session.execution).toBeNull();
  expect(session.executionError).toBeNull();
  expect(session.previewSql).toBe("-- new");
});

it("isolates journal loading when only the project changes", async () => {
  const old = deferred<SchemaMigrationJournalEntry[]>(),
    currentPlan = plan("same");
  mocks.listJournal
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce([journal("new-project")]);
  await act(async () =>
    root.render(<Harness activeProjectId="old-project" plan={currentPlan} />),
  );
  await act(async () =>
    root.render(<Harness activeProjectId="new-project" plan={currentPlan} />),
  );
  await act(async () => old.resolve([journal("old-project")]));
  expect(session.recentExecutions.map((entry) => entry.id)).toEqual([
    "new-project",
  ]);
});
