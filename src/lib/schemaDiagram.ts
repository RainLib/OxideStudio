import type {
  ColumnInfo,
  ConstraintInfo,
  SchemaSnapshot,
} from "@/services/tauri/types";

export interface SchemaDiagramColumn {
  name: string;
  dataType: string;
  nullable: boolean;
  primaryKey: boolean;
  foreignKey: boolean;
  unique: boolean;
  indexed: boolean;
}

export interface SchemaDiagramNode {
  id: string;
  relationName: string;
  objectType?: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  columns: SchemaDiagramColumn[];
  hiddenColumnCount: number;
  totalColumnCount: number;
}

export interface SchemaDiagramEdge {
  id: string;
  constraintName: string;
  sourceRelation: string;
  sourceColumns: string[];
  targetSchema: string;
  targetRelation: string;
  targetColumns: string[];
}

export interface SchemaDiagramLayout {
  snapshotId: string;
  nodes: SchemaDiagramNode[];
  edges: SchemaDiagramEdge[];
  width: number;
  height: number;
  totalRelationCount: number;
  totalRelationshipCount: number;
  externalRelationshipCount: number;
}

export interface SchemaDiagramOptions {
  query?: string;
  keysOnly?: boolean;
  maxColumns?: number;
}

const NODE_WIDTH = 240;
const NODE_HEADER_HEIGHT = 38;
const COLUMN_ROW_HEIGHT = 21;
const NODE_FOOTER_HEIGHT = 24;
const HORIZONTAL_GAP = 92;
const VERTICAL_GAP = 46;
const CANVAS_PADDING = 48;

function isForeignKey(constraint: ConstraintInfo) {
  return constraint.constraint_type.toUpperCase().includes("FOREIGN");
}

function relationId(snapshot: SchemaSnapshot, relationName: string) {
  return [snapshot.connectionId, snapshot.databaseName || "", snapshot.schemaName, relationName]
    .map(encodeURIComponent)
    .join(":");
}

function relationshipEdges(snapshot: SchemaSnapshot): SchemaDiagramEdge[] {
  return snapshot.relations
    .flatMap((relation) =>
      relation.constraints
        .filter(
          (constraint) => isForeignKey(constraint) && constraint.referenced_table,
        )
        .map((constraint) => ({
          id: `${relationId(snapshot, relation.name)}:${encodeURIComponent(constraint.name)}`,
          constraintName: constraint.name,
          sourceRelation: relation.name,
          sourceColumns: [...constraint.columns],
          targetSchema: constraint.referenced_schema || snapshot.schemaName,
          targetRelation: constraint.referenced_table || "",
          targetColumns: [...constraint.referenced_columns],
        })),
    )
    .sort((left, right) =>
      [left.sourceRelation, left.constraintName, left.targetRelation]
        .join("\u0000")
        .localeCompare(
          [right.sourceRelation, right.constraintName, right.targetRelation].join(
            "\u0000",
          ),
        ),
    );
}

function diagramColumn(
  column: ColumnInfo,
  foreignKeyColumns: ReadonlySet<string>,
): SchemaDiagramColumn {
  return {
    name: column.name,
    dataType: column.data_type,
    nullable: column.is_nullable,
    primaryKey: column.is_primary_key,
    foreignKey: foreignKeyColumns.has(column.name),
    unique: Boolean(column.is_unique),
    indexed: Boolean(column.is_indexed),
  };
}

function matchesQuery(
  query: string,
  relationName: string,
  columns: ColumnInfo[],
) {
  if (!query) return true;
  return (
    relationName.toLocaleLowerCase().includes(query) ||
    columns.some((column) =>
      column.name.toLocaleLowerCase().includes(query),
    )
  );
}

function relationRanks(
  relationNames: string[],
  edges: SchemaDiagramEdge[],
) {
  const visible = new Set(relationNames);
  const children = new Map<string, Set<string>>();
  const indegree = new Map(relationNames.map((name) => [name, 0]));
  for (const edge of edges) {
    if (!visible.has(edge.sourceRelation) || !visible.has(edge.targetRelation)) {
      continue;
    }
    const parentChildren = children.get(edge.targetRelation) || new Set<string>();
    if (!parentChildren.has(edge.sourceRelation)) {
      parentChildren.add(edge.sourceRelation);
      children.set(edge.targetRelation, parentChildren);
      indegree.set(
        edge.sourceRelation,
        (indegree.get(edge.sourceRelation) || 0) + 1,
      );
    }
  }

  const ranks = new Map(relationNames.map((name) => [name, 0]));
  const queue = relationNames
    .filter((name) => indegree.get(name) === 0)
    .sort((left, right) => left.localeCompare(right));
  const visited = new Set<string>();
  while (queue.length > 0) {
    const parent = queue.shift();
    if (!parent || visited.has(parent)) continue;
    visited.add(parent);
    const parentRank = ranks.get(parent) || 0;
    for (const child of [...(children.get(parent) || [])].sort((left, right) =>
      left.localeCompare(right),
    )) {
      ranks.set(child, Math.max(ranks.get(child) || 0, parentRank + 1));
      const nextIndegree = (indegree.get(child) || 0) - 1;
      indegree.set(child, nextIndegree);
      if (nextIndegree === 0) queue.push(child);
    }
    queue.sort((left, right) => left.localeCompare(right));
  }

  // Cycles cannot be topologically ranked. Keeping their nodes in rank zero
  // preserves every relation and relationship without inventing a direction.
  return ranks;
}

export function buildSchemaDiagram(
  snapshot: SchemaSnapshot,
  options: SchemaDiagramOptions = {},
): SchemaDiagramLayout {
  const query = options.query?.trim().toLocaleLowerCase() || "";
  const maxColumns = Math.max(1, Math.min(50, options.maxColumns || 18));
  const allEdges = relationshipEdges(snapshot);
  const visibleRelations = snapshot.relations
    .filter((relation) => matchesQuery(query, relation.name, relation.columns))
    .sort((left, right) => left.name.localeCompare(right.name));
  const visibleNames = new Set(visibleRelations.map((relation) => relation.name));
  const edges = allEdges.filter(
    (edge) =>
      visibleNames.has(edge.sourceRelation) &&
      visibleNames.has(edge.targetRelation) &&
      edge.targetSchema === snapshot.schemaName,
  );
  const externalRelationshipCount = allEdges.filter(
    (edge) =>
      edge.targetSchema !== snapshot.schemaName ||
      !snapshot.relations.some(
        (relation) => relation.name === edge.targetRelation,
      ),
  ).length;
  const ranks = relationRanks(
    visibleRelations.map((relation) => relation.name),
    edges,
  );
  const foreignKeysByRelation = new Map<string, Set<string>>();
  for (const edge of allEdges) {
    const columns = foreignKeysByRelation.get(edge.sourceRelation) || new Set<string>();
    edge.sourceColumns.forEach((column) => columns.add(column));
    foreignKeysByRelation.set(edge.sourceRelation, columns);
  }

  const prepared = visibleRelations.map((relation) => {
    const foreignKeyColumns = foreignKeysByRelation.get(relation.name) || new Set();
    const availableColumns = relation.columns
      .map((column) => diagramColumn(column, foreignKeyColumns))
      .filter(
        (column) =>
          !options.keysOnly ||
          column.primaryKey ||
          column.foreignKey ||
          column.unique ||
          column.indexed,
      );
    const columns = availableColumns.slice(0, maxColumns);
    const hiddenColumnCount = relation.columns.length - columns.length;
    const height =
      NODE_HEADER_HEIGHT +
      Math.max(1, columns.length) * COLUMN_ROW_HEIGHT +
      (hiddenColumnCount > 0 ? NODE_FOOTER_HEIGHT : 8);
    return { relation, columns, hiddenColumnCount, height };
  });
  const maxNodeHeight = Math.max(100, ...prepared.map((item) => item.height));
  const maxRows = Math.max(3, Math.ceil(Math.sqrt(Math.max(1, prepared.length))));
  const byRank = new Map<number, typeof prepared>();
  for (const item of prepared) {
    const rank = ranks.get(item.relation.name) || 0;
    const group = byRank.get(rank) || [];
    group.push(item);
    byRank.set(rank, group);
  }
  const orderedRanks = [...byRank.keys()].sort((left, right) => left - right);
  let columnOffset = 0;
  const nodes: SchemaDiagramNode[] = [];
  for (const rank of orderedRanks) {
    const group = byRank.get(rank) || [];
    group.sort((left, right) =>
      left.relation.name.localeCompare(right.relation.name),
    );
    group.forEach((item, index) => {
      const localColumn = Math.floor(index / maxRows);
      const row = index % maxRows;
      nodes.push({
        id: relationId(snapshot, item.relation.name),
        relationName: item.relation.name,
        objectType: item.relation.objectType,
        x:
          CANVAS_PADDING +
          (columnOffset + localColumn) * (NODE_WIDTH + HORIZONTAL_GAP),
        y: CANVAS_PADDING + row * (maxNodeHeight + VERTICAL_GAP),
        width: NODE_WIDTH,
        height: item.height,
        columns: item.columns,
        hiddenColumnCount: item.hiddenColumnCount,
        totalColumnCount: item.relation.columns.length,
      });
    });
    columnOffset += Math.max(1, Math.ceil(group.length / maxRows));
  }

  const width = Math.max(
    640,
    ...nodes.map((node) => node.x + node.width + CANVAS_PADDING),
  );
  const height = Math.max(
    420,
    ...nodes.map((node) => node.y + node.height + CANVAS_PADDING),
  );
  return {
    snapshotId: snapshot.id,
    nodes,
    edges,
    width,
    height,
    totalRelationCount: snapshot.relations.length,
    totalRelationshipCount: allEdges.length,
    externalRelationshipCount,
  };
}

export function diagramColumnOffset(node: SchemaDiagramNode, columnName?: string) {
  const index = columnName
    ? node.columns.findIndex((column) => column.name === columnName)
    : -1;
  return NODE_HEADER_HEIGHT +
    (index >= 0 ? index * COLUMN_ROW_HEIGHT + COLUMN_ROW_HEIGHT / 2 : 8);
}
