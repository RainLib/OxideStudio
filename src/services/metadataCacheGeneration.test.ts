import { describe, expect, it } from "vitest";
import {
  isMetadataCacheSupersededError,
  MetadataCacheGenerationRegistry,
} from "./metadataCacheGeneration";

describe("MetadataCacheGenerationRegistry", () => {
  it("keeps unrelated cache scopes independent", () => {
    const registry = new MetadataCacheGenerationRegistry();
    const tableGeneration = registry.capture("connection-a:public:users");
    const catalogGeneration = registry.capture("connection-a:catalog");

    registry.advance("connection-a:public:users");

    expect(
      registry.isCurrent("connection-a:public:users", tableGeneration),
    ).toBe(false);
    expect(registry.isCurrent("connection-a:catalog", catalogGeneration)).toBe(
      true,
    );
  });

  it("rejects a late response captured before invalidation", () => {
    const registry = new MetadataCacheGenerationRegistry();
    const scope = "project-a:connection-a:postgres:public:users";
    const staleGeneration = registry.capture(scope);

    const currentGeneration = registry.advance(scope);

    expect(() => registry.assertCurrent(scope, staleGeneration)).toThrowError(
      expect.objectContaining({
        code: "OXIDE_METADATA_CACHE_SUPERSEDED",
      }),
    );
    expect(() => registry.assertCurrent(scope, currentGeneration)).not.toThrow();
  });

  it("bounds inactive scopes without letting evicted generations become current", () => {
    const registry = new MetadataCacheGenerationRegistry(2);
    const staleGeneration = registry.capture("connection-a");
    registry.capture("connection-b");
    registry.capture("connection-c");

    expect(registry.size).toBe(2);
    expect(registry.isCurrent("connection-a", staleGeneration)).toBe(false);
    expect(registry.size).toBe(2);
  });

  it("refreshes least-recently-used order when a scope is read", () => {
    const registry = new MetadataCacheGenerationRegistry(2);
    const generationA = registry.capture("connection-a");
    registry.capture("connection-b");
    expect(registry.capture("connection-a")).toBe(generationA);
    registry.capture("connection-c");

    expect(registry.isCurrent("connection-a", generationA)).toBe(true);
    expect(registry.size).toBe(2);
  });

  it("identifies superseded errors across serialization boundaries", () => {
    expect(
      isMetadataCacheSupersededError({
        code: "OXIDE_METADATA_CACHE_SUPERSEDED",
      }),
    ).toBe(true);
    expect(isMetadataCacheSupersededError(new Error("network error"))).toBe(
      false,
    );
  });
});
