/**
 * @vitest-environment happy-dom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SchemaSnapshotDialog } from "@/components/workspace/SchemaSnapshotDialog";
import { useProjectStore } from "@/store/useProjectStore";

const mocks = vi.hoisted(() => ({
  listSnapshots: vi.fn(async () => []),
  saveSnapshot: vi.fn(async () => undefined),
  getLspDocuments: vi.fn(async () => [
    {
      relativePath: "db/schema.sql",
      content: "CREATE TABLE users (id bigint PRIMARY KEY);",
    },
  ]),
}));

vi.mock("@/services/schemaSnapshotStore", () => ({
  captureAndSaveSchemaSnapshot: vi.fn(),
  compareSnapshotToLive: vi.fn(),
  deleteSchemaSnapshot: vi.fn(),
  listSchemaSnapshots: mocks.listSnapshots,
  saveSchemaSnapshot: mocks.saveSnapshot,
}));

vi.mock("@/services/tauri", () => ({
  projectFilesService: {
    getLspDocuments: mocks.getLspDocuments,
  },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("SchemaSnapshotDialog project DDL baseline", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    useProjectStore.setState({
      projects: [
        {
          id: "project-1",
          name: "Project",
          root_path: "/workspace/project",
          created_at: 1,
          updated_at: 1,
        },
      ],
      activeProjectId: "project-1",
      activeProjectName: "Project",
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.querySelectorAll("[data-radix-focus-guard]").forEach((node) => node.remove());
  });

  it("creates a bounded project DDL snapshot that remains review-only", async () => {
    await act(async () => {
      root.render(
        <SchemaSnapshotDialog
          open
          identity={{
            projectId: "project-1",
            connectionId: "postgres-1",
            connectionName: "Postgres",
            driver: "postgres",
            databaseName: "app",
            schemaName: "public",
          }}
          onClose={vi.fn()}
        />,
      );
    });

    await vi.waitFor(() => {
      expect(mocks.getLspDocuments).toHaveBeenCalledWith({
        projectId: "project-1",
        expectedRoot: "/workspace/project",
      });
      expect(document.querySelector<HTMLSelectElement>("select[aria-label='Project DDL source']"))
        .not.toBeNull();
    });

    const createBaseline = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Create baseline"),
    );
    await act(async () => createBaseline?.click());

    await vi.waitFor(() => expect(mocks.saveSnapshot).toHaveBeenCalledTimes(1));
    const snapshot = mocks.saveSnapshot.mock.calls[0]?.[0];
    expect(snapshot).toMatchObject({
      projectId: "project-1",
      connectionId: "postgres-1",
      schemaName: "public",
      warnings: expect.arrayContaining([
        "OFFLINE_PROJECT_DDL_REVIEW_ONLY",
        "Source: db/schema.sql",
      ]),
    });
  });

  it("uses the bounded eligible SQL set by default", async () => {
    mocks.getLspDocuments.mockResolvedValueOnce([
      {
        relativePath: "db/tables.sql",
        content: "CREATE TABLE users (id bigint PRIMARY KEY);",
      },
      {
        relativePath: "db/indexes.sql",
        content: "CREATE INDEX users_id_idx ON users (id);",
      },
    ]);
    await act(async () => {
      root.render(
        <SchemaSnapshotDialog
          open
          identity={{
            projectId: "project-1",
            connectionId: "postgres-1",
            connectionName: "Postgres",
            driver: "postgres",
            schemaName: "public",
          }}
          onClose={vi.fn()}
        />,
      );
    });

    await vi.waitFor(() => {
      expect(document.querySelector<HTMLSelectElement>("select[aria-label='Project DDL source']")?.value)
        .toBe("__oxide_all_project_sql__");
    });
    const createBaseline = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Create baseline"),
    );
    await act(async () => createBaseline?.click());

    await vi.waitFor(() => expect(mocks.saveSnapshot).toHaveBeenCalledTimes(1));
    const snapshot = mocks.saveSnapshot.mock.calls[0]?.[0];
    expect(snapshot.warnings).toEqual(expect.arrayContaining([
      "Source: db/indexes.sql",
      "Source: db/tables.sql",
    ]));
  });
});
