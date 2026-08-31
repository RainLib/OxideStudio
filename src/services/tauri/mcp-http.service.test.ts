import { describe, expect, it } from "vitest";
import { PUBLIC_MCP_TOOLS } from "./mcp-http.service";

describe("public MCP tool catalog", () => {
  it("contains only the reviewed read-only tools with unique names", () => {
    const names = PUBLIC_MCP_TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([
      "connection.listSummaries",
      "metadata.listObjects",
      "query.runReadOnly",
      "query.explainEstimate",
      "lsp.sqlContext",
    ]);
    expect(names).not.toContain("query.executeApproved");
  });
});
