import { describe, expect, it } from "vitest";
import type { SchemaDiagramLayout } from "./schemaDiagram";
import {
  applySchemaDiagramAreas,
  autoArrangeSchemaDiagramArea,
  commitSchemaDiagramAreas,
  createSchemaDiagramAreaHistory,
  moveSchemaDiagramRelationsToArea,
  redoSchemaDiagramAreas,
  undoSchemaDiagramAreas,
} from "./schemaDiagramAreas";

const layout: SchemaDiagramLayout = {
  snapshotId: "snapshot",
  width: 1000,
  height: 500,
  totalRelationCount: 3,
  totalRelationshipCount: 1,
  externalRelationshipCount: 0,
  nodes: ["users", "orders", "items"].map((relationName, index) => ({
    id: relationName,
    relationName,
    x: 48 + index * 300,
    y: 48,
    width: 240,
    height: 120,
    columns: [],
    hiddenColumnCount: 0,
    totalColumnCount: 0,
  })),
  edges: [
    {
      id: "orders-users",
      constraintName: "orders_user_fk",
      sourceRelation: "orders",
      sourceColumns: ["user_id"],
      targetSchema: "public",
      targetRelation: "users",
      targetColumns: ["id"],
    },
  ],
};

describe("schema diagram areas", () => {
  it("moves relations exclusively and lays out visible area members", () => {
    const areas = moveSchemaDiagramRelationsToArea(
      [
        { id: "a", name: "Core", relationNames: ["users"] },
        { id: "b", name: "Sales", relationNames: ["orders"] },
      ],
      ["users", "items"],
      "b",
    );
    const result = applySchemaDiagramAreas(layout, areas);

    expect(areas[0]!.relationNames).toEqual([]);
    expect(areas[1]!.relationNames).toEqual(["orders", "users", "items"]);
    expect(result.areaBounds[0]).toMatchObject({
      id: "b",
      visibleRelationCount: 3,
    });
  });

  it("dependency-orders an area and supports bounded undo/redo", () => {
    const arranged = autoArrangeSchemaDiagramArea(
      [{ id: "a", name: "Core", relationNames: ["orders", "users"] }],
      "a",
      layout.edges,
    );
    expect(arranged[0]!.relationNames).toEqual(["users", "orders"]);

    const committed = commitSchemaDiagramAreas(
      createSchemaDiagramAreaHistory(),
      arranged,
    );
    expect(undoSchemaDiagramAreas(committed).present).toEqual([]);
    expect(redoSchemaDiagramAreas(undoSchemaDiagramAreas(committed)).present).toEqual(
      arranged,
    );
  });
});
