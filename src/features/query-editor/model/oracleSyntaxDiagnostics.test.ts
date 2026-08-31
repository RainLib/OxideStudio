import { describe, expect, it } from "vitest";
import {
  buildOracleSyntaxDiagnostics,
  supportsOracleSyntaxDiagnostics,
} from "./oracleSyntaxDiagnostics";

describe("Oracle syntax diagnostics", () => {
  it("marks DEFAULT after NOT NULL in CREATE and ALTER TABLE", () => {
    const create = "CREATE TABLE t (id NUMBER NOT NULL DEFAULT 0, ok NUMBER DEFAULT 1 NOT NULL);";
    const alter = "ALTER TABLE t ADD (a NUMBER NOT NULL DEFAULT 2, b NUMBER DEFAULT 3 NOT NULL)";
    expect(buildOracleSyntaxDiagnostics(create, "oracle")).toEqual([
      expect.objectContaining({
        startOffset: create.indexOf("DEFAULT"),
        endOffset: create.indexOf("DEFAULT") + 7,
        code: "ORACLE001",
      }),
    ]);
    expect(buildOracleSyntaxDiagnostics(alter, "oceanbase-oracle")).toHaveLength(1);
  });

  it("ignores strings, comments, constraints, valid ordering, and other drivers", () => {
    const valid = [
      "CREATE TABLE t (id NUMBER DEFAULT 0 NOT NULL)",
      "CREATE TABLE t (value VARCHAR2(100) DEFAULT 'NOT NULL DEFAULT' NOT NULL)",
      "CREATE TABLE t (id NUMBER /* NOT NULL DEFAULT */ DEFAULT 0 NOT NULL)",
      "CREATE TABLE t (id NUMBER NOT NULL, CONSTRAINT c CHECK (id IS NOT NULL))",
      "SELECT 'NOT NULL DEFAULT' FROM dual",
    ];
    for (const sql of valid) expect(buildOracleSyntaxDiagnostics(sql, "oracle")).toEqual([]);
    expect(buildOracleSyntaxDiagnostics("CREATE TABLE t (id NUMBER NOT NULL DEFAULT 0)", "mysql")).toEqual([]);
    expect(supportsOracleSyntaxDiagnostics("oracle")).toBe(true);
    expect(supportsOracleSyntaxDiagnostics("oceanbase-oracle")).toBe(true);
    expect(supportsOracleSyntaxDiagnostics("postgres")).toBe(false);
  });

  it("handles quoted identifiers, nested defaults, and multiple statements", () => {
    const sql = `CREATE TABLE "Order" (
      "value" NUMBER NOT NULL DEFAULT (CASE WHEN 1 IS NOT NULL THEN 1 ELSE 0 END),
      note VARCHAR2(20) DEFAULT q'[NOT NULL DEFAULT]' NOT NULL
    );
    ALTER TABLE "Order" ADD extra NUMBER NOT NULL DEFAULT 4;`;
    expect(buildOracleSyntaxDiagnostics(sql, "oracle")).toHaveLength(2);
  });
});
