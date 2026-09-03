import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  Database,
} from "lucide-react";
import {
  defaultDatabaseName,
  isFileBasedDatabaseDriver,
} from "@/lib/databaseDialect";
import { parseConnectionUrl } from "@/lib/connectionUrlParser";
import type { DatabaseDriver } from "@/services/tauri/types";
import { useDatabaseNavigationStore } from "@/lib/databaseNavigation";
import {
  EMPTY_EXPLORER_NODE_IDS,
  useDatabaseExplorerStore,
  useExplorerExpansionSetState,
} from "@/store/useDatabaseExplorerStore";
import { explorerNodeId } from "@/features/database-explorer/model/explorerTreeNode";
import { resolveExplorerSelection } from "@/features/database-explorer/model/explorerSelection";
import {
  explorerTreeVisibleNodeIds,
  moveExplorerTreeFocus,
} from "@/features/database-explorer/ui/explorerTreeDom";
import { EXPLORER_MENU_CONTENT_CLASS } from "@/features/database-explorer/ui/explorerStyles";
import { ExplorerTreeStateRow } from "@/features/database-explorer/ui/ExplorerTreeStateRow";
import {
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  ExplorerContextMenuHost,
  ExplorerSharedContextMenu,
} from "@/features/database-explorer/ui/ExplorerContextMenuHost";

export type PostgresDatabaseDiscoveryStatus =
  "idle" | "loading" | "success" | "error";

type DatabaseLoadStatus = "idle" | "loading" | "success" | "error";

interface DatabaseLoadState {
  status: DatabaseLoadStatus;
  error?: string;
}

export interface PostgresDatabaseTreeProps {
  explorerScopeId?: string;
  connectionId: string;
  enabled?: boolean;
  databases: string[];
  currentDatabase: string;
  status: PostgresDatabaseDiscoveryStatus;
  error?: string | null;
  schemaCount: string;
  connectionColor: string;
  children: ReactNode;
  /** Optional exact visible set supplied by the parent; the current database is not forced into it. */
  visibleDatabases?: string[];
  /** Uses the Database Explorer's shared filter without changing expansion state. */
  filterText?: string;
  /** Shared plain-text/regex matcher compiled by the Explorer host. */
  matchesFilter?: (...values: Array<unknown>) => boolean;
  /** Matches already-loaded descendants without triggering metadata work. */
  databaseMatchesFilter?: (
    database: string,
    normalizedFilter: string,
  ) => boolean;
  /** Loads metadata for a database that is not the connection's current database. */
  onLoadDatabase?: (database: string) => Promise<void>;
  /** Renders database-specific schemas and objects after that database is available. */
  renderDatabaseChildren?: (database: string) => ReactNode;
  /** Adds database-scoped actions without coupling this tree to their policy. */
  renderDatabaseContextMenu?: (
    database: string,
    isCurrent: boolean,
  ) => ReactNode;
}

/**
 * Resolve the configured server catalog using the same URL precedence as the
 * connection form. The component retains its historical PostgreSQL filename,
 * but external JDBC catalog providers use the same Explorer tree and must not
 * lose their current database context.
 */
export function connectionCatalogDatabaseName(connection: {
  driver?: DatabaseDriver;
  database?: string;
  connectionUrl?: string;
  url?: string;
}) {
  const driver = connection.driver || "postgres";
  // File-backed engines discover attached catalogs at runtime. Their
  // connection `database` is a file path, not a catalog name.
  if (isFileBasedDatabaseDriver(driver)) return "";
  // The connection store gives an explicit connection URL precedence over
  // individual form fields, so the Explorer must resolve the database in the
  // same order or schemas can appear under the wrong node.
  const explicitUrl = parseConnectionUrl(
    connection.connectionUrl || "",
    driver,
  );
  if (explicitUrl?.database) {
    try {
      return decodeURIComponent(explicitUrl.database);
    } catch {
      return explicitUrl.database;
    }
  }

  if (connection.database) return connection.database;

  const legacyUrl = parseConnectionUrl(connection.url || "", driver);
  if (legacyUrl?.database) {
    try {
      return decodeURIComponent(legacyUrl.database);
    } catch {
      return legacyUrl.database;
    }
  }

  return defaultDatabaseName(driver) || "";
}

/** Backward-compatible name used by PostgreSQL-specific callers and tests. */
export function postgresConnectionDatabaseName(connection: {
  database?: string;
  connectionUrl?: string;
  url?: string;
}) {
  return connectionCatalogDatabaseName({ ...connection, driver: "postgres" });
}

function databaseRows(databases: string[], currentDatabase: string) {
  return [
    currentDatabase,
    ...databases.filter((database) => database !== currentDatabase),
  ].filter(
    (database, index, rows) =>
      Boolean(database) && rows.indexOf(database) === index,
  );
}

function uniqueDatabaseRows(databases: string[]) {
  return databases.filter(
    (database, index, rows) =>
      Boolean(database) && rows.indexOf(database) === index,
  );
}

function loadErrorMessage(error: unknown, database: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return `Could not load database "${database}".`;
}

export function PostgresDatabaseTree({
  explorerScopeId,
  connectionId,
  enabled = true,
  databases,
  currentDatabase,
  status,
  error,
  schemaCount: _schemaCount,
  connectionColor,
  children,
  visibleDatabases,
  filterText = "",
  matchesFilter,
  databaseMatchesFilter,
  onLoadDatabase,
  renderDatabaseChildren,
  renderDatabaseContextMenu,
}: PostgresDatabaseTreeProps) {
  const databaseRevealRequest = useDatabaseNavigationStore(
    (state) => state.revealRequest,
  );
  const treeId = useId();
  const resolvedExplorerScopeId = explorerScopeId ?? `postgres-tree:${treeId}`;
  const mountedRef = useRef(true);
  const requestVersionsRef = useRef<Record<string, number>>({});
  const inFlightDatabasesRef = useRef<Set<string>>(new Set());
  const treeContextVersionRef = useRef(0);
  const [expandedDatabases, setExpandedDatabases] =
    useExplorerExpansionSetState(
      resolvedExplorerScopeId,
      "databases",
      connectionId,
    );
  const selectedNodeIds = useDatabaseExplorerStore(
    (state) =>
      state.scopes[resolvedExplorerScopeId]?.selectedNodeIds ??
      EMPTY_EXPLORER_NODE_IDS,
  );
  const selectionAnchorId = useDatabaseExplorerStore(
    (state) =>
      state.scopes[resolvedExplorerScopeId]?.selectionAnchorId ?? null,
  );
  const setSelection = useDatabaseExplorerStore((state) => state.setSelection);
  const selectNode = (
    nodeId: string,
    event?: {
      currentTarget: HTMLElement;
      ctrlKey: boolean;
      metaKey: boolean;
      shiftKey: boolean;
    },
  ) => {
    const result = resolveExplorerSelection({
      visibleNodeIds: event
        ? explorerTreeVisibleNodeIds(event.currentTarget)
        : [nodeId],
      selectedNodeIds,
      targetNodeId: nodeId,
      anchorNodeId: selectionAnchorId,
      additive: Boolean(event?.ctrlKey || event?.metaKey),
      range: Boolean(event?.shiftKey),
    });
    setSelection(
      resolvedExplorerScopeId,
      result.selectedNodeIds,
      result.focusedNodeId,
      result.anchorNodeId,
    );
  };
  const [loadStates, setLoadStates] = useState<
    Record<string, DatabaseLoadState>
  >({});

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    treeContextVersionRef.current += 1;
    setLoadStates({});
    requestVersionsRef.current = {};
    inFlightDatabasesRef.current.clear();
  }, [currentDatabase]);

  const rows =
    visibleDatabases === undefined
      ? databaseRows(databases, currentDatabase)
      : uniqueDatabaseRows(visibleDatabases);
  const normalizedFilter = filterText.trim().toLocaleLowerCase();
  const filteredRows = normalizedFilter
    ? rows.filter(
        (database) =>
          (matchesFilter
            ? matchesFilter(database)
            : database.toLocaleLowerCase().includes(normalizedFilter)) ||
          databaseMatchesFilter?.(database, normalizedFilter),
      )
    : rows;
  const isLoading = status === "idle" || status === "loading";

  const loadDatabase = useCallback(
    async (database: string) => {
      if (database === currentDatabase || !onLoadDatabase) return;
      if (inFlightDatabasesRef.current.has(database)) return;
      inFlightDatabasesRef.current.add(database);

      const requestVersion = (requestVersionsRef.current[database] || 0) + 1;
      const treeContextVersion = treeContextVersionRef.current;
      requestVersionsRef.current[database] = requestVersion;
      setLoadStates((states) => ({
        ...states,
        [database]: { status: "loading" },
      }));

      try {
        await onLoadDatabase(database);
        if (
          !mountedRef.current ||
          treeContextVersionRef.current !== treeContextVersion ||
          requestVersionsRef.current[database] !== requestVersion
        ) {
          return;
        }
        setLoadStates((states) => ({
          ...states,
          [database]: { status: "success" },
        }));
      } catch (loadError) {
        if (
          !mountedRef.current ||
          treeContextVersionRef.current !== treeContextVersion ||
          requestVersionsRef.current[database] !== requestVersion
        ) {
          return;
        }
        setLoadStates((states) => ({
          ...states,
          [database]: {
            status: "error",
            error: loadErrorMessage(loadError, database),
          },
        }));
      } finally {
        if (
          treeContextVersionRef.current === treeContextVersion &&
          requestVersionsRef.current[database] === requestVersion
        ) {
          inFlightDatabasesRef.current.delete(database);
        }
      }
    },
    [currentDatabase, onLoadDatabase],
  );

  const toggleDatabase = useCallback(
    (database: string) => {
      const willExpand = !expandedDatabases.has(database);
      setExpandedDatabases((expanded) => {
        const next = new Set(expanded);
        if (next.has(database)) next.delete(database);
        else next.add(database);
        return next;
      });

      if (
        willExpand &&
        database !== currentDatabase &&
        loadStates[database]?.status !== "success" &&
        loadStates[database]?.status !== "loading"
      ) {
        void loadDatabase(database);
      }
    },
    [currentDatabase, expandedDatabases, loadDatabase, loadStates],
  );

  useEffect(() => {
    const target = databaseRevealRequest?.target;
    if (
      !target ||
      target.connectionId !== connectionId ||
      !target.databaseName
    ) {
      return;
    }
    const database = target.databaseName;
    if (!rows.includes(database)) return;
    setExpandedDatabases((expanded) => {
      if (expanded.has(database)) return expanded;
      return new Set([...expanded, database]);
    });
    if (
      database !== currentDatabase &&
      loadStates[database]?.status !== "success" &&
      loadStates[database]?.status !== "loading"
    ) {
      void loadDatabase(database);
    }
  }, [databaseRevealRequest?.id, rows.join("\u0000")]);

  if (!enabled) return <>{children}</>;

  return (
    <ExplorerContextMenuHost>
      <div data-postgres-database-tree className="min-w-0">
      {filteredRows.map((database, index) => {
        const isCurrent = database === currentDatabase;
        const nodeId = explorerNodeId("database", connectionId, database);
        const isSelected = selectedNodeIds.includes(nodeId);
        const isExpanded = expandedDatabases.has(database);
        const loadState = loadStates[database] || { status: "idle" };
        const isDatabaseLoading = loadState.status === "loading";
        const childrenId = `${treeId}-database-${index}`;
        const canRenderChildren =
          isCurrent || !onLoadDatabase || loadState.status === "success";
        const databaseChildren =
          isExpanded && canRenderChildren
            ? renderDatabaseChildren?.(database)
            : undefined;
        const renderedChildren = isCurrent
          ? (databaseChildren ?? children)
          : databaseChildren;

        return (
          <div
            key={database}
            data-postgres-database={database}
            data-connected={isCurrent ? "true" : undefined}
            className="min-w-0"
          >
            <ExplorerSharedContextMenu nodeId={nodeId}>
              <ContextMenuTrigger asChild>
                <div
                  role="treeitem"
                  data-explorer-node-id={nodeId}
                  aria-expanded={isExpanded}
                  aria-selected={isSelected}
                  aria-controls={childrenId}
                  aria-busy={isDatabaseLoading || undefined}
                  tabIndex={
                    isSelected || (selectedNodeIds.length === 0 && isCurrent)
                      ? 0
                      : -1
                  }
                  onClick={(event) => selectNode(nodeId, event)}
                  onContextMenu={() => selectNode(nodeId)}
                  onDoubleClick={() => toggleDatabase(database)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      selectNode(nodeId);
                    } else if (event.key === " ") {
                      event.preventDefault();
                      toggleDatabase(database);
                    } else if (event.key === "ArrowRight" && !isExpanded) {
                      event.preventDefault();
                      toggleDatabase(database);
                    } else if (event.key === "ArrowLeft" && isExpanded) {
                      event.preventDefault();
                      toggleDatabase(database);
                    } else if (
                      event.key === "ArrowDown" ||
                      event.key === "ArrowUp"
                    ) {
                      event.preventDefault();
                      const nextId = moveExplorerTreeFocus(
                        event.currentTarget,
                        event.key === "ArrowDown" ? 1 : -1,
                      );
                      if (nextId) {
                        selectNode(nextId);
                      }
                    }
                  }}
                  className={`flex h-7 w-full min-w-0 items-center gap-1 rounded-[3px] px-1 text-left text-[11px] text-[hsl(var(--wb-text))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[hsl(var(--wb-accent))] ${isExpanded && !normalizedFilter ? "sticky top-0 z-[2] bg-[hsl(var(--wb-panel))]" : ""} ${isSelected ? "wb-tree-row-selected" : "hover:bg-[hsl(var(--wb-hover))]"}`}
                  title={
                    isCurrent
                      ? `Default database: ${database}`
                      : `${isExpanded ? "Collapse" : "Expand"} database: ${database}`
                  }
                >
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-expanded={isExpanded}
                    aria-label={`${isExpanded ? "Collapse" : "Expand"} database ${database}`}
                    className="inline-flex h-5 w-4 shrink-0 items-center justify-center rounded-[3px] wb-muted hover:bg-[hsl(var(--wb-hover-strong))] hover:text-[hsl(var(--wb-text))]"
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleDatabase(database);
                    }}
                    onDoubleClick={(event) => event.stopPropagation()}
                  >
                    {isExpanded ? (
                      <ChevronDown size={12} aria-hidden="true" />
                    ) : (
                      <ChevronRight size={12} aria-hidden="true" />
                    )}
                  </button>
                  <Database
                    size={12}
                    className={isCurrent ? "shrink-0" : "shrink-0 opacity-75"}
                    style={isCurrent ? { color: connectionColor } : undefined}
                    aria-hidden="true"
                  />
                  <span
                    className={isCurrent ? "truncate font-medium" : "truncate"}
                  >
                    {database}
                  </span>
                  {isCurrent && (
                    <span className="ml-auto shrink-0 rounded-[3px] border border-[hsl(var(--wb-accent)/0.28)] bg-[hsl(var(--wb-accent)/0.08)] px-1 text-[9px] font-normal leading-4 text-[hsl(var(--wb-text))]">
                      default
                    </span>
                  )}
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className={EXPLORER_MENU_CONTENT_CLASS}>
                {renderDatabaseContextMenu?.(database, isCurrent)}
              </ContextMenuContent>
            </ExplorerSharedContextMenu>

            {isExpanded && (
              <div
                id={childrenId}
                className="ml-[11px] border-l border-[hsl(var(--wb-border-subtle))] pl-2"
              >
                {isDatabaseLoading && (
                  <ExplorerTreeStateRow
                    state="loading"
                    ariaLabel={`Loading database ${database}`}
                  >
                    Loading schemas…
                  </ExplorerTreeStateRow>
                )}

                {loadState.status === "error" && (
                  <ExplorerTreeStateRow
                    state="error"
                    title={loadState.error}
                    ariaLabel={`Failed to load database ${database}`}
                    onRetry={() => void loadDatabase(database)}
                    retryAriaLabel={`Retry loading database ${database}`}
                  >
                    {loadState.error}
                  </ExplorerTreeStateRow>
                )}

                {canRenderChildren &&
                  loadState.status !== "error" &&
                  (renderedChildren ?? (
                    <ExplorerTreeStateRow state="empty">
                      No schemas available
                    </ExplorerTreeStateRow>
                  ))}
              </div>
            )}
          </div>
        );
      })}

      {status === "success" && filteredRows.length === 0 && (
        <ExplorerTreeStateRow state="empty">
          {filterText.trim()
            ? `No databases match “${filterText.trim()}”`
            : "No databases available"}
        </ExplorerTreeStateRow>
      )}

      {isLoading && (
        <ExplorerTreeStateRow
          state="loading"
          ariaLabel="Loading PostgreSQL databases"
        >
          Discovering databases…
        </ExplorerTreeStateRow>
      )}

      {status === "error" && (
        <ExplorerTreeStateRow
          state="error"
          title={error || "Database discovery failed"}
        >
          Database list unavailable
        </ExplorerTreeStateRow>
      )}
      </div>
    </ExplorerContextMenuHost>
  );
}
