import { describe, expect, it, vi } from "vitest";
import {
  DocumentMetadataCache,
  documentMetadataCacheKey,
  documentMetadataCacheScope,
} from "./documentMetadataCache";

describe("DocumentMetadataCache", () => {
  it("shares an in-flight metadata discovery between editor tabs", async () => {
    let resolve!: (value: string[]) => void;
    const loader = vi.fn(
      () => new Promise<string[]>((done) => {
        resolve = done;
      }),
    );
    const cache = new DocumentMetadataCache<string[]>(60_000, 8);

    const first = cache.get("scope\u0000indices", loader, 1);
    const second = cache.get("scope\u0000indices", loader, 2);
    expect(loader).toHaveBeenCalledTimes(1);
    resolve(["orders"]);
    await expect(first).resolves.toEqual(["orders"]);
    await expect(second).resolves.toEqual(["orders"]);
  });

  it("serves a stale catalog while a single refresh runs in the background", async () => {
    const cache = new DocumentMetadataCache<string[]>(10, 8);
    await cache.get("scope\u0000indices", async () => ["previous"], 1);
    let resolve!: (value: string[]) => void;
    const refresh = vi.fn(
      () => new Promise<string[]>((done) => {
        resolve = done;
      }),
    );

    await expect(cache.get("scope\u0000indices", refresh, 12)).resolves.toEqual([
      "previous",
    ]);
    await expect(cache.get("scope\u0000indices", refresh, 13)).resolves.toEqual([
      "previous",
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
    resolve(["current"]);
    await Promise.resolve();
    await Promise.resolve();
    await expect(cache.get("scope\u0000indices", refresh, 14)).resolves.toEqual([
      "current",
    ]);
  });

  it("bounds entries and isolates invalidation to one connection scope", async () => {
    const cache = new DocumentMetadataCache<string[]>(60_000, 2);
    await cache.get("one\u0000first", async () => ["first"], 1);
    await cache.get("one\u0000second", async () => ["second"], 2);
    await cache.get("two\u0000first", async () => ["third"], 3);
    expect(cache.size).toBe(2);
    cache.invalidateScope("two");
    expect(cache.size).toBe(1);
  });

  it("uses a stable, driver-scoped identity for collections and fields", () => {
    const identity = {
      projectId: "project",
      connectionId: "connection",
      driver: "elasticsearch",
    };
    expect(documentMetadataCacheScope(identity)).toContain("elasticsearch");
    expect(
      documentMetadataCacheKey({
        ...identity,
        namespace: "default",
        kind: "fields",
        objectName: "orders",
      }),
    ).not.toEqual(
      documentMetadataCacheKey({
        ...identity,
        namespace: "default",
        kind: "collections",
      }),
    );
  });
});
