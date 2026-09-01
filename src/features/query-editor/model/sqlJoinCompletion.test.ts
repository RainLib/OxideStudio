import { describe, expect, it } from "vitest";
import { cachedSqlJoinTargetContext } from "@/lib/queryEditorCachedCompletion";
import {
  sqlForeignKeyJoinCompletions,
  sqlJoinConstraintsFromRelationshipIndex,
} from "./sqlJoinCompletion";
import { ensurePinyinCompletionSupport } from "./completionMatch";

describe("foreign-key JOIN completion", () => {
  it("keeps the incomplete target out of the metadata source relation", () => {
    const context = cachedSqlJoinTargetContext(
      "SELECT * FROM orders o LEFT JOIN cust",
    );

    expect(context).toMatchObject({
      targetFragment: "cust",
      sourceRelations: [{ table: "orders", alias: "o" }],
    });
  });

  it("builds a complete ON clause from a composite foreign key", () => {
    const context = cachedSqlJoinTargetContext(
      "SELECT * FROM order_lines ol JOIN ",
    );
    expect(context).not.toBeNull();

    const [completion] = sqlForeignKeyJoinCompletions(
      context!,
      context!.sourceRelations[0]!,
      [
        {
          name: "fk_order_lines_order",
          constraint_type: "FOREIGN KEY",
          columns: ["tenant_id", "order_id"],
          referenced_schema: "public",
          referenced_table: "orders",
          referenced_columns: ["tenant_id", "id"],
        },
      ],
      { driver: "postgres", defaultSchema: "public" },
    );

    expect(completion).toMatchObject({
      label: "orders",
      filterText: "orders",
      insertText:
        '"orders" "o" ON "o"."tenant_id" = ol."tenant_id" AND "o"."id" = ol."order_id"',
    });
  });

  it("qualifies cross-schema targets and avoids an occupied alias", () => {
    const context = cachedSqlJoinTargetContext(
      "SELECT * FROM public.customers c JOIN ",
    );
    const [completion] = sqlForeignKeyJoinCompletions(
      context!,
      context!.sourceRelations[0]!,
      [
        {
          name: "fk_customer_parent",
          constraint_type: "FK",
          columns: ["parent_id"],
          referenced_schema: "crm",
          referenced_table: "customers",
          referenced_columns: ["id"],
        },
      ],
      { driver: "postgres", defaultSchema: "public", keywordCase: "lower" },
    );

    expect(completion?.insertText).toBe(
      '"crm"."customers" "c2" on "c2"."id" = c."parent_id"',
    );
  });

  it("reuses the source alias's exact SQL spelling in the generated predicate", () => {
    const context = cachedSqlJoinTargetContext(
      'SELECT * FROM dbo.order_lines AS "Order Source" JOIN ',
    );
    const [completion] = sqlForeignKeyJoinCompletions(
      context!,
      context!.sourceRelations[0]!,
      [
        {
          name: "fk_order_customer",
          constraint_type: "FOREIGN KEY",
          columns: ["customer_id"],
          referenced_schema: "dbo",
          referenced_table: "customers",
          referenced_columns: ["id"],
        },
      ],
      { driver: "sqlserver", defaultSchema: "dbo" },
    );

    expect(context?.sourceRelations[0]).toMatchObject({
      alias: "Order Source",
      aliasSql: '"Order Source"',
    });
    expect(completion?.insertText).toBe(
      '"customers" "c" ON "c"."id" = "Order Source"."customer_id"',
    );
  });

  it("finds a Unicode foreign-key target by pinyin initials", async () => {
    await ensurePinyinCompletionSupport();
    const context = cachedSqlJoinTargetContext(
      "SELECT * FROM 销售订单 so JOIN dd",
    );
    const [completion] = sqlForeignKeyJoinCompletions(
      context!,
      context!.sourceRelations[0]!,
      [
        {
          name: "fk_order_detail",
          constraint_type: "FOREIGN KEY",
          columns: ["详情_id"],
          referenced_table: "订单详情",
          referenced_columns: ["id"],
        },
      ],
      { driver: "sqlserver" },
    );

    expect(completion).toMatchObject({
      label: "订单详情",
      filterText: "dd",
    });
  });

  it("ignores incomplete and non-foreign constraints", () => {
    const context = cachedSqlJoinTargetContext("SELECT * FROM orders JOIN ");
    expect(
      sqlForeignKeyJoinCompletions(
        context!,
        context!.sourceRelations[0]!,
        [
          {
            name: "orders_pkey",
            constraint_type: "PRIMARY KEY",
            columns: ["id"],
            referenced_columns: [],
          },
          {
            name: "broken_fk",
            constraint_type: "FOREIGN KEY",
            columns: ["customer_id", "tenant_id"],
            referenced_table: "customers",
            referenced_columns: ["id"],
          },
        ],
        { driver: "postgres" },
      ),
    ).toEqual([]);
  });

  it("reverses indexed inbound foreign keys into parent-to-child JOINs", () => {
    expect(
      sqlJoinConstraintsFromRelationshipIndex(
        { table: "customers", schema: "public", alias: "c" },
        "public",
        [
          {
            name: "orders_customer_id_fkey",
            ownerSchema: "public",
            ownerTable: "orders",
            ownerColumns: ["customer_id"],
            referencedSchema: "public",
            referencedTable: "customers",
            referencedColumns: ["id"],
          },
        ],
      ),
    ).toEqual([
      {
        name: "orders_customer_id_fkey (referenced by)",
        constraint_type: "FOREIGN KEY",
        columns: ["id"],
        referenced_schema: "public",
        referenced_table: "orders",
        referenced_columns: ["customer_id"],
      },
    ]);
  });
});
