import { describe, expect, it } from "vitest";
import {
  collapsedDatabaseSchemaTargets,
  collapsedSchemaMetadataTargets,
  runSidebarSearchTasks,
} from "./sidebarSearchTasks";

describe("runSidebarSearchTasks", () => {
  it("bounds concurrent metadata tasks while retaining their input order", async () => {
    let active = 0;
    let maximum = 0;
    const results = await runSidebarSearchTasks(
      Array.from({ length: 7 }, (_, index) => async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 0));
        active -= 1;
        return index;
      }),
      2,
    );

    expect(maximum).toBe(2);
    expect(results).toEqual(
      Array.from({ length: 7 }, (_, index) => ({
        status: "fulfilled",
        value: index,
      })),
    );
  });

  it("keeps one failed node isolated from other search work", async () => {
    const results = await runSidebarSearchTasks([
      async () => "public",
      async () => {
        throw new Error("metadata unavailable");
      },
      async () => "audit",
    ]);

    expect(results[0]).toEqual({ status: "fulfilled", value: "public" });
    expect(results[1]?.status).toBe("rejected");
    expect(results[2]).toEqual({ status: "fulfilled", value: "audit" });
  });

  it("loads collapsed catalog levels only when a cached search unit is incomplete", () => {
    const cache = {
      schemas: { archive: ["public"] },
      tables: { archive: { public: [] } },
      objects: { archive: {} },
    };
    expect(
      collapsedDatabaseSchemaTargets(["app", "archive", "analytics"], "app", cache),
    ).toEqual(["analytics"]);
    expect(
      collapsedSchemaMetadataTargets(
        new Map([
          ["archive", ["public"]],
          ["analytics", ["reporting", "audit"]],
        ]),
        cache,
      ),
    ).toEqual([
      { database: "archive", schema: "public" },
      { database: "analytics", schema: "reporting" },
      { database: "analytics", schema: "audit" },
    ]);
  });
});
