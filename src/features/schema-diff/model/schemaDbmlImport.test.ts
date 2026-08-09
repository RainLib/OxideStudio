import { describe, expect, it } from "vitest";
import { serializeSchemaSnapshotToDbml } from "./schemaDbml";
import {
  createSchemaDbmlSnapshot,
  isSchemaDbmlSnapshot,
  parseSchemaDbml,
} from "./schemaDbmlImport";
import type { SchemaSnapshot } from "@/services/tauri/types";

const snapshot: SchemaSnapshot = {
  version: 1,
  id: "source",
  fingerprint: "source-fingerprint",
  projectId: "project",
  connectionId: "connection",
  connectionName: "Local",
  driver: "postgres",
  databaseName: "app",
  schemaName: "public",
  capturedAt: 1,
  warnings: [],
  relations: [
    {
      name: "users",
      objectType: "BASE TABLE",
      columns: [
        {
          name: "id",
          data_type: "uuid",
          is_nullable: false,
          is_primary_key: true,
          is_unique: true,
          is_indexed: true,
          default_value: "gen_random_uuid()",
        },
      ],
      indexes: [],
      constraints: [],
    },
    {
      name: "orders",
      objectType: "BASE TABLE",
      columns: [
        {
          name: "id",
          data_type: "bigint",
          is_nullable: false,
          is_primary_key: true,
        },
        {
          name: "user_id",
          data_type: "uuid",
          is_nullable: false,
          is_primary_key: false,
        },
        {
          name: "tags",
          data_type: "text[]",
          is_nullable: true,
          is_primary_key: false,
        },
      ],
      indexes: [
        {
          name: "orders_user_idx",
          columns: ["user_id"],
          is_unique: false,
          is_primary: false,
          index_type: "btree",
        },
      ],
      constraints: [
        {
          name: "orders_user_fk",
          constraint_type: "FOREIGN KEY",
          columns: ["user_id"],
          referenced_schema: "public",
          referenced_table: "users",
          referenced_columns: ["id"],
        },
      ],
    },
  ],
};

describe("schema DBML import", () => {
  it("round-trips the portable exported subset", () => {
    const artifact = serializeSchemaSnapshotToDbml(snapshot);
    const parsed = parseSchemaDbml(artifact.content, "public");

    expect(parsed.relations.map((relation) => relation.name)).toEqual([
      "orders",
      "users",
    ]);
    const orders = parsed.relations[0]!;
    expect(orders.columns.find((column) => column.name === "tags")?.data_type).toBe(
      "text[]",
    );
    expect(orders.indexes[0]).toMatchObject({
      name: "orders_user_idx",
      columns: ["user_id"],
      index_type: "btree",
    });
    expect(
      orders.constraints.find((constraint) => constraint.constraint_type === "FOREIGN KEY"),
    ).toMatchObject({
      name: "orders_user_fk",
      columns: ["user_id"],
      referenced_schema: "public",
      referenced_table: "users",
      referenced_columns: ["id"],
    });
  });

  it("marks imported snapshots as offline and review-only", () => {
    const imported = createSchemaDbmlSnapshot(
      {
        projectId: "project",
        connectionId: "connection",
        connectionName: "Local",
        driver: "postgres",
        databaseName: "app",
        schemaName: "public",
      },
      "schema.dbml",
      serializeSchemaSnapshotToDbml(snapshot).content,
      10,
    );

    expect(isSchemaDbmlSnapshot(imported)).toBe(true);
    expect(imported.warnings).toContain("OFFLINE_DBML_REVIEW_ONLY");
    expect(imported.relations).toHaveLength(2);
  });

  it("rejects tables outside the target snapshot schema", () => {
    const parsed = parseSchemaDbml(
      'Table "audit"."events" {\n  "id" bigint [pk]\n}\n',
      "public",
    );

    expect(parsed.relations).toHaveLength(0);
    expect(parsed.warnings.join(" ")).toContain("can only contain public");
  });
});
