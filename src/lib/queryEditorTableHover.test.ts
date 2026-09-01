import { describe, expect, it } from "vitest";
import {
  buildQueryEditorTableHoverMarkdown,
  isSqlRelationIdentifierContext,
  sqlIdentifierAtColumn,
} from "./queryEditorTableHover";

describe("buildQueryEditorTableHoverMarkdown", () => {
  it("keeps database-owned hover values compact and inside the markdown table", () => {
    const markdown = buildQueryEditorTableHoverMarkdown({
      schema: "app|prod",
      table: { name: "orders`archive" },
      columns: [{ name: "total|amount", data_type: "numeric", is_nullable: false, is_primary_key: false, default_value: "x".repeat(400) }],
      indexes: [{ name: "orders|lookup", columns: Array.from({ length: 12 }, (_, index) => `column_${index}`), is_unique: false, is_primary: false }],
    });

    expect(markdown).toContain("`app\\|prod`.`orders\\`archive`");
    expect(markdown).toContain("`total\\|amount`");
    expect(markdown).toContain("DEFAULT `");
    expect(markdown).toContain("… +4");
    expect(markdown.length).toBeLessThan(700);
  });

  it.each([
    ["SELECT * FROM users", 15],
    ["SELECT * FROM users", 17],
    ["SELECT * FROM users", 19],
    ['SELECT * FROM "order items"', 16],
    ['SELECT * FROM "order items"', 22],
    ["SELECT * FROM public.users", 22],
    ["SELECT * FROM public.users", 26],
  ])(
    "keeps relation context aligned across the complete identifier at column %s",
    (line, column) => {
      expect(sqlIdentifierAtColumn(line, column)).toBeTruthy();
      expect(isSqlRelationIdentifierContext(line, column)).toBe(true);
    },
  );

  it("does not classify same-named columns and expressions as relation targets", () => {
    expect(isSqlRelationIdentifierContext("SELECT users FROM audit", 8)).toBe(false);
    expect(isSqlRelationIdentifierContext("WHERE users = 1", 9)).toBe(false);
    expect(isSqlRelationIdentifierContext("SELECT fn(users)", 12)).toBe(false);
  });
});
