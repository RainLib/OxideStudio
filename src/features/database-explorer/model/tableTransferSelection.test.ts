import { describe, expect, it } from "vitest";
import { resolveInitialTransferTableSelection } from "./tableTransferSelection";

describe("Explorer transfer table selection", () => {
  const availableTables = ["accounts", "orders", "users"];

  it("preserves the exact Explorer selection in the source schema", () => {
    expect(
      [...resolveInitialTransferTableSelection({
        availableTables,
        sourceTable: "accounts",
        sourceSchemaMatches: true,
        initialScope: "schema",
        requestedTables: ["users", "missing", "orders"],
        currentSelection: new Set(),
      })],
    ).toEqual(["users", "orders"]);
  });

  it("falls back to all tables only for a schema or database scope", () => {
    expect(
      [...resolveInitialTransferTableSelection({
        availableTables,
        sourceTable: "accounts",
        sourceSchemaMatches: false,
        initialScope: "schema",
        requestedTables: ["users"],
        currentSelection: new Set(["orders"]),
      })],
    ).toEqual(availableTables);
  });

  it("retains a valid single-table choice or uses the source fallback", () => {
    expect(
      [...resolveInitialTransferTableSelection({
        availableTables,
        sourceTable: "accounts",
        sourceSchemaMatches: false,
        initialScope: "table",
        currentSelection: new Set(["orders", "missing"]),
      })],
    ).toEqual(["orders"]);
  });
});
