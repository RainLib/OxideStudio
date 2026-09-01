import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./DataGrid.tsx", import.meta.url), "utf8");

describe("query result toolbar overflow", () => {
  it("observes both width and dynamic action content through the shared hysteresis", () => {
    expect(source).toContain("resolveToolbarOverflowState(");
    expect(source).toContain("resizeObserver?.observe(toolbar)");
    expect(source).toContain("mutationObserver?.observe(toolbar");
    expect(source).toContain("queryToolbarExpandedWidthRef.current");
  });

  it("keeps compact icon actions accessible", () => {
    expect(source).toContain('data-compact={queryToolbarCompact || undefined}');
    expect(source).toContain('aria-label="Copy result as TSV"');
    expect(source).toContain('aria-label="Export query result"');
    expect(source).toContain("!queryToolbarCompact && \"Copy\"");
    expect(source).toContain("!queryToolbarCompact && \"Export\"");
  });
});
