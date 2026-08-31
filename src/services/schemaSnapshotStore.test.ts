import { describe, expect, it, vi } from "vitest";

const captureSchemaSnapshot = vi.hoisted(() => vi.fn());
const compareSchemaSnapshots = vi.hoisted(() => vi.fn());

vi.mock("@/services/tauri", () => ({
  schemaService: {
    captureSchemaSnapshot,
    compareSchemaSnapshots,
  },
  storeService: {},
}));

import { compareSnapshotToLive } from "./schemaSnapshotStore";

describe("compareSnapshotToLive", () => {
  it("reports actual capture and comparison milestones in execution order", async () => {
    const source = { id: "source" } as never;
    const target = { id: "target" } as never;
    const plan = { id: "plan" } as never;
    captureSchemaSnapshot.mockResolvedValue(target);
    compareSchemaSnapshots.mockResolvedValue(plan);
    const phases: string[] = [];

    await expect(
      compareSnapshotToLive(
        source,
        {
          projectId: "project",
          connectionId: "connection",
          connectionName: "Target",
          driver: "postgres",
          schemaName: "public",
        },
        (phase) => phases.push(phase),
      ),
    ).resolves.toEqual({ target, plan });

    expect(phases).toEqual(["capture-target", "compare-snapshots"]);
    expect(compareSchemaSnapshots).toHaveBeenCalledWith(source, target);
  });
});
