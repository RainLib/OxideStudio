import { describe, expect, it } from "vitest";
import { defaultDatabaseCapabilities } from "@/lib/databaseDialect";
import { MONGODB_CONSOLE_LANGUAGE_ID } from "@/lib/mongodbCompletion";
import { editorDocumentIdentity } from "./editorDocumentIdentity";

describe("editorDocumentIdentity", () => {
  it("uses the MongoDB console language without changing the LSP identity", () => {
    const identity = editorDocumentIdentity({
      tab: { id: "mongo-tab" },
      driver: "mongodb",
      capabilities: defaultDatabaseCapabilities("mongodb"),
    });

    expect(identity.documentLanguageId).toBe("mongodb");
    expect(identity.editorLanguageId).toBe(MONGODB_CONSOLE_LANGUAGE_ID);
    expect(identity.documentUri).toContain("mongo-tab");
  });
});
