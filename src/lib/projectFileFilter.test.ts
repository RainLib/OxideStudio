import { describe, expect, it } from "vitest";
import { compileProjectFileFilter } from "./projectFileFilter";

describe("compileProjectFileFilter", () => {
  it("accepts case-insensitive glob filters", () => {
    const filter = compileProjectFileFilter("*.sql");
    expect(filter.test("query.SQL")).toBe(true);
    expect(filter.test("query.ts")).toBe(false);
  });

  it("accepts regular expressions", () => {
    const filter = compileProjectFileFilter(String.raw`\.(sql|sh|py)$`);
    expect(filter.test("query.sql")).toBe(true);
    expect(filter.test("script.sh")).toBe(true);
    expect(filter.test("notes.md")).toBe(false);
  });

  it("rejects invalid regular expressions", () => {
    expect(() => compileProjectFileFilter("[")).toThrow();
  });
});
