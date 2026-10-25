import { describe, expect, it, vi } from "vitest";
import { cachedSqlDocumentContext, MAX_CACHED_SQL_DOCUMENT_CODE_UNITS } from "./documentContext";
import { currentTopLevelStatementAtCursor, currentTopLevelStatementBeforeCursor } from "./lexical";
import { cachedSqlRelationForFieldCompletion } from "./relations";

function at(marked: string) {
  const offset = marked.indexOf("<cursor>"), source = marked.replace("<cursor>", "");
  return { statement: currentTopLevelStatementAtCursor(source, offset), prefix: source.slice(0, offset) };
}
describe("complete-document cached completion ownership", () => {
  it.each([
    "WITH q AS (SELECT 1) SELECT l.rev<cursor> FROM users u\n\nSELECT * FROM ledger l",
    "WITH q AS (SELECT 1)\nSELECT l.rev<cursor> FROM users u\n\nSELECT * FROM ledger l",
    "EXPLAIN SELECT l.rev<cursor> FROM users u\n\nSELECT * FROM ledger l",
    "INSERT INTO users SELECT l.rev<cursor> FROM users u\n\nSELECT * FROM ledger l",
  ])("ends wrapped statements before the next blank-line query: %s", marked => {
    const {statement, prefix}=at(marked);
    expect(statement.source).not.toContain("ledger");
    expect(cachedSqlRelationForFieldCompletion(prefix,statement)).toBeNull();
  });
  it.each([
    'SELECT l.rev<cursor>, "(;)" FROM ledger l; SELECT 1',
    'SELECT l.rev<cursor>, $$ ; FROM archive l $$ FROM ledger l; SELECT 1',
    'SELECT l.rev<cursor>, \'x; FROM archive l\' FROM ledger l; SELECT 1',
    'SELECT l.rev<cursor> /* ; FROM archive l */ FROM ledger l; SELECT 1',
  ])("uses real statement delimiters and preserves UTF-16 offsets: %s", marked => {
    const {statement,prefix}=at("/* 😀 */\r\n"+marked);
    expect(statement.source.slice(0,statement.cursorOffset)).toBe(prefix);
    expect(cachedSqlRelationForFieldCompletion(prefix,statement)).toMatchObject({table:"ledger",alias:"l"});
    expect(statement.source).not.toContain("SELECT 1");
  });
  it("keeps the legacy prefix-only API shape", () => {
    expect(currentTopLevelStatementBeforeCursor("SELECT 1; SELECT l.")).toEqual({source:" SELECT l.",masked:" SELECT l."});
  });
  it("rejects oversized models before copying their complete value", () => {
    const getValue=vi.fn();
    expect(cachedSqlDocumentContext({getValue,getOffsetAt:()=>0,getValueLength:()=>MAX_CACHED_SQL_DOCUMENT_CODE_UNITS+1},{},"SELECT l.")).toBeNull();
    expect(getValue).not.toHaveBeenCalled();
  });
  it("rejects oversized legacy values and invalid cursor offsets", () => {
    expect(cachedSqlDocumentContext({getValue:()=>"x".repeat(MAX_CACHED_SQL_DOCUMENT_CODE_UNITS+1),getOffsetAt:()=>0},{},"")).toBeNull();
    expect(cachedSqlDocumentContext({getValue:()=>"SELECT l.",getOffsetAt:()=>999},{},"")).toBeNull();
  });
  it("retains bounded prefix compatibility for minimal model adapters", () => {
    expect(cachedSqlDocumentContext({}, {}, "SELECT l.")).toMatchObject({source:"SELECT l.",cursorOffset:9});
  });
});
