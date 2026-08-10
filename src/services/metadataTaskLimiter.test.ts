import { describe, expect, it } from "vitest";
import {
  MetadataTaskLimiter,
  MetadataTaskQueueFullError,
} from "./metadataTaskLimiter";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

describe("MetadataTaskLimiter", () => {
  it("caps active tasks per scope while isolating other connections", async () => {
    const limiter = new MetadataTaskLimiter(2);
    const gates = [deferred<number>(), deferred<number>(), deferred<number>()];
    let activeA = 0;
    let maxActiveA = 0;
    let activeB = 0;
    const tasks = gates.map((gate) =>
      limiter.run("connection-a", "columns", async () => {
        activeA += 1;
        maxActiveA = Math.max(maxActiveA, activeA);
        const value = await gate.promise;
        activeA -= 1;
        return value;
      }),
    );
    const other = limiter.run("connection-b", "columns", async () => {
      activeB += 1;
      return 4;
    });

    expect(maxActiveA).toBe(2);
    expect(activeB).toBe(1);
    gates[0]!.resolve(1);
    await Promise.resolve();
    await Promise.resolve();
    gates[1]!.resolve(2);
    gates[2]!.resolve(3);
    expect(await Promise.all(tasks)).toEqual([1, 2, 3]);
    expect(await other).toBe(4);
  });

  it("starts interactive work before queued background hydration", async () => {
    const limiter = new MetadataTaskLimiter(1);
    const gate = deferred<void>();
    const starts: string[] = [];
    const active = limiter.run("connection-a", "active", async () => {
      starts.push("active");
      await gate.promise;
    });
    const background = limiter.run(
      "connection-a",
      "background",
      async () => {
        starts.push("background");
      },
      "background",
    );
    const interactive = limiter.run(
      "connection-a",
      "interactive",
      async () => {
        starts.push("interactive");
      },
      "interactive",
    );

    gate.resolve(undefined);
    await Promise.all([active, background, interactive]);
    expect(starts).toEqual(["active", "interactive", "background"]);
  });

  it("fails fast when a scope queue reaches its hard limit", async () => {
    const limiter = new MetadataTaskLimiter(1, 1);
    const gate = deferred<void>();
    const active = limiter.run("connection-a", "active", () => gate.promise);
    const queued = limiter.run("connection-a", "queued", async () => undefined);

    await expect(
      limiter.run("connection-a", "overflow", async () => undefined),
    ).rejects.toBeInstanceOf(MetadataTaskQueueFullError);
    gate.resolve(undefined);
    await Promise.all([active, queued]);
  });
});
