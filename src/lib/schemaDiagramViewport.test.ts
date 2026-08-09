import { describe, expect, it } from "vitest";
import type {
  SchemaDiagramEdge,
  SchemaDiagramNode,
} from "./schemaDiagram";
import {
  buildSchemaDiagramViewportIndex,
  buildSchemaDiagramEdgeIndex,
  querySchemaDiagramViewport,
} from "./schemaDiagramViewport";

const nodes: SchemaDiagramNode[] = [
  diagramNode("users", 0, 0, 120, 100),
  diagramNode("orders", 220, 0, 120, 100),
  diagramNode("items", 520, 220, 260, 100),
  diagramNode("audit", 1200, 800, 120, 100),
];

const edges: SchemaDiagramEdge[] = [
  diagramEdge("orders-users", "orders", "users"),
  diagramEdge("items-orders", "items", "orders"),
  diagramEdge("audit-self", "audit", "audit"),
];

describe("schema diagram viewport index", () => {
  it("queries intersecting cells without duplicating nodes that span cells", () => {
    const index = buildSchemaDiagramViewportIndex(nodes, edges, 256);
    const result = querySchemaDiagramViewport(index, {
      x: 500,
      y: 200,
      width: 200,
      height: 160,
    });

    expect(result.nodes.map((node) => node.relationName)).toEqual(["items"]);
    expect(result.edges.map((edge) => edge.id)).toEqual(["items-orders"]);
  });

  it("returns every edge adjacent to a visible relation in source order", () => {
    const index = buildSchemaDiagramViewportIndex(nodes, edges, 256);
    const result = querySchemaDiagramViewport(index, {
      x: 200,
      y: -10,
      width: 160,
      height: 130,
    });

    expect(result.nodes.map((node) => node.relationName)).toEqual(["orders"]);
    expect(result.edges.map((edge) => edge.id)).toEqual([
      "orders-users",
      "items-orders",
    ]);
    expect(index.nodesByName.get("users")).toBe(nodes[0]);
  });

  it("keeps inclusive viewport boundaries and ignores empty regions", () => {
    const index = buildSchemaDiagramViewportIndex(nodes, edges, 256);
    expect(
      querySchemaDiagramViewport(index, {
        x: 120,
        y: 100,
        width: 0,
        height: 0,
      }).nodes.map((node) => node.relationName),
    ).toEqual(["users"]);
    expect(
      querySchemaDiagramViewport(index, {
        x: 900,
        y: 400,
        width: 100,
        height: 100,
      }),
    ).toEqual({ nodes: [], edges: [] });
  });

  it("indexes a self relationship only once", () => {
    expect(buildSchemaDiagramEdgeIndex(edges).get("audit")).toEqual([2]);
  });
});

function diagramNode(
  relationName: string,
  x: number,
  y: number,
  width: number,
  height: number,
): SchemaDiagramNode {
  return {
    id: relationName,
    relationName,
    x,
    y,
    width,
    height,
    columns: [],
    hiddenColumnCount: 0,
    totalColumnCount: 0,
  };
}

function diagramEdge(
  id: string,
  sourceRelation: string,
  targetRelation: string,
): SchemaDiagramEdge {
  return {
    id,
    constraintName: id,
    sourceRelation,
    sourceColumns: ["id"],
    targetSchema: "public",
    targetRelation,
    targetColumns: ["id"],
  };
}
