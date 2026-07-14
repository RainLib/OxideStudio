import { describe, expect, it } from "vitest";
import {
  buildForeignKeyNavigationPlans,
  foreignKeyNavigationLabel,
} from "@/lib/foreignKeyNavigation";

describe("foreign key row navigation", () => {
  it("maps an outgoing composite foreign key atomically", () => {
    const plans = buildForeignKeyNavigationPlans({
      currentSchema: "sales",
      currentTable: "orders",
      selectedColumn: "tenant_id",
      columns: ["id", "tenant_id", "customer_id"],
      row: [8, "acme", 42],
      constraints: [
        {
          name: "orders_customer_fk",
          constraint_type: "FOREIGN KEY",
          columns: ["tenant_id", "customer_id"],
          referenced_schema: "crm",
          referenced_table: "customers",
          referenced_columns: ["tenant_id", "id"],
        },
      ],
      referencingForeignKeys: [],
    });

    expect(plans).toEqual([
      {
        direction: "referenced",
        constraintName: "orders_customer_fk",
        schema: "crm",
        table: "customers",
        filters: [
          {
            column: "tenant_id",
            operator: "equals",
            value: "acme",
          },
          {
            column: "id",
            operator: "equals",
            value: "42",
            logic: "AND",
          },
        ],
      },
    ]);
    expect(foreignKeyNavigationLabel(plans[0])).toBe(
      "Go to Referenced Row · crm.customers [orders_customer_fk]",
    );
  });

  it("maps reverse references from target columns to owning columns", () => {
    const plans = buildForeignKeyNavigationPlans({
      currentSchema: "crm",
      currentTable: "customers",
      selectedColumn: "id",
      columns: ["tenant_id", "id", "name"],
      row: ["acme", 42, "Ada"],
      constraints: [],
      referencingForeignKeys: [
        {
          name: "orders_customer_fk",
          schema: "sales",
          table: "orders",
          columns: ["tenant_id", "customer_id"],
          referenced_schema: "crm",
          referenced_table: "customers",
          referenced_columns: ["tenant_id", "id"],
        },
      ],
    });

    expect(plans[0]).toMatchObject({
      direction: "referencing",
      schema: "sales",
      table: "orders",
      filters: [
        { column: "tenant_id", value: "acme" },
        { column: "customer_id", value: "42" },
      ],
    });
  });

  it("does not navigate partial, NULL, mismatched, or unrelated keys", () => {
    const base = {
      currentSchema: "public",
      currentTable: "orders",
      columns: ["tenant_id", "customer_id"],
      row: [null, 42],
      constraints: [
        {
          name: "orders_customer_fk",
          constraint_type: "FOREIGN KEY",
          columns: ["tenant_id", "customer_id"],
          referenced_table: "customers",
          referenced_columns: ["tenant_id", "id"],
        },
      ],
      referencingForeignKeys: [],
    };

    expect(
      buildForeignKeyNavigationPlans({
        ...base,
        selectedColumn: "customer_id",
      }),
    ).toEqual([]);
    expect(
      buildForeignKeyNavigationPlans({
        ...base,
        selectedColumn: "unrelated",
        row: ["acme", 42],
      }),
    ).toEqual([]);
  });

  it("keeps multiple valid relationships deterministic", () => {
    const plans = buildForeignKeyNavigationPlans({
      currentSchema: "public",
      currentTable: "events",
      selectedColumn: "actor_id",
      columns: ["actor_id"],
      row: [7],
      constraints: [
        {
          name: "events_owner_fk",
          constraint_type: "FOREIGN KEY",
          columns: ["actor_id"],
          referenced_schema: "public",
          referenced_table: "users",
          referenced_columns: ["id"],
        },
        {
          name: "events_service_fk",
          constraint_type: "FOREIGN KEY",
          columns: ["actor_id"],
          referenced_schema: "infra",
          referenced_table: "services",
          referenced_columns: ["id"],
        },
      ],
      referencingForeignKeys: [],
    });

    expect(plans.map((plan) => plan.table)).toEqual(["services", "users"]);
  });
});
