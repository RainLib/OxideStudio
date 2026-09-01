import { describe, expect, it } from "vitest";

import {
  canRestoreTransferSchemaObjects,
  transferSchemaRestoreDescription,
  transferSchemaRestoreFamily,
} from "./tableDataTransferSchemaObjects";

describe("table data transfer schema-object policy", () => {
  it("normalizes PostgreSQL and MySQL-family aliases", () => {
    expect(transferSchemaRestoreFamily("pgsql")).toBe("postgres");
    expect(transferSchemaRestoreFamily("MariaDB")).toBe("mysql");
    expect(transferSchemaRestoreFamily("sqlite")).toBeNull();
  });

  it("allows native PostgreSQL and MySQL families in either direction", () => {
    const base = {
      sourceIsExternal: false,
      targetIsExternal: false,
      sourceTable: "orders",
      targetTable: "orders",
      isBatchTransfer: false,
    };
    expect(
      canRestoreTransferSchemaObjects({
        ...base,
        sourceDriver: "postgres",
        targetDriver: "mysql",
      }),
    ).toBe(true);
    expect(
      canRestoreTransferSchemaObjects({
        ...base,
        sourceDriver: "mariadb",
        targetDriver: "postgresql",
      }),
    ).toBe(true);
  });

  it("keeps external, unsupported, and renamed single-table targets closed", () => {
    const base = {
      sourceDriver: "postgres",
      targetDriver: "mysql",
      sourceIsExternal: false,
      targetIsExternal: false,
      sourceTable: "orders",
      targetTable: "orders",
      isBatchTransfer: false,
    };
    expect(
      canRestoreTransferSchemaObjects({ ...base, sourceIsExternal: true }),
    ).toBe(false);
    expect(
      canRestoreTransferSchemaObjects({ ...base, targetDriver: "sqlite" }),
    ).toBe(false);
    expect(
      canRestoreTransferSchemaObjects({ ...base, targetTable: "orders_copy" }),
    ).toBe(false);
  });

  it("distinguishes exact and portable review copy", () => {
    expect(transferSchemaRestoreDescription("postgres", "postgres")).toContain(
      "Same-product",
    );
    expect(transferSchemaRestoreDescription("postgres", "mysql")).toContain(
      "structured BTREE",
    );
  });
});
