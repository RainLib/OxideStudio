import type {
  SchemaDiagramEdge,
  SchemaDiagramLayout,
  SchemaDiagramNode,
} from "@/lib/schemaDiagram";
import { lexicalTopologicalOrder } from "@/lib/lexicalTopologicalOrder";

export type SchemaDiagramArea = {
  id: string;
  name: string;
  relationNames: string[];
};

export type SchemaDiagramAreaBounds = SchemaDiagramArea & {
  x: number;
  y: number;
  width: number;
  height: number;
  visibleRelationCount: number;
};

export type SchemaDiagramAreaHistory = {
  past: SchemaDiagramArea[][];
  present: SchemaDiagramArea[];
  future: SchemaDiagramArea[][];
};

const AREA_PADDING = 24;
const AREA_HEADER = 34;
const AREA_GAP = 44;
const NODE_GAP = 32;

export function createSchemaDiagramAreaHistory(): SchemaDiagramAreaHistory {
  return { past: [], present: [], future: [] };
}

export function commitSchemaDiagramAreas(
  history: SchemaDiagramAreaHistory,
  next: SchemaDiagramArea[],
): SchemaDiagramAreaHistory {
  if (JSON.stringify(history.present) === JSON.stringify(next)) return history;
  return {
    past: [...history.past, cloneAreas(history.present)].slice(-100),
    present: cloneAreas(next),
    future: [],
  };
}

export function undoSchemaDiagramAreas(
  history: SchemaDiagramAreaHistory,
): SchemaDiagramAreaHistory {
  const previous = history.past[history.past.length - 1];
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: cloneAreas(previous),
    future: [cloneAreas(history.present), ...history.future].slice(0, 100),
  };
}

export function redoSchemaDiagramAreas(
  history: SchemaDiagramAreaHistory,
): SchemaDiagramAreaHistory {
  const next = history.future[0];
  if (!next) return history;
  return {
    past: [...history.past, cloneAreas(history.present)].slice(-100),
    present: cloneAreas(next),
    future: history.future.slice(1),
  };
}

export function moveSchemaDiagramRelationsToArea(
  areas: SchemaDiagramArea[],
  relationNames: readonly string[],
  targetAreaId: string,
) {
  const moving = new Set(relationNames);
  return areas.map((area) => ({
    ...area,
    relationNames: [
      ...area.relationNames.filter((name) => !moving.has(name)),
      ...(area.id === targetAreaId
        ? relationNames.filter((name) => !area.relationNames.includes(name))
        : []),
    ],
  }));
}

export function removeSchemaDiagramRelationsFromAreas(
  areas: SchemaDiagramArea[],
  relationNames: readonly string[],
) {
  const removing = new Set(relationNames);
  return areas.map((area) => ({
    ...area,
    relationNames: area.relationNames.filter((name) => !removing.has(name)),
  }));
}

export function renameSchemaDiagramArea(
  areas: SchemaDiagramArea[],
  targetAreaId: string,
  name: string,
) {
  const nextName = name.trim();
  if (!nextName) return areas;
  return areas.map((area) =>
    area.id === targetAreaId && area.name !== nextName
      ? { ...area, name: nextName }
      : area,
  );
}

export function autoArrangeSchemaDiagramArea(
  areas: SchemaDiagramArea[],
  targetAreaId: string,
  edges: SchemaDiagramEdge[],
) {
  return areas.map((area) =>
    area.id === targetAreaId
      ? {
          ...area,
          relationNames: dependencyOrder(area.relationNames, edges),
        }
      : { ...area, relationNames: [...area.relationNames] },
  );
}

/**
 * Reorders every area in one bounded pass. Relations are exclusive to an area,
 * so cross-area dependencies must not distort a group's internal layout.
 */
export function autoArrangeSchemaDiagramAreas(
  areas: SchemaDiagramArea[],
  edges: SchemaDiagramEdge[],
) {
  const areaIdByRelation = new Map<string, string>();
  const edgesByArea = new Map<string, SchemaDiagramEdge[]>();
  for (const area of areas) {
    for (const relationName of area.relationNames) {
      areaIdByRelation.set(relationName, area.id);
    }
  }
  for (const edge of edges) {
    const sourceAreaId = areaIdByRelation.get(edge.sourceRelation);
    if (
      !sourceAreaId ||
      sourceAreaId !== areaIdByRelation.get(edge.targetRelation)
    ) {
      continue;
    }
    const areaEdges = edgesByArea.get(sourceAreaId) || [];
    areaEdges.push(edge);
    edgesByArea.set(sourceAreaId, areaEdges);
  }
  return areas.map((area) => ({
    ...area,
    relationNames: dependencyOrder(
      area.relationNames,
      edgesByArea.get(area.id) || [],
    ),
  }));
}

export function applySchemaDiagramAreas(
  layout: SchemaDiagramLayout,
  areas: SchemaDiagramArea[],
): { layout: SchemaDiagramLayout; areaBounds: SchemaDiagramAreaBounds[] } {
  if (areas.length === 0 || layout.nodes.length === 0) {
    return { layout, areaBounds: [] };
  }
  const nodesByName = new Map(
    layout.nodes.map((node) => [node.relationName, node]),
  );
  const grouped = new Set(areas.flatMap((area) => area.relationNames));
  const nodes: SchemaDiagramNode[] = [];
  const areaBounds: SchemaDiagramAreaBounds[] = [];
  let areaY = AREA_PADDING;

  for (const area of areas) {
    const visibleNodes = area.relationNames
      .map((name) => nodesByName.get(name))
      .filter((node): node is SchemaDiagramNode => Boolean(node));
    if (visibleNodes.length === 0) continue;
    const columns = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(visibleNodes.length))));
    const rows = Math.ceil(visibleNodes.length / columns);
    const nodeWidth = Math.max(...visibleNodes.map((node) => node.width));
    const rowHeights = Array.from({ length: rows }, (_, row) =>
      Math.max(
        ...visibleNodes
          .slice(row * columns, row * columns + columns)
          .map((node) => node.height),
      ),
    );
    const width =
      AREA_PADDING * 2 + columns * nodeWidth + (columns - 1) * NODE_GAP;
    const height =
      AREA_HEADER +
      AREA_PADDING +
      rowHeights.reduce((total, value) => total + value, 0) +
      Math.max(0, rows - 1) * NODE_GAP;
    visibleNodes.forEach((node, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const precedingRows = rowHeights
        .slice(0, row)
        .reduce((total, value) => total + value + NODE_GAP, 0);
      nodes.push({
        ...node,
        x: AREA_PADDING * 2 + column * (nodeWidth + NODE_GAP),
        y: areaY + AREA_HEADER + precedingRows,
      });
    });
    areaBounds.push({
      ...area,
      relationNames: [...area.relationNames],
      x: AREA_PADDING,
      y: areaY,
      width,
      height,
      visibleRelationCount: visibleNodes.length,
    });
    areaY += height + AREA_GAP;
  }

  const ungrouped = layout.nodes.filter(
    (node) => !grouped.has(node.relationName),
  );
  const ungroupedTop = areaBounds.length > 0 ? areaY : 0;
  nodes.push(
    ...ungrouped.map((node) => ({
      ...node,
      x: node.x,
      y: node.y + ungroupedTop,
    })),
  );
  const width = Math.max(
    640,
    ...nodes.map((node) => node.x + node.width + AREA_PADDING),
    ...areaBounds.map((area) => area.x + area.width + AREA_PADDING),
  );
  const height = Math.max(
    420,
    ...nodes.map((node) => node.y + node.height + AREA_PADDING),
    ...areaBounds.map((area) => area.y + area.height + AREA_PADDING),
  );
  return {
    layout: { ...layout, nodes, width, height },
    areaBounds,
  };
}

function dependencyOrder(names: string[], edges: SchemaDiagramEdge[]) {
  return lexicalTopologicalOrder(
    names,
    edges.map(
      (edge) => [edge.targetRelation, edge.sourceRelation] as const,
    ),
  ).order;
}

function cloneAreas(areas: SchemaDiagramArea[]) {
  return areas.map((area) => ({ ...area, relationNames: [...area.relationNames] }));
}
