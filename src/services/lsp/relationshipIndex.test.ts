import { afterEach, describe, expect, it } from "vitest";
import {
  clearLspRelationshipIndex,
  lspForeignKeyRelationships,
  replaceLspRelationshipIndex,
} from "./relationshipIndex";
import type { LspTableDefinition } from "./schemaConfig";

const scope = {
  connectionId: "connection-1",
  driver: "postgres",
  databaseName: "app",
  schema: "public",
};

afterEach(() => clearLspRelationshipIndex());

describe("LSP relationship index", () => {
  it("publishes only complete foreign keys from existing semantic metadata", () => {
    replaceLspRelationshipIndex(scope, [
      {
        name: "orders",
        object_type: "TABLE",
        comment: null,
        source_location: null,
        indexes: [],
        columns: [],
        constraints: [
          {
            name: "orders_customer_id_fkey",
            constraint_type: "FOREIGN KEY",
            columns: ["customer_id"],
            referenced_schema: "crm",
            referenced_table: "customers",
            referenced_columns: ["id"],
            definition: null,
          },
          {
            name: "orders_pkey",
            constraint_type: "PRIMARY KEY",
            columns: ["id"],
            referenced_schema: null,
            referenced_table: null,
            referenced_columns: [],
            definition: null,
          },
        ],
      } satisfies LspTableDefinition,
    ]);

    expect(lspForeignKeyRelationships(scope)).toEqual([
      {
        name: "orders_customer_id_fkey",
        ownerSchema: "public",
        ownerTable: "orders",
        ownerColumns: ["customer_id"],
        referencedSchema: "crm",
        referencedTable: "customers",
        referencedColumns: ["id"],
      },
    ]);
  });
});
