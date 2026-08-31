import { describe, expect, it } from "vitest";
import {
  createExplorerTableReferencePayload,
  explorerTableReferenceInsertText,
  MAX_EXPLORER_TABLE_REFERENCES,
  parseExplorerTableReferencePayload,
  serializeExplorerTableReferencePayload,
} from "@/features/query-editor/model/explorerTableReferenceDrop";

describe("Explorer table reference drop", () => {
  it("round-trips selected tables and emits dialect-quoted qualified names", () => {
    const payload = createExplorerTableReferencePayload({
      connectionId: "connection-1",
      database: "warehouse",
      schema: "sales",
      tables: ["orders", "order]details"],
      identifierQuote: "[",
    });

    expect(payload).not.toBeNull();
    const parsed = parseExplorerTableReferencePayload(
      serializeExplorerTableReferencePayload(payload!),
    );
    expect(parsed?.tables).toEqual([
      { schema: "sales", table: "orders" },
      { schema: "sales", table: "order]details" },
    ]);
    expect(explorerTableReferenceInsertText(parsed!)).toBe(
      "[sales].[orders], [sales].[order]]details]",
    );
  });

  it("deduplicates and bounds untrusted table references", () => {
    const payload = createExplorerTableReferencePayload({
      connectionId: "connection-1",
      schema: "public",
      tables: [
        "users",
        "users",
        ...Array.from({ length: 300 }, (_, index) => `table_${index}`),
      ],
      identifierQuote: '"',
    });

    expect(payload?.tables).toHaveLength(MAX_EXPLORER_TABLE_REFERENCES);
    expect(payload?.tables[0]).toEqual({ schema: "public", table: "users" });
  });

  it("rejects malformed, oversized, and control-character payloads", () => {
    expect(parseExplorerTableReferencePayload("not-json")).toBeNull();
    expect(
      parseExplorerTableReferencePayload(
        JSON.stringify({
          kind: "oxide-table-reference",
          version: 1,
          connectionId: "connection-1",
          identifierQuote: '"',
          tables: [{ table: "unsafe\nname" }],
        }),
      ),
    ).toBeNull();
    expect(parseExplorerTableReferencePayload("x".repeat(70_000))).toBeNull();
  });
});
