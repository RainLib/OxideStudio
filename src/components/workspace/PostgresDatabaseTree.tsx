import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Database,
  Network,
  RefreshCw,
} from "lucide-react";
import { defaultDatabaseName } from "@/lib/databaseDialect";
import { parseConnectionUrl } from "@/lib/connectionUrlParser";
import { useDatabaseNavigationStore } from "@/lib/databaseNavigation";

export type PostgresDatabaseDiscoveryStatus =
  | "idle"
  | "loading"
  | "success"
  | "error";

type DatabaseLoadStatus = "idle" | "loading" | "success" | "error";

interface DatabaseLoadState {
  status: DatabaseLoadStatus;
  error?: string;
}

export interface PostgresDatabaseTreeProps {
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
  /** Matches already-loaded descendants without triggering metadata work. */
  databaseMatchesFilter?: (database: string, normalizedFilter: string) => boolean;
  /** Loads metadata for a database that is not the connection's current database. */
  onLoadDatabase?: (database: string) => Promise<void>;
  /** Renders database-specific schemas and objects after that database is available. */
  renderDatabaseChildren?: (database: string) => ReactNode;
}

export function postgresConnectionDatabaseName(connection: {
  database?: string;
  connectionUrl?: string;
  url?: string;
}) {
  // The connection store gives an explicit connection URL precedence over
  // individual form fields, so the Explorer must resolve the database in the
  // same order or schemas can appear under the wrong node.
  const explicitUrl = parseConnectionUrl(connection.connectionUrl || "");
  if (explicitUrl?.driver === "postgres" && explicitUrl.database) {
    try {
      return decodeURIComponent(explicitUrl.database);
    } catch {
      return explicitUrl.database;
    }
  }

  if (connection.database) return connection.database;

  const legacyUrl = parseConnectionUrl(connection.url || "");
  if (legacyUrl?.driver === "postgres" && legacyUrl.database) {
    try {
      return decodeURIComponent(legacyUrl.database);
    } catch {
      return legacyUrl.database;
    }
  }

  return defaultDatabaseName("postgres") || "postgres";
}

function databaseRows(databases: string[], currentDatabase: string) {
  return [
    currentDatabase,
    ...databases.filter((database) => database !== currentDatabase),
  ].filter(
    (database, index, rows) =>
      Boolean(database) && rows.indexOf(database) === index
  );
}

function uniqueDatabaseRows(databases: string[]) {
  return databases.filter(
    (database, index, rows) =>
      Boolean(database) && rows.indexOf(database) === index
  );
}

function loadErrorMessage(error: unknown, database: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return `Could not load database "${database}".`;
}

export function PostgresDatabaseTree({
  connectionId,
  enabled = true,
  databases,
  currentDatabase,
  status,
  error,
  schemaCount,
  connectionColor,
  children,
  visibleDatabases,
  filterText = "",
  databaseMatchesFilter,
  onLoadDatabase,
  renderDatabaseChildren,
}: PostgresDatabaseTreeProps) {
  const databaseRevealRequest = useDatabaseNavigationStore(
    (state) => state.revealRequest
  );
  const treeId = useId();
  const mountedRef = useRef(true);
  const requestVersionsRef = useRef<Record<string, number>>({});
  const inFlightDatabasesRef = useRef<Set<string>>(new Set());
  const treeContextVersionRef = useRef(0);
  const [expandedDatabases, setExpandedDatabases] = useState<Set<string>>(
    () => new Set()
  );
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
    setExpandedDatabases(new Set());
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
    ? rows.filter((database) =>
        database.toLocaleLowerCase().includes(normalizedFilter) ||
        databaseMatchesFilter?.(database, normalizedFilter)
      )
    : rows;
  const isLoading = status === "idle" || status === "loading";

  const loadDatabase = useCallback(
    async (database: string) => {
      if (database === currentDatabase || !onLoadDatabase) return;
      if (inFlightDatabasesRef.current.has(database)) return;
      inFlightDatabasesRef.current.add(database);

      const requestVersion =
        (requestVersionsRef.current[database] || 0) + 1;
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
    [currentDatabase, onLoadDatabase]
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
    [currentDatabase, expandedDatabases, loadDatabase, loadStates]
  );

  useEffect(() => {
    const target = databaseRevealRequest?.target;
    if (!target || target.connectionId !== connectionId || !target.databaseName) {
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
    <div data-postgres-database-tree className="min-w-0">
      <div className="flex h-5 min-w-0 items-center gap-1 px-1.5 text-[10px] font-medium text-[hsl(var(--wb-text-muted))]">
        <ChevronDown size={11} className="shrink-0" aria-hidden="true" />
        <Database
          size={11}
          className="shrink-0"
          style={{ color: connectionColor }}
          aria-hidden="true"
        />
        <span className="truncate">Databases</span>
        {status === "success" && (
          <span className="ml-auto text-[9px] tabular-nums wb-muted">
            {filteredRows.length}
          </span>
        )}
      </div>

      <div className="ml-[11px] border-l border-[hsl(var(--wb-border-subtle))] pl-2">
        {filteredRows.map((database, index) => {
          const isCurrent = database === currentDatabase;
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
            ? databaseChildren ?? children
            : databaseChildren;

          return (
            <div
              key={database}
              data-postgres-database={database}
              data-connected={isCurrent ? "true" : undefined}
              className="min-w-0"
            >
              <button
                type="button"
                aria-expanded={isExpanded}
                aria-controls={childrenId}
                aria-busy={isDatabaseLoading || undefined}
                onClick={() => toggleDatabase(database)}
                className="flex h-6 w-full min-w-0 items-center gap-1 rounded-[3px] px-1.5 text-left text-[11px] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[hsl(var(--wb-accent))]"
                title={
                  isCurrent
                    ? `Default database: ${database}`
                    : `${isExpanded ? "Collapse" : "Expand"} database: ${database}`
                }
              >
                {isExpanded ? (
                  <ChevronDown
                    size={12}
                    className="shrink-0 wb-muted"
                    aria-hidden="true"
                  />
                ) : (
                  <ChevronRight
                    size={12}
                    className="shrink-0 wb-muted"
                    aria-hidden="true"
                  />
                )}
                <Database
                  size={12}
                  className={isCurrent ? "shrink-0" : "shrink-0 opacity-75"}
                  style={isCurrent ? { color: connectionColor } : undefined}
                  aria-hidden="true"
                />
                <span className={isCurrent ? "truncate font-medium" : "truncate"}>
                  {database}
                </span>
                {isCurrent && (
                  <span className="ml-auto shrink-0 rounded-[3px] border border-[hsl(var(--wb-accent)/0.28)] bg-[hsl(var(--wb-accent)/0.08)] px-1 text-[9px] font-normal leading-4 text-[hsl(var(--wb-text))]">
                    default
                  </span>
                )}
              </button>

              {isExpanded && (
                <div
                  id={childrenId}
                  className="ml-[11px] border-l border-[hsl(var(--wb-border-subtle))] pl-2"
                >
                  {isDatabaseLoading && (
                    <div
                      role="status"
                      aria-label={`Loading database ${database}`}
                      className="flex h-6 items-center gap-1.5 px-1.5 text-[10px] wb-muted"
                    >
                      <RefreshCw
                        size={10}
                        className="shrink-0 motion-safe:animate-spin"
                        aria-hidden="true"
                      />
                      <span className="truncate">Loading schemas…</span>
                    </div>
                  )}

                  {loadState.status === "error" && (
                    <div
                      role="alert"
                      className="flex min-h-6 min-w-0 items-center gap-1 px-1.5 py-0.5 text-[10px] text-destructive"
                    >
                      <AlertCircle
                        size={11}
                        className="shrink-0"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate" title={loadState.error}>
                        {loadState.error}
                      </span>
                      <button
                        type="button"
                        onClick={() => void loadDatabase(database)}
                        className="inline-flex h-5 shrink-0 items-center gap-1 rounded-[3px] px-1 text-[10px] font-medium hover:bg-[hsl(var(--wb-hover))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))]"
                        aria-label={`Retry loading database ${database}`}
                      >
                        <RefreshCw size={10} aria-hidden="true" />
                        Retry
                      </button>
                    </div>
                  )}

                  {canRenderChildren && loadState.status !== "error" && (
                    <>
                      <div className="flex h-5 min-w-0 items-center gap-1 px-1.5 text-[10px] font-medium text-[hsl(var(--wb-text-muted))]">
                        <Network
                          size={11}
                          className="shrink-0"
                          style={{ color: connectionColor }}
                          aria-hidden="true"
                        />
                        <span className="truncate">Schemas</span>
                        {isCurrent && (
                          <span className="ml-auto text-[9px] tabular-nums wb-muted">
                            {schemaCount}
                          </span>
                        )}
                      </div>
                      {renderedChildren ?? (
                        <div className="min-h-5 px-1.5 py-0.5 text-[10px] wb-muted">
                          No schemas available
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {status === "success" && filteredRows.length === 0 && (
          <div
            role="status"
            className="min-h-6 px-1.5 py-1 text-[10px] wb-muted"
          >
            {filterText.trim()
              ? `No databases match “${filterText.trim()}”`
              : "No databases available"}
          </div>
        )}

        {isLoading && (
          <div
            role="status"
            aria-label="Loading PostgreSQL databases"
            className="flex h-6 items-center gap-1.5 px-1.5 text-[10px] wb-muted"
          >
            <RefreshCw
              size={10}
              className="shrink-0 motion-safe:animate-spin"
              aria-hidden="true"
            />
            <span className="truncate">Discovering databases…</span>
          </div>
        )}

        {status === "error" && (
          <div
            role="status"
            title={error || "Database discovery failed"}
            className="flex min-h-5 items-center gap-1.5 px-1.5 py-0.5 text-[10px] text-destructive"
          >
            <AlertCircle size={11} className="shrink-0" aria-hidden="true" />
            <span className="truncate">Database list unavailable</span>
          </div>
        )}
      </div>
    </div>
  );
}
