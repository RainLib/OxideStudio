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
