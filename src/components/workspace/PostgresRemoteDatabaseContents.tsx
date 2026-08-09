import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Folder,
  GitCompareArrows,
  KeyRound,
  Network,
  RefreshCw,
  Table,
  TableProperties,
  Upload,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { isViewObject } from "@/lib/databaseDialect";
import { schemaService } from "@/services/tauri";
import type { SchemaObjectInfo, TableInfo } from "@/services/tauri/types";
import {
  databaseObjectNavigationKey,
  databaseSchemaNavigationKey,
  useDatabaseNavigationStore,
} from "@/lib/databaseNavigation";

type SchemaLoadStatus = "idle" | "loading" | "success" | "error";

interface SchemaLoadState {
  status: SchemaLoadStatus;
  tables: TableInfo[];
  objects: SchemaObjectInfo[];
  objectError: string | null;
  error: string | null;
}

interface PostgresRemoteDatabaseContentsProps {
  connectionId: string;
  database: string;
  schemas: string[];
  connectionColor: string;
  filterText?: string;
  onTablesLoaded?: (schema: string, tables: TableInfo[]) => void;
  onOpenSchemaSnapshots?: (database: string, schema: string) => void;
  onImportSqlScript?: (database: string, schema: string) => void;
  onOpenTable: (
    database: string,
    schema: string,
    table: TableInfo
  ) => void | Promise<void>;
}

function loadErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  return String(error || "Schema metadata could not be loaded");
}

export function PostgresRemoteDatabaseContents({
  connectionId,
  database,
  schemas,
  connectionColor,
  filterText = "",
  onTablesLoaded,
  onOpenSchemaSnapshots,
  onImportSqlScript,
  onOpenTable,
}: PostgresRemoteDatabaseContentsProps) {
  const databaseRevealRequest = useDatabaseNavigationStore(
    (state) => state.revealRequest
  );
  const clearDatabaseReveal = useDatabaseNavigationStore(
    (state) => state.clearReveal
  );
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(
    () => new Set()
  );
  const [schemaLoads, setSchemaLoads] = useState<Record<string, SchemaLoadState>>(
    {}
  );
  const mountedRef = useRef(true);
  const requestVersionsRef = useRef<Record<string, number>>({});
  const inFlightSchemasRef = useRef<Set<string>>(new Set());
  const contextVersionRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    contextVersionRef.current += 1;
    setExpandedSchemas(new Set());
    setSchemaLoads({});
    requestVersionsRef.current = {};
    inFlightSchemasRef.current.clear();
  }, [connectionId, database]);

  const loadTables = async (schema: string) => {
    if (inFlightSchemasRef.current.has(schema)) return;
    inFlightSchemasRef.current.add(schema);
    const requestVersion = (requestVersionsRef.current[schema] || 0) + 1;
    const contextVersion = contextVersionRef.current;
    requestVersionsRef.current[schema] = requestVersion;
    setSchemaLoads((current) => ({
      ...current,
      [schema]: {
        status: "loading",
        tables: current[schema]?.tables || [],
        objects: current[schema]?.objects || [],
        objectError: null,
        error: null,
      },
    }));

    try {
      const schemaObjectRequest =
        typeof schemaService.getDatabaseSchemaObjects === "function"
          ? schemaService
              .getDatabaseSchemaObjects(connectionId, database, schema)
              .then((objects) => ({ objects, error: null }))
              .catch(() => ({
                objects: [] as SchemaObjectInfo[],
                error: "Schema object metadata is unavailable for this server role",
              }))
          : Promise.resolve({
              objects: [] as SchemaObjectInfo[],
              error: "Schema object metadata is unavailable in this application build",
            });
      const [tables, objectResult] = await Promise.all([
        schemaService.getDatabaseTables(connectionId, database, schema),
        schemaObjectRequest,
      ]);
      if (
        !mountedRef.current ||
        contextVersionRef.current !== contextVersion ||
        requestVersionsRef.current[schema] !== requestVersion
      ) {
        return;
      }
      setSchemaLoads((current) => ({
        ...current,
        [schema]: {
          status: "success",
          tables,
          objects: objectResult.objects,
          objectError: objectResult.error,
          error: null,
        },
      }));
      onTablesLoaded?.(schema, tables);
    } catch (error) {
      if (
        !mountedRef.current ||
        contextVersionRef.current !== contextVersion ||
        requestVersionsRef.current[schema] !== requestVersion
      ) {
        return;
      }
      setSchemaLoads((current) => ({
        ...current,
        [schema]: {
          status: "error",
          tables: current[schema]?.tables || [],
          objects: current[schema]?.objects || [],
          objectError: current[schema]?.objectError || null,
          error: loadErrorMessage(error),
        },
      }));
    } finally {
      if (
        contextVersionRef.current === contextVersion &&
        requestVersionsRef.current[schema] === requestVersion
      ) {
        inFlightSchemasRef.current.delete(schema);
      }
    }
  };

  const toggleSchema = (schema: string) => {
    const willExpand = !expandedSchemas.has(schema);
    setExpandedSchemas((current) => {
      const next = new Set(current);
      if (next.has(schema)) next.delete(schema);
      else next.add(schema);
      return next;
    });

    const loadState = schemaLoads[schema];
    if (
      willExpand &&
      loadState?.status !== "loading" &&
      loadState?.status !== "success"
    ) {
      void loadTables(schema);
    }
  };

  useEffect(() => {
    const target = databaseRevealRequest?.target;
    if (
      !target ||
      target.connectionId !== connectionId ||
      target.databaseName !== database ||
      !schemas.includes(target.schemaName)
    ) {
      return;
    }
    setExpandedSchemas((current) =>
      current.has(target.schemaName)
        ? current
        : new Set([...current, target.schemaName])
    );
    const loadState = schemaLoads[target.schemaName];
    if (
      target.objectName &&
      loadState?.status !== "loading" &&
      loadState?.status !== "success"
    ) {
      void loadTables(target.schemaName);
    }
  }, [databaseRevealRequest?.id, schemas]);

  useEffect(() => {
    if (!databaseRevealRequest) return;
    const { id: requestId, target } = databaseRevealRequest;
    if (
      target.connectionId !== connectionId ||
      target.databaseName !== database ||
      (target.objectName &&
        schemaLoads[target.schemaName]?.status !== "success")
    ) {
      return;
    }
    window.requestAnimationFrame(() => {
      const key = target.objectName
        ? databaseObjectNavigationKey({ ...target, objectName: target.objectName })
        : databaseSchemaNavigationKey(target);
      const element = document.querySelector<HTMLElement>(
        target.objectName
          ? `[data-database-object-key="${key}"]`
          : `[data-database-schema-key="${key}"]`,
      );
      element?.scrollIntoView({ block: "nearest" });
      element?.focus();
      clearDatabaseReveal(requestId);
    });
  }, [
    clearDatabaseReveal,
    connectionId,
    database,
    databaseRevealRequest,
    schemaLoads,
  ]);

  const normalizedFilter = filterText.trim().toLocaleLowerCase();
  const visibleSchemas = normalizedFilter
    ? schemas.filter(
        (schema) =>
          schema.toLocaleLowerCase().includes(normalizedFilter) ||
          schemaLoads[schema]?.tables.some((table) =>
            table.name.toLocaleLowerCase().includes(normalizedFilter)
          )
      )
    : schemas;

  if (schemas.length === 0) {
    return (
      <div className="min-h-6 px-1.5 py-1 text-[10px] wb-muted">
        No schemas found
      </div>
    );
  }

  if (visibleSchemas.length === 0) {
    return (
      <div className="min-h-6 px-1.5 py-1 text-[10px] wb-muted">
        No schemas match “{filterText.trim()}”
      </div>
    );
  }

  return (
    <div data-postgres-remote-database={database} className="min-w-0">
      {visibleSchemas.map((schema) => {
        const isExpanded = expandedSchemas.has(schema);
        const loadState = schemaLoads[schema] || {
          status: "idle" as const,
          tables: [],
          objects: [],
          objectError: null,
          error: null,
        };
        const schemaMatchesFilter = schema
          .toLocaleLowerCase()
          .includes(normalizedFilter);
        const visibleTables = normalizedFilter && !schemaMatchesFilter
          ? loadState.tables.filter((table) =>
              table.name.toLocaleLowerCase().includes(normalizedFilter)
            )
          : loadState.tables;
        const visibleObjects = normalizedFilter && !schemaMatchesFilter
          ? loadState.objects.filter((object) =>
              `${object.name} ${object.objectType} ${object.parentName || ""}`
                .toLocaleLowerCase()
                .includes(normalizedFilter)
            )
          : loadState.objects;

        return (
          <div key={schema} className="min-w-0">
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  aria-busy={loadState.status === "loading" || undefined}
                  data-database-schema-key={databaseSchemaNavigationKey({
                    connectionId,
                    databaseName: database,
                    schemaName: schema,
                  })}
                  onClick={() => toggleSchema(schema)}
                  className="flex h-6 w-full min-w-0 items-center gap-1 rounded-[3px] px-1.5 text-left text-[11px] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[hsl(var(--wb-accent))]"
                  title={`${isExpanded ? "Collapse" : "Expand"} ${database}.${schema}`}
                >
                  {isExpanded ? (
                    <ChevronDown size={12} className="shrink-0 wb-muted" />
                  ) : (
                    <ChevronRight size={12} className="shrink-0 wb-muted" />
                  )}
                  <Network
                    size={12}
                    className="shrink-0"
                    style={{ color: connectionColor }}
                  />
                  <span className="truncate">{schema}</span>
                </button>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-56 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-text))] shadow-[0_8px_20px_rgba(0,0,0,0.35)]">
                <ContextMenuItem
                  className="text-[12px] focus:bg-[hsl(var(--wb-hover))] focus:text-[hsl(var(--wb-text))]"
                  disabled={!onOpenSchemaSnapshots}
                  onClick={() => onOpenSchemaSnapshots?.(database, schema)}
                >
                  <GitCompareArrows className="mr-2 h-3.5 w-3.5" />
                  Schema Snapshots / Diff...
                </ContextMenuItem>
                <ContextMenuSeparator className="bg-[hsl(var(--wb-border-subtle))]" />
                <ContextMenuItem
                  className="text-[12px] focus:bg-[hsl(var(--wb-hover))] focus:text-[hsl(var(--wb-text))]"
                  disabled={!onImportSqlScript}
                  onClick={() => onImportSqlScript?.(database, schema)}
                >
                  <Upload className="mr-2 h-3.5 w-3.5" />
                  Import SQL Script...
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>

            {isExpanded && (
              <div className="ml-[11px] border-l border-[hsl(var(--wb-border-subtle))] pl-2">
                <div className="flex h-5 min-w-0 items-center gap-1 px-1.5 text-[10px] font-medium wb-muted">
                  <Folder size={11} className="shrink-0" />
                  <span className="truncate">tables</span>
                  {loadState.status === "success" && (
                    <span className="ml-auto text-[9px] tabular-nums">
                      {visibleTables.length}
                    </span>
                  )}
                </div>

                {loadState.status === "loading" && (
                  <div
                    role="status"
                    className="flex h-6 items-center gap-1.5 px-1.5 text-[10px] wb-muted"
                  >
                    <RefreshCw size={10} className="animate-spin" />
                    Loading tables…
                  </div>
                )}

                {loadState.status === "error" && (
                  <div
                    role="alert"
                    className="flex min-h-6 min-w-0 items-center gap-1 px-1.5 py-0.5 text-[10px] text-destructive"
                  >
                    <AlertCircle size={11} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate" title={loadState.error || undefined}>
                      {loadState.error}
                    </span>
                    <button
                      type="button"
                      onClick={() => void loadTables(schema)}
                      className="h-5 shrink-0 rounded-[3px] px-1 font-medium hover:bg-[hsl(var(--wb-hover))]"
                    >
                      Retry
                    </button>
                  </div>
                )}

                {loadState.status === "success" && visibleTables.length === 0 && (
                  <div className="min-h-6 px-1.5 py-1 text-[10px] wb-muted">
                    {normalizedFilter ? "No matching tables" : "No tables found"}
                  </div>
                )}

                {loadState.status === "success" &&
                  visibleTables.map((table) => {
                    const isView = isViewObject(table.type);
                    const ObjectIcon = isView ? TableProperties : Table;
                    return (
                      <ContextMenu key={table.name}>
                        <ContextMenuTrigger asChild>
                          <button
                            type="button"
                            data-database-object-key={databaseObjectNavigationKey(
                              {
                                connectionId,
                                databaseName: database,
                                schemaName: schema,
                                objectName: table.name,
                              },
                            )}
                            data-postgres-remote-table={`${database}.${schema}.${table.name}`}
                            onClick={() =>
                              void onOpenTable(database, schema, table)
                            }
                            className={cn(
                              "flex h-6 w-full min-w-0 cursor-pointer items-center gap-2 rounded-[3px] px-2 text-left text-[11px]",
                              "text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]",
                              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[hsl(var(--wb-accent))]",
                            )}
                            title={`Open ${database}.${schema}.${table.name} data (read-only)`}
                          >
                            <ObjectIcon
                              size={12}
                              className="shrink-0 opacity-75"
                            />
                            <span className="truncate">{table.name}</span>
                          </button>
                        </ContextMenuTrigger>
                        <ContextMenuContent className="w-56 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-text))] shadow-[0_8px_20px_rgba(0,0,0,0.35)]">
                          <ContextMenuItem
                            className="text-[12px] focus:bg-[hsl(var(--wb-hover))] focus:text-[hsl(var(--wb-text))]"
                            disabled={!onImportSqlScript}
                            onClick={() =>
                              onImportSqlScript?.(database, schema)
                            }
                          >
                            <Upload className="mr-2 h-3.5 w-3.5" />
                            Import SQL Script...
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                    );
                  })}
                {loadState.status === "success" && visibleObjects.length > 0 && (
                  <>
                    <div className="mt-1 flex h-5 min-w-0 items-center gap-1 px-1.5 text-[10px] font-medium wb-muted">
                      <Folder size={11} className="shrink-0" />
                      <span className="truncate">schema objects</span>
                      <span className="ml-auto text-[9px] tabular-nums">{visibleObjects.length}</span>
                    </div>
                    {visibleObjects.map((object) => (
                      <div
                        key={`${object.objectType}:${object.name}:${object.parentName || ""}`}
                        className="flex min-w-0 items-center gap-2 px-2 py-1 text-[11px] text-[hsl(var(--wb-text-muted))]"
                        title={[object.objectType, object.parentName, object.comment].filter(Boolean).join(" · ")}
                      >
                        {object.objectType === "sequence" ? <KeyRound size={12} className="shrink-0 opacity-75" /> : <Folder size={12} className="shrink-0 opacity-75" />}
                        <span className="truncate">
                          {object.name}
                          {object.parentName ? ` · ${object.parentName}` : ""}
                        </span>
                        <span className="ml-auto shrink-0 text-[9px] wb-muted">{object.objectType}</span>
                      </div>
                    ))}
                  </>
                )}
                {loadState.status === "success" && loadState.objectError && (
                  <div className="px-1.5 py-1 text-[10px] wb-muted">
                    {loadState.objectError}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
