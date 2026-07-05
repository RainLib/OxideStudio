import { describe, expect, it } from "vitest";
import { querySchemaContextForTab } from "@/store/useTabStore";

describe("tab query schema context", () => {
  it("uses the Elasticsearch object name as index context for search tabs", () => {
    expect(
      querySchemaContextForTab(
        {
          targetSchema: null,
          schemaName: "default",
          tableName: "events-2026",
          objectType: "index",
        },
        "default",
        "elasticsearch"
      )
    ).toBe("events-2026");
  });

  it("keeps explicit target schema and relational schema precedence", () => {
    expect(
      querySchemaContextForTab(
        {
          targetSchema: "manual-index",
          schemaName: "default",
          tableName: "events-2026",
          objectType: "index",
        },
        "default",
        "elasticsearch"
      )
    ).toBe("manual-index");

    expect(
      querySchemaContextForTab(
        {
          targetSchema: null,
          schemaName: "public",
          tableName: "users",
          objectType: "table",
        },
        "fallback",
        "postgres"
      )
    ).toBe("public");
  });
});
