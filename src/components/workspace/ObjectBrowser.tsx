import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Braces,
  Database,
  Eye,
  FunctionSquare,
  GripVertical,
  LayoutGrid,
  List,
  Loader2,
  RefreshCw,
  Search,
  Table2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { schemaService, type SchemaObjectInfo, type TableInfo } from "@/services/tauri";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTabStore } from "@/store/useTabStore";
import {
  explorerActivationLabel,
  shouldActivateExplorerObject,
} from "@/features/database-explorer/model/explorerActivation";

type ObjectFilter = "all" | "tables" | "views" | "routines" | "other";
type SortKey = "name" | "type" | "comment";
type SortDirection = "asc" | "desc";
type ColumnKey = SortKey;

interface ObjectRow {
  id: string;
  name: string;
  type: string;
  comment: string;
  schema: string;
  relation: boolean;
}

const COLUMN_LABELS: Record<ColumnKey, string> = {
  name: "Name",
  type: "Type",
  comment: "Comment",
};

const INITIAL_WIDTHS: Record<ColumnKey, number> = {
  name: 280,
  type: 130,
  comment: 320,
};

const FILTERS: Array<{ value: ObjectFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "tables", label: "Tables" },
  { value: "views", label: "Views" },
  { value: "routines", label: "Routines" },
  { value: "other", label: "Other" },
];

const LIST_ROW_HEIGHT = 34;
const LIST_OVERSCAN_ROWS = 18;

function normalizedType(value: string | null | undefined) {
  return (value || "TABLE").trim().toUpperCase().replace(/ /g, "_");
}

function isRelationType(type: string) {
  return ["TABLE", "BASE_TABLE", "VIEW", "MATERIALIZED_VIEW", "COLLECTION"].includes(type);
}

function rowFilter(row: ObjectRow): Exclude<ObjectFilter, "all"> {
  if (["TABLE", "BASE_TABLE", "COLLECTION"].includes(row.type)) return "tables";
  if (["VIEW", "MATERIALIZED_VIEW"].includes(row.type)) return "views";
  if (["FUNCTION", "PROCEDURE", "ROUTINE"].includes(row.type)) return "routines";
  return "other";
}

function objectIcon(type: string) {
  if (["VIEW", "MATERIALIZED_VIEW"].includes(type)) return Eye;
  if (["FUNCTION", "PROCEDURE", "ROUTINE"].includes(type)) return FunctionSquare;
  if (["TABLE", "BASE_TABLE", "COLLECTION"].includes(type)) return Table2;
  return Braces;
}

function displayType(type: string) {
  return type
    .toLocaleLowerCase()
    .replace(/_/g, " ")
    .replace(/(^|\s)\S/g, (letter: string) => letter.toLocaleUpperCase());
}

function tableRows(tables: TableInfo[], fallbackSchema: string): ObjectRow[] {
  return tables.map((table) => {
    const type = normalizedType(table.type);
    const schema = table.schema?.trim() || fallbackSchema;
    return {
      id: `${schema}\u0000${type}\u0000${table.name}`,
      name: table.name,
      type,
      comment: table.comment?.trim() || "",
      schema,
      relation: isRelationType(type),
    };
  });
}

function descriptorRows(objects: SchemaObjectInfo[], fallbackSchema: string): ObjectRow[] {
  return objects.map((object) => {
    const type = normalizedType(object.objectType);
    const schema = object.schema?.trim() || fallbackSchema;
    return {
      id: `${schema}\u0000${type}\u0000${object.name}`,
      name: object.name,
      type,
      comment: object.comment?.trim() || "",
      schema,
      relation: isRelationType(type),
    };
  });
}

export function ObjectBrowser() {
  const activeTab = useTabStore((state) =>
    state.tabs.find((tab) => tab.id === state.activeTabId),
  );
  const connection = useConnectionStore((state) =>
    state.connections.find((candidate) => candidate.id === activeTab?.connectionId),
  );
  const findOrCreateTableTab = useTabStore((state) => state.findOrCreateTableTab);
  const activationMode = useSettingsStore(
    (state) => state.settings.databaseExplorer.activationMode,
  );
  const viewMode = useSettingsStore(
    (state) => state.settings.databaseExplorer.objectBrowserViewMode,
  );
  const updateSettings = useSettingsStore((state) => state.updateSettings);
  const databaseName = activeTab?.databaseName?.trim() || undefined;
  const initialSchema = activeTab?.schemaName?.trim() || "";
  const [schemas, setSchemas] = useState<string[]>([]);
  const [selectedSchema, setSelectedSchema] = useState(initialSchema);
  const [rows, setRows] = useState<ObjectRow[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ObjectFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [columnWidths, setColumnWidths] = useState(INITIAL_WIDTHS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadGeneration = useRef(0);
  const listViewportRef = useRef<HTMLDivElement>(null);
  const [listScrollTop, setListScrollTop] = useState(0);
  const [listViewportHeight, setListViewportHeight] = useState(600);

  const load = useCallback(
    async (requestedSchema?: string) => {
      if (!connection) return;
      const generation = ++loadGeneration.current;
      setLoading(true);
      setError(null);
      try {
        const discoveredSchemas = databaseName
          ? await schemaService.getDatabaseSchemas(connection.id, databaseName)
          : await schemaService.getSchemas(connection.id);
        if (generation !== loadGeneration.current) return;
        const availableSchemas = [...new Set(discoveredSchemas.filter((schema) => schema.trim()))];
        const preferred = requestedSchema?.trim() || selectedSchema || initialSchema;
        const schema = availableSchemas.includes(preferred)
          ? preferred
          : availableSchemas[0] || preferred || databaseName || "";
        setSchemas(availableSchemas);
        setSelectedSchema(schema);

        const tablesPromise = databaseName
          ? schemaService.getDatabaseTables(connection.id, databaseName, schema)
          : schemaService.getTables(connection.id, schema);
        const objectsPromise = databaseName
          ? schemaService.getDatabaseSchemaObjects(connection.id, databaseName, schema)
          : schemaService.getSchemaObjects(connection.id, schema);
        const [tablesResult, objectsResult] = await Promise.allSettled([
          tablesPromise,
          objectsPromise,
        ]);
        if (generation !== loadGeneration.current) return;
        if (tablesResult.status === "rejected") throw tablesResult.reason;
        const combined = [
          ...tableRows(tablesResult.value, schema),
          ...(objectsResult.status === "fulfilled"
            ? descriptorRows(objectsResult.value, schema)
            : []),
        ];
        const unique = new Map<string, ObjectRow>();
        combined.forEach((row) => unique.set(row.id, row));
        setRows([...unique.values()]);
      } catch (cause) {
        if (generation !== loadGeneration.current) return;
        setRows([]);
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (generation === loadGeneration.current) setLoading(false);
      }
    }, [connection, databaseName, initialSchema, selectedSchema],
  );

  useEffect(() => {
    setRows([]);
    setSchemas([]);
    setSelectedSchema(initialSchema);
    setSearch("");
    setFilter("all");
    void load(initialSchema);
    return () => {
      loadGeneration.current += 1;
    };
  }, [connection?.id, databaseName, initialSchema]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return rows
      .filter((row) => filter === "all" || rowFilter(row) === filter)
      .filter(
        (row) =>
          !query ||
          row.name.toLocaleLowerCase().includes(query) ||
          row.type.toLocaleLowerCase().includes(query) ||
          row.comment.toLocaleLowerCase().includes(query),
      )
      .sort((left, right) => {
        const compared = left[sortKey].localeCompare(right[sortKey], undefined, {
          numeric: true,
          sensitivity: "base",
        });
        if (compared) return sortDirection === "asc" ? compared : -compared;
        return left.name.localeCompare(right.name, undefined, { numeric: true });
      });
  }, [filter, rows, search, sortDirection, sortKey]);

  const filterCounts = useMemo(() => {
    const counts: Record<ObjectFilter, number> = {
      all: rows.length,
      tables: 0,
      views: 0,
      routines: 0,
      other: 0,
    };
    rows.forEach((row) => {
      counts[rowFilter(row)] += 1;
    });
    return counts;
  }, [rows]);

  useEffect(() => {
    const viewport = listViewportRef.current;
    if (!viewport) return;
    const updateHeight = () => setListViewportHeight(Math.max(viewport.clientHeight, 1));
    updateHeight();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateHeight);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [viewMode, visibleRows.length]);

  useEffect(() => {
    const viewport = listViewportRef.current;
    if (viewport) viewport.scrollTop = 0;
    setListScrollTop(0);
  }, [filter, search, selectedSchema, sortDirection, sortKey]);

  const virtualRowRange = useMemo(() => {
    const firstVisible = Math.floor(listScrollTop / LIST_ROW_HEIGHT);
    const visibleCount = Math.ceil(listViewportHeight / LIST_ROW_HEIGHT);
    const start = Math.max(0, firstVisible - LIST_OVERSCAN_ROWS);
    const end = Math.min(
      visibleRows.length,
      firstVisible + visibleCount + LIST_OVERSCAN_ROWS,
    );
    return {
      start,
      rows: visibleRows.slice(start, end),
    };
  }, [listScrollTop, listViewportHeight, visibleRows]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection("asc");
  };

  const openObject = (row: ObjectRow) => {
    if (!connection || !row.relation) return;
    findOrCreateTableTab(
      connection.id,
      row.schema || selectedSchema,
      row.name,
      row.type,
      databaseName,
    );
  };

  const setViewMode = (mode: "list" | "grid") => {
    void updateSettings({
      databaseExplorer: {
        ...useSettingsStore.getState().settings.databaseExplorer,
        objectBrowserViewMode: mode,
      },
    });
  };

  const beginResize = (key: ColumnKey, event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = columnWidths[key];
    const minimum = key === "type" ? 84 : 120;
    const onMove = (moveEvent: MouseEvent) => {
      setColumnWidths((widths) => ({
        ...widths,
        [key]: Math.max(minimum, startWidth + moveEvent.clientX - startX),
      }));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.classList.remove("select-none", "cursor-col-resize");
    };
    document.body.classList.add("select-none", "cursor-col-resize");
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  if (!connection) {
    return (
      <div className="flex h-full items-center justify-center text-xs wb-muted">
        Data source is no longer available.
      </div>
    );
  }

  const gridTemplateColumns = (Object.keys(COLUMN_LABELS) as ColumnKey[])
    .map((key, index) =>
      index === 2 ? `minmax(${columnWidths[key]}px, 1fr)` : `${columnWidths[key]}px`,
    )
    .join(" ");
  const minimumWidth = Object.values(columnWidths).reduce((total, width) => total + width, 0) + 48;
  const activationHint = `${explorerActivationLabel(activationMode)} to open data`;

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col bg-[hsl(var(--wb-editor))] text-[hsl(var(--wb-text))]">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="max-w-44 truncate rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))] px-2 py-1 text-[11px] font-medium" title={databaseName || connection.name}>
            {databaseName || connection.name}
          </span>
          {schemas.length > 1 ? (
            <select
              value={selectedSchema}
              onChange={(event) => void load(event.target.value)}
              className="h-7 max-w-40 rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))] px-2 text-[11px] outline-none focus:border-[hsl(var(--wb-accent))]"
              aria-label="Schema"
            >
              {schemas.map((schema) => (
                <option key={schema} value={schema}>{schema}</option>
              ))}
            </select>
          ) : selectedSchema && selectedSchema !== databaseName ? (
            <span className="max-w-36 truncate rounded-[4px] border border-[hsl(var(--wb-border-subtle))] px-2 py-1 text-[11px] wb-muted" title={selectedSchema}>
              {selectedSchema}
            </span>
          ) : null}
        </div>
        <label className="relative min-w-36 flex-1">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 wb-muted" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-7 w-full rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-input))] pl-8 pr-7 text-[11px] outline-none placeholder:text-[hsl(var(--wb-text-muted))] focus:border-[hsl(var(--wb-accent))]"
            placeholder="Search database objects"
            aria-label="Search database objects"
          />
          {search && (
            <button type="button" className="absolute right-1.5 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-[3px] wb-muted hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]" onClick={() => setSearch("")} aria-label="Clear search">
              <X size={11} />
            </button>
          )}
        </label>
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value as ObjectFilter)}
          className="h-7 max-w-28 shrink-0 rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))] px-2 text-[11px] outline-none focus:border-[hsl(var(--wb-accent))] 2xl:hidden"
          aria-label="Object type"
        >
          {FILTERS.map((item) => (
            <option key={item.value} value={item.value}>{item.label} ({filterCounts[item.value]})</option>
          ))}
        </select>
        <div className="hidden h-7 shrink-0 items-center rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))] p-0.5 2xl:flex">
          {FILTERS.map((item) => (
            <button key={item.value} type="button" className={cn("h-6 rounded-[3px] px-2 text-[10px] wb-muted hover:text-[hsl(var(--wb-text))]", filter === item.value && "bg-[hsl(var(--wb-selected))] text-[hsl(var(--wb-text))]")} onClick={() => setFilter(item.value)}>
              {item.label} <span className="ml-1 tabular-nums opacity-65">{filterCounts[item.value]}</span>
            </button>
          ))}
        </div>
        <div className="flex h-7 shrink-0 rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))] p-0.5">
          {([['list', List], ['grid', LayoutGrid]] as const).map(([mode, Icon]) => (
            <button key={mode} type="button" className={cn("flex h-6 w-6 items-center justify-center rounded-[3px] wb-muted hover:text-[hsl(var(--wb-text))]", viewMode === mode && "bg-[hsl(var(--wb-selected))] text-[hsl(var(--wb-text))]")} onClick={() => setViewMode(mode)} title={`${mode === "list" ? "List" : "Grid"} view`} aria-pressed={viewMode === mode}>
              <Icon size={13} />
            </button>
          ))}
        </div>
        <button type="button" className="wb-icon-button h-7 w-7" onClick={() => void load(selectedSchema)} disabled={loading} title="Refresh objects">
          <RefreshCw size={13} className={loading ? "animate-spin" : undefined} />
        </button>
      </div>

      {loading && rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-xs wb-muted"><Loader2 size={15} className="animate-spin" />Loading objects...</div>
      ) : error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-xs text-[hsl(var(--wb-danger))]">
          <span>Could not load database objects: {error}</span>
          <button type="button" className="wb-text-button" onClick={() => void load(selectedSchema)}>Try again</button>
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 text-xs wb-muted">
          <Database size={20} className="opacity-55" />
          <span>{search ? "No objects match this search." : "No objects are visible in this schema."}</span>
        </div>
      ) : viewMode === "list" ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-auto overflow-y-hidden">
          <div className="grid h-7 shrink-0 items-center gap-3 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-3 text-[11px] font-medium wb-muted" style={{ gridTemplateColumns, minWidth: minimumWidth }}>
            {(Object.keys(COLUMN_LABELS) as ColumnKey[]).map((key) => (
              <div key={key} className="relative flex min-w-0 items-center">
                <button type="button" className="flex min-w-0 items-center gap-1 truncate pr-4 text-left" onClick={() => toggleSort(key)}>
                  <span className="truncate">{COLUMN_LABELS[key]}</span>
                  {sortKey === key && (sortDirection === "asc" ? <ArrowUp size={10} /> : <ArrowDown size={10} />)}
                </button>
                <button type="button" aria-label={`Resize ${COLUMN_LABELS[key]} column`} className="absolute -right-2 flex h-7 w-3 cursor-col-resize items-center justify-center hover:bg-[hsl(var(--wb-accent)/0.16)]" onMouseDown={(event) => beginResize(key, event)} onDoubleClick={() => setColumnWidths((widths) => ({ ...widths, [key]: INITIAL_WIDTHS[key] }))}>
                  <GripVertical size={10} />
                </button>
              </div>
            ))}
          </div>
          <div
            ref={listViewportRef}
            className="min-h-0 flex-1 overflow-auto"
            style={{ minWidth: minimumWidth }}
            onScroll={(event) => setListScrollTop(event.currentTarget.scrollTop)}
          >
            <div
              className="relative w-full"
              style={{ height: visibleRows.length * LIST_ROW_HEIGHT }}
            >
            {virtualRowRange.rows.map((row, rowOffset) => {
              const Icon = objectIcon(row.type);
              const rowIndex = virtualRowRange.start + rowOffset;
              return (
                <button key={row.id} type="button" className={cn("absolute left-0 grid h-[34px] w-full items-center gap-3 border-b border-[hsl(var(--wb-border-subtle))] px-3 text-left outline-none hover:bg-[hsl(var(--wb-hover))] focus-visible:bg-[hsl(var(--wb-selected))]", !row.relation && "cursor-default")} style={{ gridTemplateColumns, top: rowIndex * LIST_ROW_HEIGHT }} onClick={(event) => { if (row.relation && shouldActivateExplorerObject(activationMode, "click", event.detail)) openObject(row); }} onDoubleClick={() => { if (row.relation && shouldActivateExplorerObject(activationMode, "double-click")) openObject(row); }} onKeyDown={(event) => { if (event.key === "Enter") openObject(row); }} title={row.relation ? activationHint : `${displayType(row.type)} metadata`}>
                  <span className="flex min-w-0 items-center gap-2 truncate text-[12px] font-medium text-[hsl(var(--wb-text))]">
                    <Icon size={13} className="shrink-0 text-[hsl(var(--wb-accent))]" />
                    <span className="truncate">{row.name}</span>
                  </span>
                  <span className="truncate text-[11px] wb-muted">{displayType(row.type)}</span>
                  <span className="truncate text-[11px] wb-muted" title={row.comment}>{row.comment}</span>
                </button>
              );
            })}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(168px,1fr))] content-start gap-2 overflow-auto p-3">
          {visibleRows.map((row) => {
            const Icon = objectIcon(row.type);
            return (
              <button key={row.id} type="button" className={cn("flex min-h-28 flex-col items-center justify-center gap-1 rounded-[8px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))] p-3 text-center outline-none [content-visibility:auto] [contain-intrinsic-size:168px_112px] hover:border-[hsl(var(--wb-accent)/0.55)] hover:bg-[hsl(var(--wb-hover))] focus-visible:border-[hsl(var(--wb-accent))]", !row.relation && "cursor-default")} onClick={(event) => { if (row.relation && shouldActivateExplorerObject(activationMode, "click", event.detail)) openObject(row); }} onDoubleClick={() => { if (row.relation && shouldActivateExplorerObject(activationMode, "double-click")) openObject(row); }} onKeyDown={(event) => { if (event.key === "Enter") openObject(row); }} title={row.relation ? activationHint : `${displayType(row.type)} metadata`}>
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[hsl(var(--wb-accent)/0.1)]"><Icon size={21} className="text-[hsl(var(--wb-accent))]" /></span>
                <span className="w-full truncate text-xs font-medium" title={row.name}>{row.name}</span>
                <span className="text-[10px] wb-muted">{displayType(row.type)}</span>
                {row.comment && <span className="w-full truncate text-[10px] wb-muted" title={row.comment}>{row.comment}</span>}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
