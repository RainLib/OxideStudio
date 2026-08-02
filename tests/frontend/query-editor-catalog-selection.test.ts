import { describe, expect, it } from "vitest";
import { mergeCatalogNames } from "@/features/query-editor";

describe("query editor catalog selection", () => {
  it("merges configured and discovered catalogs without driver-specific branches", () => {
    expect(
      mergeCatalogNames("primary", ["archive", "primary", "analytics10", "analytics2"]),
    ).toEqual(["analytics2", "analytics10", "archive", "primary"]);
  });

  it("supports file-backed catalogs discovered at runtime", () => {
    expect(mergeCatalogNames(null, ["", "main", "archive"])).toEqual([
      "archive",
      "main",
    ]);
  });
});
