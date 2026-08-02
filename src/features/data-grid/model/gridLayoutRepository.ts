import { documentTextRevision } from "@/lib/documentRevision";

/** A durable, presentation-only grid layout. It never stores row data or filters. */
export interface PersistedGridLayout {
  columnWidths: Record<string, number>;
  columnOrder: string[];
  hiddenColumns: string[];
  frozenColumnCount: number;
}

export interface GridLayoutScope {
  type: "table" | "query" | string;
  connectionId?: string;
  databaseName?: string;
  schemaName?: string;
  tableName?: string;
  queryLanguage?: string;
  sql?: string;
}

const STORAGE_KEY = "oxide.grid-layouts.v1";
const MAX_LAYOUTS = 200;
const MAX_COLUMNS = 512;

function normalizeScopePart(value: string | undefined) {
  return (value || "").trim().toLocaleLowerCase();
}

/**
 * Table layouts are scoped to the actual object. Query layouts use a stable
 * SQL revision rather than an ephemeral tab id, so layouts cannot leak across
 * unrelated statements on the same connection.
 */
export function gridLayoutKey(scope: GridLayoutScope): string | null {
  const connectionId = normalizeScopePart(scope.connectionId);
  if (!connectionId) return null;

  const namespace = [
    connectionId,
    normalizeScopePart(scope.databaseName),
    normalizeScopePart(scope.schemaName),
  ].join(":");

  if (scope.type === "table" && scope.tableName?.trim()) {
    return `table:${namespace}:${normalizeScopePart(scope.tableName)}`;
  }

  const sql = scope.sql?.trim();
  if (scope.type === "query" && sql) {
    return `query:${namespace}:${normalizeScopePart(scope.queryLanguage)}:${documentTextRevision(
      undefined,
      sql,
    )}`;
  }

  return null;
}

export function normalizeGridLayout(
  layout: Partial<PersistedGridLayout> | null | undefined,
  availableColumnIds: readonly string[],
): PersistedGridLayout {
  const allowed = new Set(availableColumnIds.filter(Boolean).slice(0, MAX_COLUMNS));
  const columnWidths = Object.fromEntries(
    Object.entries(layout?.columnWidths || {}).filter(
      ([columnId, width]) =>
        allowed.has(columnId) &&
        Number.isFinite(width) &&
        width >= 40 &&
        width <= 2400,
    ),
  );
  const columnOrder = uniqueKnownIds(layout?.columnOrder, allowed);
  const hiddenColumns = uniqueKnownIds(layout?.hiddenColumns, allowed);
  const visibleColumnCount = Math.max(1, allowed.size - hiddenColumns.length);
  const frozenColumnCount = Math.min(
    Math.max(0, Math.floor(Number(layout?.frozenColumnCount) || 0)),
    Math.max(0, visibleColumnCount - 1),
  );

  return { columnWidths, columnOrder, hiddenColumns, frozenColumnCount };
}

export function loadGridLayout(
  scope: GridLayoutScope,
  availableColumnIds: readonly string[],
): PersistedGridLayout | null {
  const key = gridLayoutKey(scope);
  if (!key) return null;
  const layout = readLayouts()[key];
  return layout ? normalizeGridLayout(layout, availableColumnIds) : null;
}

export function saveGridLayout(scope: GridLayoutScope, layout: PersistedGridLayout) {
  const key = gridLayoutKey(scope);
  if (!key) return;
  const layouts = readLayouts();
  layouts[key] = {
    columnWidths: layout.columnWidths,
    columnOrder: layout.columnOrder.slice(0, MAX_COLUMNS),
    hiddenColumns: layout.hiddenColumns.slice(0, MAX_COLUMNS),
    frozenColumnCount: Math.max(0, Math.floor(layout.frozenColumnCount || 0)),
  };
  const keys = Object.keys(layouts);
  if (keys.length > MAX_LAYOUTS) {
    keys.slice(0, keys.length - MAX_LAYOUTS).forEach((staleKey) => delete layouts[staleKey]);
  }
  writeLayouts(layouts);
}

export function removeGridLayout(scope: GridLayoutScope) {
  const key = gridLayoutKey(scope);
  if (!key) return;
  const layouts = readLayouts();
  if (!(key in layouts)) return;
  delete layouts[key];
  writeLayouts(layouts);
}

function uniqueKnownIds(values: unknown, allowed: Set<string>) {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  return values
    .filter((value): value is string => typeof value === "string" && allowed.has(value))
    .filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    })
    .slice(0, MAX_COLUMNS);
}

function readLayouts(): Record<string, PersistedGridLayout> {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, PersistedGridLayout>)
      : {};
  } catch {
    return {};
  }
}

function writeLayouts(layouts: Record<string, PersistedGridLayout>) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(layouts));
    }
  } catch {
    // Persistence is optional; unavailable storage must not break the grid.
  }
}
