import { describe, expect, it } from "vitest";
import {
  cachedSqlRelationForFieldCompletion,
  cachedSqlRelationsBeforeCursor,
  sqlStatementBeforeCursor,
} from "@/lib/queryEditorCachedCompletion";

describe("cached SQL completion context", () => {
  it("uses the sole FROM relation for an unqualified field fallback", () => {
    expect(
      cachedSqlRelationForFieldCompletion(
        "SELECT  FROM accounting.invoices WHERE ",
      ),
    ).toEqual({ table: "invoices", schema: "accounting", alias: undefined });
  });

  it("uses an explicit alias in a join without guessing across tables", () => {
    const source = `SELECT c.
FROM customers c
JOIN orders o ON o.customer_id = c.id`;
    expect(cachedSqlRelationForFieldCompletion(source)).toEqual({
      table: "customers",
      alias: "c",
      aliasSql: "c",
      schema: undefined,
    });
    expect(cachedSqlRelationForFieldCompletion(`${source}\nWHERE `)).toBeNull();
  });

  it("only uses relations from the statement containing the cursor", () => {
    const source = `SELECT previous.id FROM audit.previous;
SELECT current.`;
    expect(cachedSqlRelationForFieldCompletion(source)).toBeNull();

    const currentStatement = `SELECT previous.id FROM audit.previous;
SELECT current.id FROM sales.current current
WHERE current.`;
    expect(cachedSqlRelationForFieldCompletion(currentStatement)).toEqual({
      table: "current",
      schema: "sales",
      alias: "current",
      aliasSql: "current",
    });
  });

  it("recovers a blank-line-separated query without a semicolon", () => {
    const source = `SELECT old_row.id FROM audit.old_row

SELECT `;
    expect(cachedSqlRelationForFieldCompletion(source)).toBeNull();
    expect(cachedSqlRelationsBeforeCursor(source)).toEqual([]);
  });

  it("uses relations from the current blank-line-separated query", () => {
    const source = `SELECT old_row.id FROM audit.old_row

SELECT fresh_row.id
FROM sales.fresh_row fresh_row
WHERE fresh_row.`;
    expect(cachedSqlRelationForFieldCompletion(source)).toEqual({
      table: "fresh_row",
      schema: "sales",
      alias: "fresh_row",
      aliasSql: "fresh_row",
    });
  });

  it("does not split CTE, INSERT SELECT, EXPLAIN, or set-operation continuations", () => {
    expect(
      cachedSqlRelationForFieldCompletion(`WITH recent_orders (order_id) AS (
  SELECT id FROM orders
)

SELECT recent_orders.`),
    ).toMatchObject({ table: "recent_orders", isCte: true });

    expect(
      cachedSqlRelationsBeforeCursor(`INSERT INTO archive.orders

SELECT id FROM staging.orders`),
    ).toEqual([
      { table: "orders", schema: "archive", alias: undefined },
      { table: "orders", schema: "staging", alias: undefined },
    ]);

    expect(
      cachedSqlRelationsBeforeCursor(`EXPLAIN

SELECT id FROM reporting.orders`),
    ).toEqual([{ table: "orders", schema: "reporting", alias: undefined }]);

    expect(
      cachedSqlRelationsBeforeCursor(`SELECT id FROM primary_orders
UNION

SELECT id FROM backup_orders`),
    ).toEqual([
      { table: "primary_orders", schema: undefined, alias: undefined },
      { table: "backup_orders", schema: undefined, alias: undefined },
    ]);
  });

  it("retains a SQL Server catalog and quoted alias for catalog-scoped metadata", () => {
    const source = `SELECT [o].
FROM [warehouse].[sales].[order.items] AS [o]`;
    expect(cachedSqlRelationsBeforeCursor(source)).toEqual([
      {
        database: "warehouse",
        schema: "sales",
        table: "order.items",
        alias: "o",
        aliasSql: "[o]",
      },
    ]);
    expect(cachedSqlRelationForFieldCompletion(source)).toEqual({
      database: "warehouse",
      schema: "sales",
      table: "order.items",
      alias: "o",
      aliasSql: "[o]",
    });
  });

  it("treats explicit-column CTEs as local fields instead of physical tables", () => {
    const source = `WITH recent_orders (order_id, total_amount) AS (
  SELECT id, total FROM orders
)
SELECT recent_orders.`;
    expect(cachedSqlRelationForFieldCompletion(source)).toEqual({
      table: "recent_orders",
      schema: undefined,
      isCte: true,
      cteColumns: ["order_id", "total_amount"],
      alias: undefined,
    });
  });

  it("does not resolve an implicit-column CTE to a same-named physical table", () => {
    const source = `WITH recent_orders AS (
  SELECT id, total FROM orders
)
SELECT recent_orders.`;
    expect(cachedSqlRelationForFieldCompletion(source)).toEqual({
      table: "recent_orders",
      schema: undefined,
      isCte: true,
      cteColumns: [],
      alias: undefined,
    });
  });

  it("does not treat relation-like text in comments or literals as metadata targets", () => {
    const source = `SELECT 'from secrets' AS note
-- join sensitive_table x
FROM public.users u
WHERE u.`;
    expect(cachedSqlRelationsBeforeCursor(source)).toEqual([
      { table: "users", schema: "public", alias: "u", aliasSql: "u" },
    ]);
    expect(cachedSqlRelationForFieldCompletion(source)).toEqual({
      table: "users",
      schema: "public",
      alias: "u",
      aliasSql: "u",
    });
  });

  it("keeps a literal or comment delimiter inside the current statement", () => {
    expect(sqlStatementBeforeCursor("SELECT ';' AS punctuation WHERE ")).toBe(
      "SELECT ';' AS punctuation WHERE ",
    );
    expect(sqlStatementBeforeCursor("SELECT 1; -- ; inside a comment\nSELECT ")).toBe(
      " -- ; inside a comment\nSELECT ",
    );
  });

  it("does not reset completion context for delimiters in quoted identifiers or PostgreSQL routine bodies", () => {
    expect(
      sqlStatementBeforeCursor("SELECT [semi;colon] FROM [sales].[orders] WHERE "),
    ).toBe("SELECT [semi;colon] FROM [sales].[orders] WHERE ");
    expect(
      sqlStatementBeforeCursor("SELECT `semi;colon` FROM `orders` WHERE "),
    ).toBe("SELECT `semi;colon` FROM `orders` WHERE ");
    expect(
      sqlStatementBeforeCursor("DO $body$ BEGIN RAISE NOTICE ';'; END $body$;\nSELECT "),
    ).toBe("\nSELECT ");
  });
});
