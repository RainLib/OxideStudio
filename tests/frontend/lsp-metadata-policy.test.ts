import { describe, expect, it } from "vitest";
import { usesOnDemandOnlyLspColumnMetadata } from "@/services/lsp/metadataPolicy";

describe("LSP metadata policy", () => {
  it("uses on-demand column metadata for federated DBX warehouse profiles", () => {
    expect(usesOnDemandOnlyLspColumnMetadata("trino")).toBe(true);
    expect(usesOnDemandOnlyLspColumnMetadata(" PrestoSQL ")).toBe(true);
  });

  it("keeps normal relational profiles eagerly enriched", () => {
    expect(usesOnDemandOnlyLspColumnMetadata("postgres")).toBe(false);
    expect(usesOnDemandOnlyLspColumnMetadata("mysql")).toBe(false);
  });
});
