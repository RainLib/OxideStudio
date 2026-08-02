import { describe, expect, it } from "vitest";
import { constraintPresentation } from "@/features/database-explorer/model/constraintPresentation";

describe("Explorer constraint presentation", () => {
  it("shows a foreign-key target and retains a full tooltip", () => {
    const presentation = constraintPresentation({
      name: "orders_customer_id_fkey",
      constraint_type: "FOREIGN KEY",
      columns: ["customer_id"],
      referenced_schema: "public",
      referenced_table: "customers",
      referenced_columns: ["id"],
    });

    expect(presentation).toEqual({
      detail: "→ public.customers (id)",
      title:
        "orders_customer_id_fkey · FOREIGN KEY (customer_id) references public.customers (id)",
      isForeignKey: true,
    });
  });

  it("keeps lengthy check definitions compact without throwing away detail", () => {
    const definition = "CHECK (amount > 0 AND amount < 9999999999999999999999999999999999999999999999999999)";
    const presentation = constraintPresentation({
      name: "orders_amount_check",
      constraint_type: "CHECK",
      columns: ["amount"],
      referenced_columns: [],
      definition,
    });

    expect(presentation.detail).toMatch(/…$/u);
    expect(presentation.title).toContain(definition);
    expect(presentation.isForeignKey).toBe(false);
  });
});
