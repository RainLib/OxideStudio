import { describe, expect, it } from "vitest";
import { defaultDatabaseCapabilities } from "@/lib/databaseDialect";
import {
  collectionCreateQueryTemplateForCapabilities,
  collectionDeleteQueryTemplateForCapabilities,
  collectionPreviewQueryTemplateForCapabilities,
  collectionPreviewTabTitleForCapabilities,
} from "@/lib/databaseObjectPreview";

describe("database object operation templates", () => {
  it("builds Redis key create, preview, and delete commands", () => {
    const capabilities = defaultDatabaseCapabilities("redis");
    const collection = {
      name: "session token",
      type: "string",
      namespace: "0",
      documentCount: 12,
    };

    expect(
      collectionCreateQueryTemplateForCapabilities(
        capabilities,
        "0",
        "session token"
      )
    ).toBe('SET "session token" ""');
    expect(
      collectionPreviewQueryTemplateForCapabilities(capabilities, "0", collection)
    ).toBe('GET "session token"');
    expect(
      collectionDeleteQueryTemplateForCapabilities(capabilities, "0", collection)
    ).toBe('DEL "session token"');
  });

  it("builds MongoDB collection create, preview, and delete JSON", () => {
    const capabilities = defaultDatabaseCapabilities("mongodb");
    const collection = {
      name: "users",
      type: "collection",
      namespace: "app",
      documentCount: 5,
    };

    expect(
      collectionCreateQueryTemplateForCapabilities(capabilities, "app", "users")
    ).toBe(
      JSON.stringify(
        {
          database: "app",
          command: { create: "users" },
        },
        null,
        2
      )
    );
    expect(
      collectionPreviewQueryTemplateForCapabilities(capabilities, "app", collection)
    ).toContain('"find": {}');
    expect(
      collectionDeleteQueryTemplateForCapabilities(capabilities, "app", collection)
    ).toContain('"drop": "users"');
  });

  it("builds Elasticsearch index create, preview, and delete requests", () => {
    const capabilities = defaultDatabaseCapabilities("elasticsearch");
    const collection = {
      name: "user events",
      type: "index",
      namespace: null,
      documentCount: 20,
    };

    expect(
      collectionCreateQueryTemplateForCapabilities(
        capabilities,
        null,
        "user events"
      )
    ).toBe("PUT /user%20events\n{}");
    expect(
      collectionPreviewQueryTemplateForCapabilities(capabilities, null, collection)
    ).toContain("GET /user%20events/_search");
    expect(
      collectionDeleteQueryTemplateForCapabilities(capabilities, null, collection)
    ).toBe("DELETE /user%20events");
    expect(collectionPreviewTabTitleForCapabilities(capabilities, collection)).toBe(
      "Index: user events:index"
    );
  });
});
