import { describe, expect, it } from "vitest";
import {
  cachedSqlRelationForFieldCompletion,
  cachedSqlRelationTargetPrefix,
  cachedSqlRelationsBeforeCursor,
} from "./queryEditorCachedCompletion";

describe("cached SQL relation completion", () => {
  it("derives explicitly named columns from a closed subquery alias", () => {
    const relation = cachedSqlRelationForFieldCompletion(
      `SELECT *
       FROM (
         SELECT o.id AS order_id, upper(o.status) status_label, o.created_at, *
         FROM orders o
       ) AS sq
       WHERE sq.`,
    );

    expect(relation).toMatchObject({
      table: "sq",
      alias: "sq",
      isDerived: true,
      cteColumns: ["order_id", "status_label", "created_at"],
    });
  });

  it("recognizes LATERAL derived tables without fabricating expression names", () => {
    const relations = cachedSqlRelationsBeforeCursor(
      `SELECT p.id, recent.
       FROM people p
       JOIN LATERAL (
         SELECT max(e.created_at) AS last_event, count(*)
         FROM events e
         WHERE e.person_id = p.id
       ) recent ON TRUE`,
    );

    expect(relations).toContainEqual(
      expect.objectContaining({
        table: "recent",
        isDerived: true,
        cteColumns: ["last_event"],
      }),
    );
  });

  it("keeps an explicitly qualified outer relation available in a correlated subquery", () => {
    const relation = cachedSqlRelationForFieldCompletion(
      `SELECT *
       FROM customers c
       WHERE EXISTS (
         SELECT 1
         FROM orders o
         WHERE o.customer_id = c.`,
    );

    expect(relation).toMatchObject({ table: "customers", alias: "c" });
  });

  it("uses explicit table-function output columns without querying a physical table", () => {
    const relation = cachedSqlRelationForFieldCompletion(
      `SELECT *
       FROM events e
       JOIN LATERAL json_each(e.payload) AS item(key, value) ON TRUE
       WHERE item.`,
    );

    expect(relation).toMatchObject({
      table: "item",
      alias: "item",
      isDerived: true,
      cteColumns: ["key", "value"],
    });
  });

  it("recognizes unquoted Unicode SQL Server relation references", () => {
    expect(cachedSqlRelationsBeforeCursor("SELECT * FROM 销售.订单 o WHERE o.")).toContainEqual(
      expect.objectContaining({ schema: "销售", table: "订单", alias: "o" }),
    );
  });

  it("keeps the typed Unicode relation fragment available for matching", () => {
    expect(cachedSqlRelationTargetPrefix("SELECT * FROM 订")).toBe("订");
    expect(cachedSqlRelationTargetPrefix("SELECT * FROM 销售.zz")).toBe("zz");
    expect(cachedSqlRelationTargetPrefix("SELECT * FROM orders ")).toBeNull();
  });
});
