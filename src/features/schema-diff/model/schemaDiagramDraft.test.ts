import { describe, expect, it } from "vitest";
import type { SchemaSnapshot } from "@/services/tauri/types";
import {
  addSchemaDraftColumn,
  addSchemaDraftForeignKey,
  addSchemaDraftIndex,
  addSchemaDraftRelation,
  commitSchemaDiagramDraft,
  createSchemaDiagramDraftHistory,
  createSchemaDiagramDraftSnapshot,
  isSchemaDiagramDraftSnapshot,
  redoSchemaDiagramDraft,
  removeSchemaDraftColumn,
  removeSchemaDraftRelation,
  renameSchemaDraftRelation,
  undoSchemaDiagramDraft,
  updateSchemaDraftColumn,
} from "./schemaDiagramDraft";

const snapshot: SchemaSnapshot = {
  version: 1,
  id: "snapshot-1",
  fingerprint: "fingerprint-1",
  projectId: "project-1",
  connectionId: "connection-1",
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
          data_type: "bigint",
          is_nullable: false,
          is_primary_key: true,
        },
      ],
      indexes: [],
      constraints: [],
    },
  ],
};

describe("schema diagram structured draft", () => {
  it("supports table, column, index and foreign-key edits", () => {
    let relations = addSchemaDraftRelation(snapshot.relations, "orders");
    relations = addSchemaDraftColumn(relations, "orders", {
      name: "id",
      dataType: "bigint",
      nullable: false,
      primaryKey: true,
    });
    relations = addSchemaDraftColumn(relations, "orders", {
      name: "user_id",
      dataType: "bigint",
      nullable: false,
    });
    relations = addSchemaDraftIndex(relations, "orders", {
      name: "orders_user_id_idx",
      columns: ["user_id"],
      is_unique: false,
    });
    relations = addSchemaDraftForeignKey(relations, "orders", {
      name: "orders_user_id_fk",
      columns: ["user_id"],
      referencedTable: "users",
      referencedColumns: ["id"],
    });

    const orders = relations.find((relation) => relation.name === "orders");
    expect(orders?.columns).toHaveLength(2);
    expect(orders?.indexes.map((index) => index.name)).toEqual([
      "orders_pkey",
      "orders_user_id_idx",
    ]);
    expect(
      orders?.constraints.find(
        (constraint) => constraint.constraint_type === "FOREIGN KEY",
      ),
    ).toMatchObject({
      constraint_type: "FOREIGN KEY",
      referenced_table: "users",
      referenced_columns: ["id"],
    });
  });

  it("propagates relation and column renames through references", () => {
    let relations = addSchemaDraftRelation(snapshot.relations, "orders");
    relations = addSchemaDraftColumn(relations, "orders", {
      name: "user_id",
      dataType: "bigint",
      nullable: false,
    });
    relations = addSchemaDraftForeignKey(relations, "orders", {
      name: "orders_user_id_fk",
      columns: ["user_id"],
      referencedTable: "users",
      referencedColumns: ["id"],
    });
    relations = renameSchemaDraftRelation(relations, "users", "accounts");
    relations = updateSchemaDraftColumn(relations, "accounts", "id", {
      name: "account_id",
      dataType: "uuid",
      nullable: false,
    });

    const foreignKey = relations
      .find((relation) => relation.name === "orders")
      ?.constraints.find((constraint) => constraint.constraint_type === "FOREIGN KEY");
    expect(foreignKey).toMatchObject({
      referenced_table: "accounts",
      referenced_columns: ["account_id"],
    });
  });

  it("removes dependent metadata when a column or relation is removed", () => {
    let relations = addSchemaDraftRelation(snapshot.relations, "orders");
    relations = addSchemaDraftColumn(relations, "orders", {
      name: "user_id",
      dataType: "bigint",
      nullable: false,
    });
    relations = addSchemaDraftForeignKey(relations, "orders", {
      name: "orders_user_id_fk",
      columns: ["user_id"],
      referencedTable: "users",
      referencedColumns: ["id"],
    });
    relations = removeSchemaDraftColumn(relations, "users", "id");
    expect(relations.find((item) => item.name === "orders")?.constraints).toEqual([]);
    relations = removeSchemaDraftRelation(relations, "users");
    expect(relations.map((relation) => relation.name)).toEqual(["orders"]);
  });

  it("keeps a bounded undo/redo timeline using structural snapshots", () => {
    const initial = createSchemaDiagramDraftHistory(snapshot);
    const added = addSchemaDraftRelation(initial.present, "orders");
    const committed = commitSchemaDiagramDraft(initial, added);
    expect(committed.past[0]).toBe(snapshot.relations);
    expect(undoSchemaDiagramDraft(committed).present).toBe(snapshot.relations);
    expect(redoSchemaDiagramDraft(undoSchemaDiagramDraft(committed)).present).toBe(added);
  });

  it("rejects a second primary key instead of creating an invalid draft", () => {
    const withPrimary = {
      ...snapshot,
      relations: snapshot.relations.map((relation) => ({
        ...relation,
        constraints: [
          {
            name: "users_pkey",
            constraint_type: "PRIMARY KEY",
            columns: ["id"],
            referenced_columns: [],
          },
        ],
      })),
    };
    expect(() => addSchemaDraftColumn(withPrimary.relations, "users", {
      name: "legacy_id",
      dataType: "bigint",
      nullable: false,
      primaryKey: true,
    })).toThrow("already has a primary key");
  });

  it("creates an explicitly offline review-only snapshot", () => {
    const draft = createSchemaDiagramDraftSnapshot(
      snapshot,
      addSchemaDraftRelation(snapshot.relations, "orders"),
      42,
    );
    expect(draft.id).toContain("diagram-draft-42");
    expect(isSchemaDiagramDraftSnapshot(draft)).toBe(true);
    expect(draft.warnings).toContain("OFFLINE_DIAGRAM_DRAFT_REVIEW_ONLY");
  });
});
