import { describe, expect, it } from "vitest";
import {
  parseSchemaDiagramColumnDrag,
  suggestedSchemaDiagramForeignKeyName,
} from "./schemaDiagramRelationshipDrag";

describe("schema diagram relationship drag payload", () => {
  it("decodes a bounded source column endpoint", () => {
    expect(parseSchemaDiagramColumnDrag(JSON.stringify({
      relationName: " orders ",
      columnName: " customer_id ",
    }))).toEqual({ relationName: "orders", columnName: "customer_id" });
  });

  it("rejects malformed, empty and oversized payloads", () => {
    expect(parseSchemaDiagramColumnDrag("not-json")).toBeNull();
    expect(parseSchemaDiagramColumnDrag(JSON.stringify({
      relationName: "orders",
      columnName: "",
    }))).toBeNull();
    expect(parseSchemaDiagramColumnDrag("x".repeat(1_025))).toBeNull();
  });

  it("suggests the first available deterministic foreign-key name", () => {
    const source = { relationName: "orders", columnName: "customer_id" };
    expect(suggestedSchemaDiagramForeignKeyName([], source)).toBe(
      "orders_customer_id_fk",
    );
    expect(suggestedSchemaDiagramForeignKeyName([
      "orders_customer_id_fk",
      "orders_customer_id_fk_2",
    ], source)).toBe("orders_customer_id_fk_3");
  });
});
