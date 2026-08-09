import { describe, expect, it } from "vitest";
import {
  createChartDbMetadataSnapshot,
  isChartDbMetadataSnapshot,
  parseChartDbMetadataJson,
} from "./chartDbMetadataImport";

const metadata = {
  fk_info: [
    {
      schema: "public",
      table: "orders",
      column: "user_id",
      foreign_key_name: "orders_user_fk",
      reference_schema: "public",
      reference_table: "users",
      reference_column: "id",
      fk_def: "FOREIGN KEY (user_id) REFERENCES users(id)",
    },
  ],
  pk_info: [
    { schema: "public", table: "users", column: "id", pk_def: "PRIMARY KEY (id)" },
    { schema: "public", table: "orders", column: "id", pk_def: "PRIMARY KEY (id)" },
  ],
  columns: [
    { schema: "public", table: "users", name: "id", type: "uuid", ordinal_position: 1, nullable: false },
    { schema: "public", table: "orders", name: "id", type: "bigint", ordinal_position: 1, nullable: 0, is_identity: true },
    { schema: "public", table: "orders", name: "user_id", type: "uuid", ordinal_position: 2, nullable: false },
    { schema: "public", table: "orders", name: "tags", type: "text", ordinal_position: 3, nullable: true, is_array: true },
  ],
  indexes: [
    { schema: "public", table: "orders", name: "orders_user_idx", column: "user_id", index_type: "BTREE", unique: false, direction: "ASC", column_position: 1 },
  ],
  tables: [
    { schema: "public", table: "users", type: "table" },
    { schema: "public", table: "orders", type: "table" },
  ],
  views: [],
  database_name: "app",
  version: "16",
};

describe("ChartDB metadata JSON import", () => {
  it("builds typed relations, indexes and foreign keys", () => {
    const parsed = parseChartDbMetadataJson(JSON.stringify(metadata), "public");
    const orders = parsed.relations.find((relation) => relation.name === "orders")!;

    expect(orders.columns.find((column) => column.name === "tags")?.data_type).toBe("text[]");
    expect(orders.columns.find((column) => column.name === "id")?.is_auto_increment).toBe(true);
    expect(orders.indexes[0]).toMatchObject({ name: "orders_user_idx", columns: ["user_id"] });
    expect(orders.constraints.find((constraint) => constraint.constraint_type === "FOREIGN KEY")).toMatchObject({
      referenced_table: "users",
      columns: ["user_id"],
      referenced_columns: ["id"],
    });
  });

  it("accepts the valid metadata_json_to_import wrapper", () => {
    const parsed = parseChartDbMetadataJson(
      JSON.stringify([{ metadata_json_to_import: JSON.stringify(metadata) }]),
      "public",
    );
    expect(parsed.relations).toHaveLength(2);
  });

  it("marks saved metadata baselines as offline", () => {
    const snapshot = createChartDbMetadataSnapshot(
      {
        projectId: "project",
        connectionId: "connection",
        connectionName: "Local",
        driver: "postgres",
        schemaName: "public",
      },
      "metadata.json",
      JSON.stringify(metadata),
      10,
    );
    expect(isChartDbMetadataSnapshot(snapshot)).toBe(true);
    expect(snapshot.warnings).toContain("OFFLINE_METADATA_JSON_REVIEW_ONLY");
  });
});
