import { describe, expect, it } from "vitest";
import { defaultDatabaseCapabilities } from "./databaseDialect";
import {
  collectionCreateQueryTemplateForCapabilities,
  collectionDisplayLabelForCapabilities,
  collectionDeleteQueryTemplateForCapabilities,
  collectionPreviewTabTitleForCapabilities,
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

describe("etcd object preview", () => {
  const capabilities = defaultDatabaseCapabilities("etcd");
  const collection = {
    name: "app/config",
    namespace: "kv",
    type: "key",
    documentCount: null,
  };

  it("uses the driver GET preview and exposes no mutations", () => {
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

describe("Nacos object preview", () => {
  const capabilities = defaultDatabaseCapabilities("nacos");
  const collection = {
    name: '{"dataId":"app.yaml","group":"DEFAULT_GROUP","tenant":""}',
    namespace: "config",
    type: "CONFIG",
    documentCount: null,
  };

  it("uses an exact read-only config key and exposes no mutations", () => {
    expect(
      collectionDisplayLabelForCapabilities(capabilities, collection),
    ).toBe("app.yaml · DEFAULT_GROUP");
    expect(
      collectionPreviewTabTitleForCapabilities(capabilities, collection, "config"),
    ).toBe("Configuration: app.yaml · DEFAULT_GROUP");
    expect(
      collectionPreviewQueryTemplateForCapabilities(capabilities, "config", collection),
    ).toBe(`GET ${collection.name}`);
    expect(
      collectionCreateQueryTemplateForCapabilities(capabilities, "config", "new-config"),
    ).toBeNull();
    expect(
      collectionDeleteQueryTemplateForCapabilities(capabilities, "config", collection),
    ).toBeNull();
  });

  it("falls back to the opaque identity only when the driver data is malformed", () => {
    expect(
      collectionDisplayLabelForCapabilities(capabilities, {
        ...collection,
        name: "not-json",
      }),
    ).toBe("not-json");
  });
});
