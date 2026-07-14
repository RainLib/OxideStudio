import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SchemaSnapshot } from "@/services/tauri/types";

const mocks = vi.hoisted(() => ({
  captureSchemaSnapshot: vi.fn(),
  compareSchemaSnapshots: vi.fn(),
  saveResources: vi.fn(async () => undefined),
  getResources: vi.fn(async () => []),
  replaceResources: vi.fn(async () => undefined),
}));

vi.mock("@/services/tauri", () => ({
  schemaService: {
    captureSchemaSnapshot: mocks.captureSchemaSnapshot,
    compareSchemaSnapshots: mocks.compareSchemaSnapshots,
  },
  storeService: {
    saveResources: mocks.saveResources,
    getResources: mocks.getResources,
    replaceResources: mocks.replaceResources,
  },
}));

import {
  captureAndSaveSchemaSnapshot,
  compareSnapshotToLive,
  deleteSchemaSnapshot,
  listSchemaSnapshots,
  schemaSnapshotParentId,
} from "@/services/schemaSnapshotStore";

const identity = {
  projectId: "project-1",
  connectionId: "postgres-1",
  connectionName: "Local PostgreSQL",
  driver: "postgres" as const,
  databaseName: "app",
  schemaName: "public",
};

function snapshot(id: string, capturedAt: number): SchemaSnapshot {
  return {
    version: 1,
    id,
    fingerprint: `fingerprint-${id}`,
    projectId: identity.projectId,
    connectionId: identity.connectionId,
    connectionName: identity.connectionName,
    driver: identity.driver,
    databaseName: identity.databaseName,
    schemaName: identity.schemaName,
    capturedAt,
    relations: [],
    warnings: [],
  };
}

function resource(value: SchemaSnapshot) {
  return {
    id: value.id,
    project_id: value.projectId,
    connection_id: value.connectionId,
    parent_id: schemaSnapshotParentId(identity),
    kind: "SCHEMA_SNAPSHOT",
    name: value.id,
    metadata: value,
    last_updated: value.capturedAt,
  };
}

describe("schema snapshot store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("captures a live immutable snapshot and stores it under the scoped parent", async () => {
    const captured = snapshot("snapshot-1", 100);
    mocks.captureSchemaSnapshot.mockResolvedValue(captured);

    await expect(captureAndSaveSchemaSnapshot(identity)).resolves.toEqual(captured);
    expect(mocks.captureSchemaSnapshot).toHaveBeenCalledWith({
      projectId: identity.projectId,
      connectionId: identity.connectionId,
      connectionName: identity.connectionName,
      driver: identity.driver,
      database: identity.databaseName,
      schema: identity.schemaName,
    });
    expect(mocks.saveResources).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: captured.id,
          parent_id: schemaSnapshotParentId(identity),
          kind: "SCHEMA_SNAPSHOT",
          metadata: captured,
        }),
      ],
      identity.projectId,
    );
  });

  it("ignores malformed resources and returns newest snapshots first", async () => {
    const older = snapshot("older", 100);
    const newer = snapshot("newer", 200);
    mocks.getResources.mockResolvedValue([
      resource(older),
      { ...resource(newer), metadata: { version: 99 } },
      resource(newer),
    ]);

    await expect(listSchemaSnapshots(identity)).resolves.toEqual([newer, older]);
  });

  it("deletes one version by atomically replacing the snapshot collection", async () => {
    const older = snapshot("older", 100);
    const newer = snapshot("newer", 200);
    mocks.getResources.mockResolvedValue([resource(older), resource(newer)]);

    await deleteSchemaSnapshot(newer);

    expect(mocks.replaceResources).toHaveBeenCalledWith(
      identity.connectionId,
      schemaSnapshotParentId(identity),
      "SCHEMA_SNAPSHOT",
      [expect.objectContaining({ id: older.id, metadata: older })],
      identity.projectId,
    );
  });

  it("captures a fresh target before asking Rust for a migration plan", async () => {
    const source = snapshot("desired", 100);
    const target = snapshot("live", 200);
    const plan = { id: "diff-1" };
    mocks.captureSchemaSnapshot.mockResolvedValue(target);
    mocks.compareSchemaSnapshots.mockResolvedValue(plan);

    await expect(compareSnapshotToLive(source, identity)).resolves.toEqual({
      target,
      plan,
    });
    expect(mocks.compareSchemaSnapshots).toHaveBeenCalledWith(source, target);
  });
});
