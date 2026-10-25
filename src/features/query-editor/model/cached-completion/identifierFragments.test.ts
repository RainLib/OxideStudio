import { describe, expect, it } from "vitest";
import { sqlContextKeywordBeforeCursor } from "@/lib/lspCompletion";
import { sqlSyntaxFallbackCompletions } from "../sqlSyntaxFallback";
import { cachedIdentifierFragment, cachedIdentifierQualifier, plainIdentifierSuffix } from "./identifierFragments";

describe("linear completion identifier fragments", () => {
  it("reads a suffix after a 128 KiB comment without rescanning its words", () => {
    const source = `SELECT /* ${"x".repeat(131072)} */ * FROM ledger l WHERE l.Revenue`;
    expect(cachedIdentifierFragment(source)).toEqual({ prefix: "Revenue", replacementLength: 7 });
    expect(cachedIdentifierQualifier(source)).toBe("l");
    expect(sqlContextKeywordBeforeCursor(source)).toBeNull();
    expect(sqlSyntaxFallbackCompletions(source, { driver: "postgres" }).some(item => item.label === "=")).toBe(true);
  });
  it.each(['SELECT l.from', 'SELECT "from', 'SELECT [where', 'SELECT `join', 'SELECT 数据from'])
    ("keeps identifier text out of SQL keyword filtering: %s", source => {
      expect(sqlContextKeywordBeforeCursor(source)).toBeNull();
    });
  it("retains ordinary clause detection and escaped qualifier atoms", () => {
    expect(sqlContextKeywordBeforeCursor("SELECT * FROM ")).toBe("from");
    expect(cachedIdentifierQualifier('SELECT "Order""Lines".amo')).toBe('"Order""Lines"');
    expect(cachedIdentifierQualifier("SELECT [Line]]Items].amo")).toBe("[Line]]Items]");
    expect(plainIdentifierSuffix("1$$数据𐐀amount")).toBe("数据𐐀amount");
  });
  it("leaves multiline identifier editing to the semantic server", () => {
    expect(cachedIdentifierFragment('SELECT "multiple\nline')).toEqual({ prefix: "line", replacementLength: 4, unsupported: true });
  });
});
