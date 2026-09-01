import { describe, expect, it } from "vitest";
import { defaultDatabaseCapabilities } from "./databaseDialect";
import {
  collectionCreateQueryTemplateForCapabilities,
  collectionDeleteQueryTemplateForCapabilities,
  collectionPreviewQueryTemplateForCapabilities,
} from "./databaseObjectPreview";

describe("Consul object preview", () => {
  const capabilities = defaultDatabaseCapabilities("consul");
  const collection = {
    name: "app/config",
    namespace: "kv",
    type: "key",
    documentCount: null,
  };

  it("uses the driver's constrained GET preview and exposes no mutations", () => {
    expect(
      collectionPreviewQueryTemplateForCapabilities(capabilities, "kv", collection),
    ).toBe('GET "app/config"');
    expect(
      collectionCreateQueryTemplateForCapabilities(capabilities, "kv", "new-key"),
    ).toBeNull();
    expect(
      collectionDeleteQueryTemplateForCapabilities(capabilities, "kv", collection),
    ).toBeNull();
  });
});
