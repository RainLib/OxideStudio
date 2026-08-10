import { describe, expect, it } from "vitest";
import { buildQueryEditorTableHoverMarkdown } from "./queryEditorTableHover";

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
});
