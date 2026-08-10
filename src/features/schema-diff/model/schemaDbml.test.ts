import { describe, expect, it } from "vitest";
import type { SchemaSnapshot } from "@/services/tauri/types";
import { serializeSchemaSnapshotToDbml } from "./schemaDbml";
import { parseSchemaDbml } from "./schemaDbmlImport";

describe("schema snapshot DBML export", () => {
  it("preserves columns, composite foreign keys and review warnings", () => {
    const snapshot: SchemaSnapshot = {
      version: 1,
      id: "snapshot-1",
      fingerprint: "fingerprint",
      projectId: "project-1",
      connectionId: "connection-1",
      connectionName: "Local app",
      driver: "postgres",
      databaseName: "app",
      schemaName: "public",
      capturedAt: 1,
      routines: [],
      schemaObjects: [],
      warnings: [],
      relations: [
        {
          name: "orders",
          objectType: "BASE TABLE",
          columns: [
            {
              name: "tenant_id",
              data_type: "uuid",
              is_nullable: false,
              is_primary_key: true,
              is_unique: false,
              is_indexed: true,
              is_auto_increment: false,
            },
            {
              name: "customer_id",
              data_type: "uuid",
              is_nullable: false,
              is_primary_key: false,
              is_unique: false,
              is_indexed: true,
              is_auto_increment: false,
              default_value: "gen_random_uuid()",
            },
          ],
          indexes: [
            {
              name: "orders_customer_idx",
              columns: ["customer_id"],
              is_unique: false,
              is_primary: false,
              index_type: "btree",
            },
          ],
          constraints: [
            {
              name: "orders_customer_fk",
              constraint_type: "FOREIGN KEY",
              columns: ["tenant_id", "customer_id"],
              referenced_schema: "crm",
              referenced_table: "customers",
              referenced_columns: ["tenant_id", "id"],
            },
            {
              name: "orders_total_check",
              constraint_type: "CHECK",
              columns: [],
              referenced_columns: [],
            },
          ],
        },
      ],
    };

    const artifact = serializeSchemaSnapshotToDbml(snapshot);

    expect(artifact.content).toContain('Table "public"."orders"');
    expect(artifact.content).toContain(
      '"customer_id" uuid [not null, default: `gen_random_uuid()`]',
    );
    expect(artifact.content).toContain(
      'Ref "orders_customer_fk": "public"."orders".("tenant_id", "customer_id") > "crm"."customers".("tenant_id", "id")',
    );
    expect(artifact.content).toContain("// WARNING: orders.orders_total_check");
    expect(artifact.warnings).toHaveLength(1);
  });

  it("exports enum descriptors and excludes only remaining schema objects", () => {
    const snapshot: SchemaSnapshot = {
      version: 1,
      id: "snapshot-enum",
      fingerprint: "fingerprint-enum",
      projectId: "project-1",
      connectionId: "connection-1",
      connectionName: "Local app",
      driver: "postgres",
      databaseName: "app",
      schemaName: "public",
      capturedAt: 1,
      relations: [],
      routines: [],
      schemaObjects: [
        {
          name: "order_status",
          objectType: "ENUM TYPE",
          description: "Values: 'draft', 'in progress', 'it''s done'",
        },
        { name: "order_number_seq", objectType: "SEQUENCE" },
      ],
      warnings: [],
    };

    const artifact = serializeSchemaSnapshotToDbml(snapshot);
    expect(artifact.content).toContain('Enum "public"."order_status" {');
    expect(artifact.content).toContain('  "draft"');
    expect(artifact.content).toContain('  "in progress"');
    expect(artifact.content).toContain('  "it\'s done"');
    expect(artifact.warnings).toEqual([
      "1 non-enum schema object descriptor(s) are excluded from DBML.",
    ]);
  });

  it("keeps enum descriptors with unknown values visible as empty review blocks", () => {
    const snapshot = {
      version: 1,
      id: "snapshot-empty-enum",
      fingerprint: "fingerprint-empty-enum",
      projectId: "project-1",
      connectionId: "connection-1",
      connectionName: "Local app",
      driver: "postgres" as const,
      databaseName: "app",
      schemaName: "public",
      capturedAt: 1,
      relations: [],
      schemaObjects: [{ name: "state", objectType: "ENUM TYPE" }],
      warnings: [],
    } satisfies SchemaSnapshot;

    const artifact = serializeSchemaSnapshotToDbml(snapshot);
    expect(artifact.content).toContain('Enum "public"."state" {\n}');
    expect(artifact.warnings.join(" ")).toContain("enum values are unavailable");
  });

  it("round-trips table comments and mixed-dialect types without normalization", () => {
    const snapshot = {
      version: 1,
      id: "snapshot-mixed-types",
      fingerprint: "fingerprint-mixed-types",
      projectId: "project-1",
      connectionId: "connection-1",
      connectionName: "Mixed model",
      driver: "postgres" as const,
      databaseName: "app",
      schemaName: "public",
      capturedAt: 1,
      relations: [
        {
          name: "events",
          objectType: "BASE TABLE",
          comment: "Audit trail's source\\name\nkept readable",
          columns: [
            {
              name: "payload",
              data_type: "longtext",
              is_nullable: true,
              is_primary_key: false,
              is_unique: false,
              is_indexed: false,
              is_auto_increment: false,
            },
            {
              name: "flags",
              data_type: "tinyint",
              is_nullable: false,
              is_primary_key: false,
              is_unique: false,
              is_indexed: false,
              is_auto_increment: false,
            },
            {
              name: "labels",
              data_type: "text[]",
              is_nullable: true,
              is_primary_key: false,
              is_unique: false,
              is_indexed: false,
              is_auto_increment: false,
            },
            {
              name: "status",
              data_type: "varchar(20)",
              is_nullable: false,
              is_primary_key: false,
              is_unique: false,
              is_indexed: false,
              is_auto_increment: false,
              default_value: "'owner''s review'",
            },
            {
              name: "mode",
              data_type: "text",
              is_nullable: false,
              is_primary_key: false,
              is_unique: false,
              is_indexed: false,
              is_auto_increment: false,
              default_value: "active",
            },
          ],
          indexes: [],
          constraints: [],
        },
      ],
      schemaObjects: [],
      warnings: [],
    } satisfies SchemaSnapshot;

    const artifact = serializeSchemaSnapshotToDbml(snapshot);
    const parsed = parseSchemaDbml(artifact.content, "public");

    expect(artifact.content).toContain('"payload" longtext');
    expect(artifact.content).toContain('"flags" tinyint');
    expect(artifact.content).toContain('"labels" text[]');
    expect(artifact.content).toContain("default: 'owner\\'s review'");
    expect(artifact.content).toContain("default: 'active'");
    expect(parsed.relations[0]?.comment).toBe(
      "Audit trail's source\\name kept readable",
    );
    expect(parsed.relations[0]?.columns.map((column) => column.data_type)).toEqual([
      "longtext",
      "tinyint",
      "text[]",
      "varchar(20)",
      "text",
    ]);
    expect(parsed.relations[0]?.columns[3]?.default_value).toBe(
      "'owner''s review'",
    );
    expect(parsed.relations[0]?.columns[4]?.default_value).toBe("'active'");
  });
});
