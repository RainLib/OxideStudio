import { performance } from "node:perf_hooks";
import { buildSchemaDiagram } from "../src/lib/schemaDiagram";
import { autoArrangeSchemaDiagramAreas } from "../src/lib/schemaDiagramAreas";
import {
  buildSchemaDiagramViewportIndex,
  querySchemaDiagramViewport,
} from "../src/lib/schemaDiagramViewport";
import type { SchemaSnapshot } from "../src/services/tauri/types";

const DEFAULT_SIZES = [1_000, 5_000, 10_000];
const QUERY_COUNT = 100;

function requestedSizes() {
  const values = process.argv
    .slice(2)
    .map(Number)
    .filter((value) => Number.isInteger(value) && value > 0 && value <= 50_000);
  return values.length > 0 ? values : DEFAULT_SIZES;
}

function relationName(index: number) {
  return `relation_${String(index).padStart(5, "0")}`;
}

function benchmarkSnapshot(size: number): SchemaSnapshot {
  return {
    version: 1,
    id: `diagram-benchmark-${size}`,
    fingerprint: `diagram-benchmark-${size}`,
    projectId: "benchmark",
    connectionId: "benchmark",
    connectionName: "Diagram benchmark",
    driver: "postgres",
    databaseName: "benchmark",
    schemaName: "public",
    capturedAt: 0,
    relations: Array.from({ length: size }, (_, index) => ({
      name: relationName(index),
      objectType: "TABLE",
      columns: Array.from({ length: 6 }, (__, columnIndex) => ({
        name: columnIndex === 0 ? "id" : `column_${columnIndex}`,
        data_type: columnIndex === 0 ? "bigint" : "text",
        is_nullable: columnIndex !== 0,
        is_primary_key: columnIndex === 0,
      })),
      indexes: [],
      constraints:
        index === 0
          ? []
          : [
              {
                name: `fk_${index}`,
                constraint_type: "FOREIGN KEY",
                columns: ["column_1"],
                referenced_schema: "public",
                referenced_table: relationName(Math.floor((index - 1) / 2)),
                referenced_columns: ["id"],
              },
            ],
    })),
    warnings: [],
  };
}

function elapsed(start: number) {
  return Number((performance.now() - start).toFixed(2));
}

const rows = requestedSizes().map((size) => {
  const snapshot = benchmarkSnapshot(size);
  let started = performance.now();
  const layout = buildSchemaDiagram(snapshot, { maxColumns: 18 });
  const layoutMs = elapsed(started);

  const areaSize = 100;
  const areas = Array.from(
    { length: Math.ceil(layout.nodes.length / areaSize) },
    (_, areaIndex) => ({
      id: `area-${areaIndex}`,
      name: `Area ${areaIndex + 1}`,
      relationNames: layout.nodes
        .slice(areaIndex * areaSize, (areaIndex + 1) * areaSize)
        .map((node) => node.relationName)
        .reverse(),
    }),
  );
  started = performance.now();
  autoArrangeSchemaDiagramAreas(areas, layout.edges);
  const arrangeAreasMs = elapsed(started);

  started = performance.now();
  const index = buildSchemaDiagramViewportIndex(layout.nodes, layout.edges);
  const indexMs = elapsed(started);

  started = performance.now();
  let visibleNodes = 0;
  let visibleEdges = 0;
  for (let query = 0; query < QUERY_COUNT; query += 1) {
    const ratio = query / Math.max(1, QUERY_COUNT - 1);
    const result = querySchemaDiagramViewport(index, {
      x: Math.max(0, layout.width * ratio - 800),
      y: Math.max(0, layout.height * (1 - ratio) - 500),
      width: 1_600,
      height: 1_000,
    });
    visibleNodes += result.nodes.length;
    visibleEdges += result.edges.length;
  }
  const viewportQueriesMs = elapsed(started);

  return {
    relations: size,
    relationships: layout.edges.length,
    layoutMs,
    areaCount: areas.length,
    arrangeAreasMs,
    indexMs,
    viewportQueries: QUERY_COUNT,
    viewportQueriesMs,
    averageVisibleNodes: Math.round(visibleNodes / QUERY_COUNT),
    averageVisibleEdges: Math.round(visibleEdges / QUERY_COUNT),
  };
});

console.table(rows);
