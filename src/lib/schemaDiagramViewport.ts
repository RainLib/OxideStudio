import type {
  SchemaDiagramEdge,
  SchemaDiagramNode,
} from "@/lib/schemaDiagram";

export type DiagramViewportBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SchemaDiagramViewportIndex = {
  cellSize: number;
  nodes: readonly SchemaDiagramNode[];
  edges: readonly SchemaDiagramEdge[];
  nodesByName: ReadonlyMap<string, SchemaDiagramNode>;
  nodeIndexesByCell: ReadonlyMap<string, readonly number[]>;
  edgeIndexesByRelation: ReadonlyMap<string, readonly number[]>;
};

export type SchemaDiagramViewportResult = {
  nodes: SchemaDiagramNode[];
  edges: SchemaDiagramEdge[];
};

const DEFAULT_CELL_SIZE = 640;

/**
 * Builds immutable-by-contract lookup tables once per diagram layout. Scroll
 * updates can then inspect only the cells intersecting the overscanned viewport
 * and only the edges adjacent to visible relations.
 */
export function buildSchemaDiagramViewportIndex(
  nodes: readonly SchemaDiagramNode[],
  edges: readonly SchemaDiagramEdge[],
  cellSize = DEFAULT_CELL_SIZE,
): SchemaDiagramViewportIndex {
  const normalizedCellSize =
    Number.isFinite(cellSize) && cellSize > 0
      ? Math.max(1, Math.floor(cellSize))
      : DEFAULT_CELL_SIZE;
  const nodeIndexesByCell = new Map<string, number[]>();
  const nodesByName = new Map<string, SchemaDiagramNode>();

  nodes.forEach((node, nodeIndex) => {
    nodesByName.set(node.relationName, node);
    forEachIntersectingCell(node, normalizedCellSize, (cellX, cellY) => {
      const key = cellKey(cellX, cellY);
      const indexes = nodeIndexesByCell.get(key);
      if (indexes) indexes.push(nodeIndex);
      else nodeIndexesByCell.set(key, [nodeIndex]);
    });
  });

  const edgeIndexesByRelation = new Map<string, number[]>();
  edges.forEach((edge, edgeIndex) => {
    addRelationEdge(edgeIndexesByRelation, edge.sourceRelation, edgeIndex);
    if (edge.targetRelation !== edge.sourceRelation) {
      addRelationEdge(edgeIndexesByRelation, edge.targetRelation, edgeIndex);
    }
  });

  return {
    cellSize: normalizedCellSize,
    nodes,
    edges,
    nodesByName,
    nodeIndexesByCell,
    edgeIndexesByRelation,
  };
}

export function querySchemaDiagramViewport(
  index: SchemaDiagramViewportIndex,
  bounds: DiagramViewportBounds,
): SchemaDiagramViewportResult {
  if (bounds.width < 0 || bounds.height < 0) {
    return { nodes: [], edges: [] };
  }

  const nodeIndexes = new Set<number>();
  forEachIntersectingCell(bounds, index.cellSize, (cellX, cellY) => {
    for (const nodeIndex of index.nodeIndexesByCell.get(cellKey(cellX, cellY)) || []) {
      nodeIndexes.add(nodeIndex);
    }
  });

  const nodes = [...nodeIndexes]
    .sort((left, right) => left - right)
    .map((nodeIndex) => index.nodes[nodeIndex])
    .filter((node): node is SchemaDiagramNode => Boolean(node))
    .filter((node) => rectanglesIntersect(node, bounds));

  const edgeIndexes = new Set<number>();
  for (const node of nodes) {
    for (const edgeIndex of
      index.edgeIndexesByRelation.get(node.relationName) || []) {
      edgeIndexes.add(edgeIndex);
    }
  }
  const edges = [...edgeIndexes]
    .sort((left, right) => left - right)
    .map((edgeIndex) => index.edges[edgeIndex])
    .filter((edge): edge is SchemaDiagramEdge => Boolean(edge));

  return { nodes, edges };
}

function addRelationEdge(
  index: Map<string, number[]>,
  relationName: string,
  edgeIndex: number,
) {
  const edges = index.get(relationName);
  if (edges) edges.push(edgeIndex);
  else index.set(relationName, [edgeIndex]);
}

function rectanglesIntersect(
  left: Pick<SchemaDiagramNode, "x" | "y" | "width" | "height">,
  right: DiagramViewportBounds,
) {
  return (
    left.x + left.width >= right.x &&
    left.x <= right.x + right.width &&
    left.y + left.height >= right.y &&
    left.y <= right.y + right.height
  );
}

function forEachIntersectingCell(
  bounds: DiagramViewportBounds,
  cellSize: number,
  visit: (cellX: number, cellY: number) => void,
) {
  const startX = Math.floor(bounds.x / cellSize);
  const endX = Math.floor((bounds.x + Math.max(0, bounds.width)) / cellSize);
  const startY = Math.floor(bounds.y / cellSize);
  const endY = Math.floor((bounds.y + Math.max(0, bounds.height)) / cellSize);
  for (let cellY = startY; cellY <= endY; cellY += 1) {
    for (let cellX = startX; cellX <= endX; cellX += 1) {
      visit(cellX, cellY);
    }
  }
}

function cellKey(cellX: number, cellY: number) {
  return `${cellX}:${cellY}`;
}
