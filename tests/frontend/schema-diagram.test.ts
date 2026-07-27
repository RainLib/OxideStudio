import { beforeEach, describe, expect, it } from "vitest";
import { buildSchemaDiagram, diagramColumnOffset } from "@/lib/schemaDiagram";
import type {
  ColumnInfo,
  ConstraintInfo,
  SchemaRelationSnapshot,
  SchemaSnapshot,
} from "@/services/tauri/types";
import { useTabStore } from "@/store/useTabStore";

function column(
  name: string,
  options: Partial<ColumnInfo> = {},
): ColumnInfo {
  return {
    name,
    data_type: "int8",
    is_nullable: false,
    is_primary_key: name === "id",
    is_unique: name === "id",
    is_indexed: name === "id",
    ...options,
  };
}

function foreignKey(
  name: string,
  columns: string[],
  target: string,
  targetColumns: string[],
  targetSchema = "public",
): ConstraintInfo {
  return {
    name,
    constraint_type: "FOREIGN KEY",
    columns,
    referenced_schema: targetSchema,
    referenced_table: target,
    referenced_columns: targetColumns,
  };
}

function relation(
  name: string,
  columns: ColumnInfo[],
  constraints: ConstraintInfo[] = [],
): SchemaRelationSnapshot {
  return {
    name,
    objectType: "BASE TABLE",
    columns,
    indexes: [],
    constraints,
  };
}

function snapshot(relations: SchemaRelationSnapshot[]): SchemaSnapshot {
  return {
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
    relations,
    warnings: [],
  };
}

describe("schema diagram model", () => {
  beforeEach(() => {
    useTabStore.setState({ tabs: [], activeTabId: null, closedTabsStack: [] });
  });

  it("places referenced parents before children and preserves composite keys", () => {
    const model = buildSchemaDiagram(
      snapshot([
        relation("orders", [column("id"), column("tenant_id"), column("user_id")], [
          foreignKey(
            "orders_user_fk",
            ["tenant_id", "user_id"],
            "users",
            ["tenant_id", "id"],
          ),
        ]),
        relation("users", [column("tenant_id"), column("id")]),
      ]),
    );

    const orders = model.nodes.find((node) => node.relationName === "orders");
    const users = model.nodes.find((node) => node.relationName === "users");
    expect(users?.x).toBeLessThan(orders?.x || 0);
    expect(model.edges).toEqual([
      expect.objectContaining({
        constraintName: "orders_user_fk",
        sourceColumns: ["tenant_id", "user_id"],
        targetColumns: ["tenant_id", "id"],
      }),
    ]);
    expect(
      orders?.columns.find((item) => item.name === "tenant_id")?.foreignKey,
    ).toBe(true);
  });

  it("filters relations, bounds columns, and keeps layout deterministic", () => {
    const current = snapshot([
      relation("audit_events", [column("id"), column("actor_id"), column("payload")]),
      relation("users", [column("id"), column("email", { data_type: "text" })]),
    ]);

    const first = buildSchemaDiagram(current, { query: "email", maxColumns: 1 });
    const second = buildSchemaDiagram(current, { query: "email", maxColumns: 1 });

    expect(first).toEqual(second);
    expect(first.nodes.map((node) => node.relationName)).toEqual(["users"]);
    expect(first.nodes[0]?.columns).toHaveLength(1);
    expect(first.nodes[0]?.hiddenColumnCount).toBe(1);
  });

  it("separates external relationships and keys-only columns", () => {
    const model = buildSchemaDiagram(
      snapshot([
        relation(
          "events",
          [
            column("id"),
            column("account_id", { is_indexed: false }),
            column("payload", { data_type: "jsonb", is_nullable: true }),
          ],
          [foreignKey("events_account_fk", ["account_id"], "accounts", ["id"], "core")],
        ),
      ]),
      { keysOnly: true },
    );

    expect(model.edges).toHaveLength(0);
    expect(model.totalRelationshipCount).toBe(1);
    expect(model.externalRelationshipCount).toBe(1);
    expect(model.nodes[0]?.columns.map((item) => item.name)).toEqual([
      "id",
      "account_id",
    ]);
    expect(diagramColumnOffset(model.nodes[0]!, "account_id")).toBeGreaterThan(
      diagramColumnOffset(model.nodes[0]!, "id"),
    );
  });

  it("keeps cyclic relations and edges in a deterministic layout", () => {
    const current = snapshot([
      relation(
        "authors",
        [column("id"), column("featured_book_id")],
        [
          foreignKey(
            "authors_featured_book_fk",
            ["featured_book_id"],
            "books",
            ["id"],
          ),
        ],
      ),
      relation(
        "books",
        [column("id"), column("author_id")],
        [foreignKey("books_author_fk", ["author_id"], "authors", ["id"])],
      ),
    ]);

    const first = buildSchemaDiagram(current);
    const second = buildSchemaDiagram(current);
    expect(first).toEqual(second);
    expect(first.nodes.map((node) => node.relationName)).toEqual([
      "authors",
      "books",
    ]);
    expect(first.edges).toHaveLength(2);
  });

  it("reuses one diagram artifact per target and refreshes its snapshot", () => {
    const first = snapshot([relation("users", [column("id")])]);
    const tabId = useTabStore.getState().openSchemaDiagramTab(first);
    useTabStore
      .getState()
      .selectSchemaDiagramRelation(tabId, "users");

    const refreshed = {
      ...first,
      id: "snapshot-2",
      capturedAt: 2,
      relations: [
        ...first.relations,
        relation("orders", [column("id")]),
      ],
    };
    expect(useTabStore.getState().openSchemaDiagramTab(refreshed)).toBe(tabId);

    const state = useTabStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]).toMatchObject({
      type: "schema_diagram",
      schemaDiagramSnapshot: { id: "snapshot-2" },
      selectedDiagramRelationName: "users",
    });
  });
});
