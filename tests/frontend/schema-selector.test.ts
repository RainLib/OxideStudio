import { describe, expect, it } from "vitest";
import { filterAndSortNamespaceOptions } from "@/components/workspace/SchemaSelector";

describe("editor database selector", () => {
  it("deduplicates and alphabetically sorts every database", () => {
    expect(
      filterAndSortNamespaceOptions(
        ["warehouse10", "Analytics", "warehouse2", "default", "Analytics"],
        ""
      )
    ).toEqual(["Analytics", "default", "warehouse2", "warehouse10"]);
  });

  it("filters as soon as the user types part of a database name", () => {
    expect(
      filterAndSortNamespaceOptions(
        ["analytics", "archive", "default", "reporting"],
        " AR "
      )
    ).toEqual(["archive"]);
  });
});
