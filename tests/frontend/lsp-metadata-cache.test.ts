import { describe, expect, it } from "vitest";
import { getCachedLspMetadata } from "@/services/lsp/metadataCache";

describe("LSP metadata cache", () => {
  it("reuses in-flight metadata promises within the TTL", async () => {
    const cache = new Map();
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return { name: "users" };
    };

    const first = getCachedLspMetadata(cache, "public.users", 1_000, loader, 100);
    const second = getCachedLspMetadata(cache, "public.users", 1_000, loader, 200);

    expect(first).toBe(second);
    await expect(first).resolves.toEqual({ name: "users" });
    expect(calls).toBe(1);
  });

  it("reports whether each request used cached metadata", async () => {
    const cache = new Map();
    const states: string[] = [];
    const loader = async () => ({ name: "users" });

    await getCachedLspMetadata(
      cache,
      "public.users",
      1_000,
      loader,
      100,
      (state) => states.push(state),
    );
    await getCachedLspMetadata(
      cache,
      "public.users",
      1_000,
      loader,
      200,
      (state) => states.push(state),
    );

    expect(states).toEqual(["miss", "hit"]);
  });

  it("refreshes expired metadata entries", async () => {
    const cache = new Map();
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return calls;
    };

    await expect(
      getCachedLspMetadata(cache, "public.users", 100, loader, 100)
    ).resolves.toBe(1);
    await expect(
      getCachedLspMetadata(cache, "public.users", 100, loader, 201)
    ).resolves.toBe(2);
  });

  it("removes failed metadata promises so later syncs can retry", async () => {
    const cache = new Map();
    let calls = 0;
    const loader = async () => {
      calls += 1;
      if (calls === 1) throw new Error("metadata unavailable");
      return "ok";
    };

    await expect(
      getCachedLspMetadata(cache, "public.users", 1_000, loader, 100)
    ).rejects.toThrow("metadata unavailable");
    await expect(
      getCachedLspMetadata(cache, "public.users", 1_000, loader, 200)
    ).resolves.toBe("ok");
    expect(calls).toBe(2);
  });
});
