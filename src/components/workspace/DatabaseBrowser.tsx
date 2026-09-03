import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Database,
  GripVertical,
  LayoutGrid,
  List,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { defaultDatabaseCapabilities } from "@/lib/databaseDialect";
import { schemaService, type DatabaseInfo } from "@/services/tauri";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useTabStore } from "@/store/useTabStore";
import {
  explorerActivationLabel,
  shouldActivateExplorerObject,
} from "@/features/database-explorer/model/explorerActivation";

type ColumnKey =
  | "name"
  | "sizeBytes"
  | "createdAt"
  | "updatedAt"
  | "defaultCharset"
  | "defaultCollation"
  | "comment";
type SortDirection = "asc" | "desc";
type ViewMode = "list" | "grid";

const INITIAL_WIDTHS: Record<ColumnKey, number> = {
  name: 260,
  sizeBytes: 110,
  createdAt: 150,
  updatedAt: 150,
  defaultCharset: 140,
  defaultCollation: 190,
  comment: 280,
};

const COLUMN_LABELS: Record<ColumnKey, string> = {
  name: "Name",
  sizeBytes: "Size",
  createdAt: "Created",
  updatedAt: "Updated",
  defaultCharset: "Character set",
  defaultCollation: "Collation",
  comment: "Comment",
};

function formatBytes(value?: number | null) {
  if (value == null || !Number.isFinite(value)) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = Math.max(0, value);
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${amount >= 10 || unit === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`;
}

function formatTimestamp(value?: string | null) {
  if (!value?.trim()) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return parsed.toLocaleString();
}

function cellValue(row: DatabaseInfo, key: ColumnKey) {
  if (key === "name") return row.name;
  if (key === "sizeBytes") return formatBytes(row.sizeBytes);
  if (key === "createdAt") return formatTimestamp(row.createdAt);
  if (key === "updatedAt") return formatTimestamp(row.updatedAt);
  if (key === "defaultCharset") return row.defaultCharset || "";
  if (key === "defaultCollation") return row.defaultCollation || "";
  return row.comment || "";
}

function initialDirection(key: ColumnKey): SortDirection {
  return ["sizeBytes", "createdAt", "updatedAt"].includes(key) ? "desc" : "asc";
}

export function DatabaseBrowser() {
  const activeTab = useTabStore((state) =>
    state.tabs.find((tab) => tab.id === state.activeTabId),
  );
  const connection = useConnectionStore((state) =>
    state.connections.find((candidate) => candidate.id === activeTab?.connectionId),
  );
  const setActiveConnection = useConnectionStore((state) => state.setActiveConnection);
  const openObjectBrowser = useTabStore((state) => state.openObjectBrowser);
  const activationMode = useSettingsStore(
    (state) => state.settings.databaseExplorer.activationMode,
  );
  const viewMode = useSettingsStore(
    (state) => state.settings.databaseExplorer.objectBrowserViewMode,
  );
  const updateSettings = useSettingsStore((state) => state.updateSettings);
  const [rows, setRows] = useState<DatabaseInfo[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<ColumnKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [columnWidths, setColumnWidths] = useState(INITIAL_WIDTHS);
  const searchRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    if (!connection) return;
    setLoading(true);
    setError(null);
    try {
      const connectionError = await setActiveConnection(connection.id);
      if (connectionError) throw new Error(connectionError);
      const databases = await schemaService.getDatabaseMetadata(connection.id);
      setRows(databases.filter((database) => database.name.trim()));
    } catch (cause) {
      setRows([]);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [connection, setActiveConnection]);

  useEffect(() => {
    setRows([]);
    setSearch("");
    void refresh();
  }, [connection?.id, refresh]);

  const columns = useMemo(() => {
    const next: ColumnKey[] = ["name"];
    if (rows.some((row) => row.sizeBytes != null)) next.push("sizeBytes");
    if (rows.some((row) => row.createdAt?.trim())) next.push("createdAt");
    if (rows.some((row) => row.updatedAt?.trim())) next.push("updatedAt");
    if (rows.some((row) => row.defaultCharset?.trim())) next.push("defaultCharset");
    if (rows.some((row) => row.defaultCollation?.trim())) next.push("defaultCollation");
    if (rows.some((row) => row.comment?.trim())) next.push("comment");
    return next;
  }, [rows]);

  useEffect(() => {
    if (!columns.includes(sortKey)) {
      setSortKey("name");
      setSortDirection("asc");
    }
  }, [columns, sortKey]);

  const visibleRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const filtered = rows.filter(
      (row) =>
        !query ||
        row.name.toLocaleLowerCase().includes(query) ||
        row.comment?.toLocaleLowerCase().includes(query),
    );
    return [...filtered].sort((left, right) => {
      const leftValue = sortKey === "sizeBytes" ? left.sizeBytes ?? -1 : cellValue(left, sortKey).toLocaleLowerCase();
      const rightValue = sortKey === "sizeBytes" ? right.sizeBytes ?? -1 : cellValue(right, sortKey).toLocaleLowerCase();
      const compared =
        typeof leftValue === "number" && typeof rightValue === "number"
          ? leftValue - rightValue
          : String(leftValue).localeCompare(String(rightValue), undefined, {
              numeric: true,
              sensitivity: "base",
            });
      if (compared) return sortDirection === "asc" ? compared : -compared;
      return left.name.localeCompare(right.name, undefined, { numeric: true });
    });
  }, [rows, search, sortDirection, sortKey]);

  const openDatabase = (database: string) => {
    if (!connection) return;
    const capabilities = defaultDatabaseCapabilities(connection.driver);
    if (capabilities.supportsDatabaseCatalogs) {
      openObjectBrowser(connection.id, connection.name, database);
      return;
    }
    openObjectBrowser(connection.id, connection.name, undefined, database);
  };

  const setViewMode = (mode: ViewMode) => {
    void updateSettings({
      databaseExplorer: {
        ...useSettingsStore.getState().settings.databaseExplorer,
        objectBrowserViewMode: mode,
      },
    });
  };

  const toggleSort = (key: ColumnKey) => {
    if (sortKey === key) {
      setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection(initialDirection(key));
  };

  const beginResize = (key: ColumnKey, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = columnWidths[key];
    const minimum = key === "name" || key === "comment" ? 120 : 76;
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
    return <div className="flex h-full items-center justify-center text-xs wb-muted">Data source is no longer available.</div>;
  }

  const gridTemplateColumns = columns
    .map((key, index) =>
      index === columns.length - 1
        ? `minmax(${columnWidths[key]}px, 1fr)`
        : `${columnWidths[key]}px`,
    )
    .join(" ");
  const minimumWidth = columns.reduce((total, key) => total + columnWidths[key], 0);
  const activationHint = `${explorerActivationLabel(activationMode)} to browse database objects`;

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col bg-[hsl(var(--wb-editor))] text-[hsl(var(--wb-text))]">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-3">
        <span className="max-w-56 truncate rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))] px-2 py-1 text-[11px] font-medium" title={connection.name}>
          {connection.name}
        </span>
        <label className="relative min-w-40 flex-1">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 wb-muted" />
          <input
            ref={searchRef}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-7 w-full rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-input))] pl-8 pr-7 text-[11px] outline-none placeholder:text-[hsl(var(--wb-text-muted))] focus:border-[hsl(var(--wb-accent))]"
            placeholder="Search databases and comments"
            aria-label="Search databases"
          />
          {search && (
            <button
              type="button"
              className="absolute right-1.5 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-[3px] wb-muted hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]"
              onClick={() => {
                setSearch("");
                searchRef.current?.focus();
              }}
              aria-label="Clear search"
            >
              <X size={11} />
            </button>
          )}
        </label>
        <select
          value={sortKey}
          onChange={(event) => toggleSort(event.target.value as ColumnKey)}
          className="h-7 rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))] px-2 text-[11px] outline-none focus:border-[hsl(var(--wb-accent))]"
          aria-label="Sort databases"
        >
          {columns.map((key) => <option key={key} value={key}>{COLUMN_LABELS[key]}</option>)}
        </select>
        <button type="button" className="wb-icon-button h-7 w-7" onClick={() => setSortDirection((value) => value === "asc" ? "desc" : "asc")} title={`Sort ${sortDirection === "asc" ? "ascending" : "descending"}`}>
          {sortDirection === "asc" ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
        </button>
        <div className="flex h-7 rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))] p-0.5">
          {([['list', List], ['grid', LayoutGrid]] as const).map(([mode, Icon]) => (
            <button key={mode} type="button" className={cn("flex h-6 w-6 items-center justify-center rounded-[3px] wb-muted hover:text-[hsl(var(--wb-text))]", viewMode === mode && "bg-[hsl(var(--wb-selected))] text-[hsl(var(--wb-text))]")} onClick={() => setViewMode(mode)} title={`${mode === "list" ? "List" : "Grid"} view`}>
              <Icon size={13} />
            </button>
          ))}
        </div>
        <button type="button" className="wb-icon-button h-7 w-7" onClick={() => void refresh()} disabled={loading} title="Refresh databases">
          <RefreshCw size={13} className={loading ? "animate-spin" : undefined} />
        </button>
      </div>

      {loading && rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-xs wb-muted"><Loader2 size={15} className="animate-spin" />Loading databases...</div>
      ) : error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-xs text-[hsl(var(--wb-danger))]">
          <span>Could not load database catalog: {error}</span>
          <button type="button" className="wb-text-button" onClick={() => void refresh()}>Try again</button>
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs wb-muted">{search ? "No databases match this search." : "No databases are visible to this account."}</div>
      ) : viewMode === "list" ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="grid h-7 items-center gap-3 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-3 text-[11px] font-medium wb-muted" style={{ gridTemplateColumns, minWidth: minimumWidth }}>
            {columns.map((key) => (
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
          {visibleRows.map((row) => (
            <button key={row.name} type="button" className="grid h-[34px] w-full items-center gap-3 border-b border-[hsl(var(--wb-border-subtle))] px-3 text-left outline-none hover:bg-[hsl(var(--wb-hover))] focus-visible:bg-[hsl(var(--wb-selected))]" style={{ gridTemplateColumns, minWidth: minimumWidth }} onClick={(event) => { if (shouldActivateExplorerObject(activationMode, "click", event.detail)) openDatabase(row.name); }} onDoubleClick={() => { if (shouldActivateExplorerObject(activationMode, "double-click")) openDatabase(row.name); }} onKeyDown={(event) => { if (event.key === "Enter") openDatabase(row.name); }} title={activationHint}>
              {columns.map((key) => (
                <span key={key} className={cn("min-w-0 truncate text-[11px] wb-muted", ["sizeBytes", "createdAt", "updatedAt"].includes(key) && "tabular-nums", key === "name" && "flex items-center gap-2 text-[12px] font-medium text-[hsl(var(--wb-text))]")} title={cellValue(row, key)}>
                  {key === "name" && <Database size={13} className="shrink-0 text-emerald-400" />}
                  {cellValue(row, key) || "-"}
                </span>
              ))}
            </button>
          ))}
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(176px,1fr))] content-start gap-2 overflow-auto p-3">
          {visibleRows.map((row) => (
            <button key={row.name} type="button" className="flex min-h-28 flex-col items-center justify-center gap-1 rounded-[6px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))] p-3 text-center outline-none hover:border-[hsl(var(--wb-accent)/0.55)] hover:bg-[hsl(var(--wb-hover))] focus-visible:border-[hsl(var(--wb-accent))]" onClick={(event) => { if (shouldActivateExplorerObject(activationMode, "click", event.detail)) openDatabase(row.name); }} onDoubleClick={() => { if (shouldActivateExplorerObject(activationMode, "double-click")) openDatabase(row.name); }} onKeyDown={(event) => { if (event.key === "Enter") openDatabase(row.name); }} title={activationHint}>
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10"><Database size={21} className="text-emerald-400" /></span>
              <span className="w-full truncate text-xs font-medium" title={row.name}>{row.name}</span>
              <span className="min-h-4 text-[10px] wb-muted">{formatBytes(row.sizeBytes) || row.defaultCharset || "Database"}</span>
              {row.comment && <span className="w-full truncate text-[10px] wb-muted" title={row.comment}>{row.comment}</span>}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
