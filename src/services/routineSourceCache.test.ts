import { describe, expect, it, vi } from "vitest";
import {
  RoutineSourceCache,
  routineSourceCacheKey,
  type RoutineSourceIdentity,
} from "./routineSourceCache";

describe("RoutineSourceCache", () => {
  it("deduplicates concurrent loads", async () => {
    const cache = new RoutineSourceCache(100, 8, 1_000);
    let resolve!: (value: string[]) => void;
    const loader = vi.fn(
      () =>
        new Promise<string[]>((done) => {
          resolve = done;
        }),
    );

    const first = cache.load("routine", loader, { now: 1 });
    const second = cache.load("routine", loader, { now: 2 });
    expect(loader).toHaveBeenCalledTimes(1);
    resolve(["CREATE FUNCTION f() RETURNS int AS $$ SELECT 1 $$"]);
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });

  it("makes normal readers join an active force refresh", async () => {
    const cache = new RoutineSourceCache(100, 8, 1_000);
    await cache.load("routine", async () => ["old"], { now: 1 });
    let resolve!: (value: string[]) => void;
    const forced = cache.load(
      "routine",
      () =>
        new Promise<string[]>((done) => {
          resolve = done;
        }),
      { force: true, now: 2 },
    );
    const normalLoader = vi.fn(async () => ["unexpected"]);
    const normal = cache.load("routine", normalLoader, { now: 3 });
    resolve(["new"]);

    await expect(Promise.all([forced, normal])).resolves.toEqual([
      ["new"],
      ["new"],
    ]);
    expect(normalLoader).not.toHaveBeenCalled();
  });

  it("does not repopulate an invalidated in-flight entry", async () => {
    const cache = new RoutineSourceCache(100, 8, 1_000);
    let resolve!: (value: string[]) => void;
    const stale = cache.load(
      "scope:routine",
      () =>
        new Promise<string[]>((done) => {
          resolve = done;
        }),
      { now: 1 },
    );
    cache.invalidatePrefix("scope:");
    resolve(["stale"]);
    await expect(stale).resolves.toEqual(["stale"]);
    expect(cache.size).toBe(0);
  });

  it("refreshes expired entries and does not retain oversized definitions", async () => {
    const cache = new RoutineSourceCache(10, 8, 5);
    await cache.load("routine", async () => ["old"], { now: 1 });
    const refresh = vi.fn(async () => ["fresh"]);
    await expect(cache.load("routine", refresh, { now: 12 })).resolves.toEqual([
      "fresh",
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(1);

    await cache.load("large", async () => ["123456"], { now: 1 });
    expect(cache.size).toBe(1);
  });

  it("separates package, database, schema and overload-name scopes", () => {
    const identity: RoutineSourceIdentity = {
      projectId: "project",
      connectionId: "connection",
      driver: "postgres",
      driverPackageVersion: "bundled@1",
      connectionDatabaseName: "app",
      schema: "public",
      routine: "calculate",
    };
    expect(routineSourceCacheKey(identity)).not.toBe(
      routineSourceCacheKey({
        ...identity,
        driverPackageVersion: "sidecar@2",
      }),
    );
    expect(routineSourceCacheKey(identity)).not.toBe(
      routineSourceCacheKey({ ...identity, connectionDatabaseName: "audit" }),
    );
    expect(routineSourceCacheKey(identity)).not.toBe(
      routineSourceCacheKey({ ...identity, schema: "reporting" }),
    );
    expect(routineSourceCacheKey(identity)).not.toBe(
      routineSourceCacheKey({ ...identity, routine: "calculate_v2" }),
    );
  });
});
