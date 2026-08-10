import { describe, expect, it } from "vitest";
import { serializeSchemaSnapshotToDbml } from "./schemaDbml";
import {
  createSchemaDbmlSnapshot,
  isSchemaDbmlSnapshot,
  parseSchemaDbml,
} from "./schemaDbmlImport";
import { enumDescriptorValues } from "./schemaEnumDescriptor";
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
  schemaObjects: [
    {
      name: "order_status",
      objectType: "ENUM TYPE",
      description: 'Enum values: ["draft","in progress","done"]',
    },
    { name: "order_number_seq", objectType: "SEQUENCE" },
  ],
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
    expect(parsed.schemaObjects).toHaveLength(1);
    expect(enumDescriptorValues(parsed.schemaObjects[0]?.description)).toEqual([
      "draft",
      "in progress",
      "done",
    ]);
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
    expect(imported.schemaObjects).toHaveLength(1);
  });

  it("imports enum values, drops value notes with warnings, and preserves column references", () => {
    const parsed = parseSchemaDbml(
      `
        Enum public.order_status {
          draft [note: 'Not submitted']
          "in progress"
          "done"
          "done"
        }

        Table public.orders {
          id bigint [pk]
          status public.order_status [not null]
        }
      `,
      "public",
    );

    expect(enumDescriptorValues(parsed.schemaObjects[0]?.description)).toEqual([
      "draft",
      "in progress",
      "done",
    ]);
    expect(parsed.relations[0]?.columns.find((column) => column.name === "status")?.data_type)
      .toBe("public.order_status");
    expect(parsed.warnings.join(" ")).toContain("settings and notes");
    expect(parsed.warnings.join(" ")).toContain("duplicate enum value");
  });

  it("rejects enum definitions outside the target snapshot schema", () => {
    const parsed = parseSchemaDbml(
      'Enum "audit"."event_state" {\n  queued\n}\nTable public.events {\n  id bigint\n}',
      "public",
    );
    expect(parsed.schemaObjects).toEqual([]);
    expect(parsed.warnings.join(" ")).toContain("audit.event_state");
  });

  it("includes enum descriptors in the DBML snapshot fingerprint", () => {
    const identity = {
      projectId: "project",
      connectionId: "connection",
      connectionName: "Local",
      driver: "postgres" as const,
      schemaName: "public",
    };
    const first = createSchemaDbmlSnapshot(
      identity,
      "schema.dbml",
      "Enum state { open }\nTable jobs { id bigint }",
      1,
    );
    const second = createSchemaDbmlSnapshot(
      identity,
      "schema.dbml",
      "Enum state { closed }\nTable jobs { id bigint }",
      1,
    );
    expect(first.fingerprint).not.toBe(second.fingerprint);
  });

  it("rejects tables outside the target snapshot schema", () => {
    const parsed = parseSchemaDbml(
      'Table "audit"."events" {\n  "id" bigint [pk]\n}\n',
      "public",
    );

    expect(parsed.relations).toHaveLength(0);
    expect(parsed.warnings.join(" ")).toContain("can only contain public");
  });

  it("parses inline references and bare single-column indexes", () => {
    const parsed = parseSchemaDbml(
      `
        Table public.users {
          id uuid [pk]
          email varchar(320) [not null]

          indexes {
            email [unique, name: 'users_email_uq']
          }
        }

        Table public.orders {
          id bigint [pk]
          user_id uuid [not null, ref: > public.users.id, delete: cascade, update: no action]

          indexes {
            user_id [name: 'orders_user_idx', type: btree]
          }
        }
      `,
      "public",
    );

    const users = parsed.relations.find((relation) => relation.name === "users");
    const orders = parsed.relations.find((relation) => relation.name === "orders");
    expect(users?.indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "users_email_uq",
          columns: ["email"],
          is_unique: true,
        }),
      ]),
    );
    expect(orders?.indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "orders_user_idx",
          columns: ["user_id"],
          index_type: "btree",
        }),
      ]),
    );
    expect(orders?.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          constraint_type: "FOREIGN KEY",
          columns: ["user_id"],
          referenced_schema: "public",
          referenced_table: "users",
          referenced_columns: ["id"],
          definition: "ON DELETE cascade ON UPDATE no action",
        }),
      ]),
    );
  });

  it("keeps dangling inline references out of the snapshot", () => {
    const parsed = parseSchemaDbml(
      `
        Table public.orders {
          id bigint [pk]
          user_id uuid [ref: > public.users.id]
        }
      `,
      "public",
    );

    expect(parsed.relations[0]?.constraints).toHaveLength(1);
    expect(parsed.relations[0]?.constraints[0]?.constraint_type).toBe("PRIMARY KEY");
    expect(parsed.warnings.join(" ")).toContain(
      "referenced table users was not found",
    );
  });

  it("preserves table-level reference actions as review metadata", () => {
    const parsed = parseSchemaDbml(
      `
        Table public.users {
          id uuid [pk]
        }
        Table public.orders {
          id bigint [pk]
          user_id uuid [not null]
        }
        Ref orders_user_fk: public.orders.user_id > public.users.id [delete: cascade, update: restrict]
      `,
      "public",
    );

    const foreignKey = parsed.relations
      .find((relation) => relation.name === "orders")
      ?.constraints.find((constraint) => constraint.constraint_type === "FOREIGN KEY");
    expect(foreignKey).toMatchObject({
      name: "orders_user_fk",
      definition: "ON DELETE cascade ON UPDATE restrict",
    });
  });
});
