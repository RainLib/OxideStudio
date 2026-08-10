import { describe, expect, it } from "vitest";
import {
  isTableCellExpression,
  tableCellExpression,
  validateTableCellExpression,
} from "./tableCellExpression";

describe("table cell expressions", () => {
  it("keeps explicit expressions distinct from ordinary string values", () => {
    const expression = tableCellExpression("CURRENT_TIMESTAMP");
    expect(isTableCellExpression(expression)).toBe(true);
    expect(isTableCellExpression("CURRENT_TIMESTAMP")).toBe(false);
  });

  it("rejects statement separators, comments, and WHERE clauses before staging", () => {
    expect(validateTableCellExpression("COALESCE(score, 0) + 1")).toEqual({
      ok: true,
      value: "COALESCE(score, 0) + 1",
    });
    expect(validateTableCellExpression("NOW(); DELETE FROM users").ok).toBe(false);
    expect(validateTableCellExpression("-- note\nNOW()").ok).toBe(false);
    expect(validateTableCellExpression("WHERE active = true").ok).toBe(false);
  });
});
