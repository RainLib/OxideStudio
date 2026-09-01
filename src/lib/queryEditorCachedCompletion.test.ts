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

  it("preserves an omitted SQL Server schema in database..table references", () => {
    expect(
      cachedSqlRelationsBeforeCursor(
        "SELECT * FROM [Sales Warehouse]..[Order Lines] AS [line items] WHERE [line items].",
      ),
    ).toContainEqual(
      expect.objectContaining({
        database: "Sales Warehouse",
        schema: undefined,
        table: "Order Lines",
        alias: "line items",
        aliasSql: "[line items]",
      }),
    );
  });

  it("prefers an alias over a colliding physical table name", () => {
    const relation = cachedSqlRelationForFieldCompletion(
      `SELECT *
       FROM audit.orders AS users
       JOIN public.users AS u ON u.id = users.user_id
       WHERE users.`,
    );

    expect(relation).toMatchObject({
      schema: "audit",
      table: "orders",
      alias: "users",
    });
  });

  it("does not resolve an aliased relation through its hidden base-table name", () => {
    const relation = cachedSqlRelationForFieldCompletion(
      `SELECT *
       FROM public.orders AS o
       JOIN public.customers AS c ON c.id = o.customer_id
       WHERE orders.`,
    );

    expect(relation).toBeNull();
  });

  it("keeps the exact quoted alias spelling for downstream insertion", () => {
    const relation = cachedSqlRelationForFieldCompletion(
      `SELECT * FROM [Sales Warehouse]..[Order Lines] AS [Line]]Items]
       WHERE [Line]]Items].`,
    );

    expect(relation).toMatchObject({
      database: "Sales Warehouse",
      table: "Order Lines",
      alias: "Line]Items",
      aliasSql: "[Line]]Items]",
    });
  });

  it("keeps the typed Unicode relation fragment available for matching", () => {
    expect(cachedSqlRelationTargetPrefix("SELECT * FROM 订")).toBe("订");
    expect(cachedSqlRelationTargetPrefix("SELECT * FROM 销售.zz")).toBe("zz");
    expect(cachedSqlRelationTargetPrefix("SELECT * FROM orders ")).toBeNull();
  });
});
