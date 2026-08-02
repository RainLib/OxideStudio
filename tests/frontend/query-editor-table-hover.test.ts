import { describe, expect, it } from "vitest";
import {
  buildQueryEditorTableHoverMarkdown,
  findQueryEditorHoverTable,
  isSqlRelationIdentifierContext,
  sqlIdentifierAtColumn,
} from "@/lib/queryEditorTableHover";

describe("query editor table hover", () => {
  it("resolves bare and quoted identifiers at the cursor", () => {
    expect(sqlIdentifierAtColumn("SELECT * FROM public.orders", 25)).toBe("orders");
    expect(sqlIdentifierAtColumn('SELECT * FROM "Order Items"', 22)).toBe("Order Items");
    expect(sqlIdentifierAtColumn("SELECT 1", 7)).toBeNull();
  });

  it("matches table names without treating column names as relations", () => {
    const tables = [{ name: "orders" }, { name: "customers" }];
    expect(findQueryEditorHoverTable(tables, "orders")?.name).toBe("orders");
    expect(findQueryEditorHoverTable(tables, "customer_id")).toBeNull();
  });

  it("limits metadata hover to SQL relation positions", () => {
    expect(isSqlRelationIdentifierContext("SELECT * FROM ", 15)).toBe(true);
    expect(isSqlRelationIdentifierContext("SELECT * FROM public.", 22)).toBe(true);
    expect(isSqlRelationIdentifierContext("SELECT orders.", 15)).toBe(false);
  });

  it("renders compact cached metadata with primary key and index details", () => {
    const markdown = buildQueryEditorTableHoverMarkdown({
      schema: "public",
      table: { name: "orders" },
      columns: [
        { name: "id", data_type: "bigint", is_nullable: false, is_primary_key: true, is_unique: true, is_indexed: true, is_auto_increment: true },
        { name: "created_at", data_type: "timestamp", is_nullable: false, is_primary_key: false, is_unique: false, is_indexed: true, is_auto_increment: false, default_value: "now()" },
      ],
      indexes: [{ name: "ix_orders_created", columns: ["created_at"], is_unique: false, is_primary: false }],
    });

    expect(markdown).toContain("`public.orders`");
    expect(markdown).toContain("PK · UNIQUE · NOT NULL · AUTO");
    expect(markdown).toContain("`ix_orders_created` (created_at)");
  });
});
