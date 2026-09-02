import { describe, expect, it } from "vitest";
import { reuseFullSchemaDiagramLayout } from "./schemaDiagramLayoutMode";

describe("schema diagram layout mode", () => {
  it("reuses the full layout only for the unfiltered default canvas", () => {
    expect(reuseFullSchemaDiagramLayout({
      query: "",
      keysOnly: false,
      hasRelationScope: false,
    })).toBe(true);
    expect(reuseFullSchemaDiagramLayout({
      query: "orders",
      keysOnly: false,
      hasRelationScope: false,
    })).toBe(false);
    expect(reuseFullSchemaDiagramLayout({
      query: "",
      keysOnly: true,
      hasRelationScope: false,
    })).toBe(false);
    expect(reuseFullSchemaDiagramLayout({
      query: "",
      keysOnly: false,
      hasRelationScope: true,
    })).toBe(false);
  });
});
