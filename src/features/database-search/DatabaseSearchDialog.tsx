import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  DATABASE_SEARCH_MAX_ERRORS,
  DATABASE_SEARCH_MAX_RESULTS,
  DATABASE_SEARCH_MAX_RESULT_BYTES,
  DATABASE_SEARCH_MAX_TABLES,
  databaseSearchBatchRange,
  databaseSearchColumn,
  databaseSearchNextBatchSize,
  databaseSearchResultByteSize,
  databaseSearchRowPreview,
  eligibleDatabaseSearchTables,
  findMatchedSearchColumns,
  mapDatabaseSearchWithConcurrency,
} from "@/features/database-search";
import { isSystemNamespace } from "@/lib/databaseDialect";
import type { DatabaseSearchRequest } from "@/lib/actionEvents";
import {
  databaseSearchService,
  databaseService,
  queryService,
  schemaService,
} from "@/services/tauri";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTabStore } from "@/store/useTabStore";
import {
  AlertTriangle,
  ArrowUpRight,
  Database,
  LoaderCircle,
  Search,
  Square,
  Table2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

type SearchScope = {
  connectionId: string;
  connectionName: string;
  driver: string;
  database?: string;
  schema?: string;
  table?: string;
};

type SearchTask = {
  schema: string;
  table: string;
  tableType?: string;
};

type SearchPlan = {
  scope: SearchScope;
  term: string;
  limit: number;
  tasks: SearchTask[];
  nextIndex: number;
  metadataTruncated: boolean;
  databaseScopedMetadata: boolean;
};

type SearchHit = {
  id: string;
  schema: string;
  table: string;
  tableType?: string;
  matchedColumns: string[];
  preview: string;
  whereInput: string;
};

type SearchFailure = {
  schema: string;
  table: string;
  message: string;
};

type DatabaseSearchDialogProps = {
  request: DatabaseSearchRequest;
  requestVersion: number;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function relationLabel(schema: string, table: string) {
  return schema ? `${schema}.${table}` : table;
}

function boundedError(error: unknown) {
  const message = errorMessage(error).replace(/\s+/gu, " ").trim();
  return message.length > 240 ? `${message.slice(0, 240)}…` : message;
}

export function DatabaseSearchDialog({
  request,
  requestVersion,
}: DatabaseSearchDialogProps) {
  const setActiveConnection = useConnectionStore(
    (state) => state.setActiveConnection,
  );
  const [open, setOpen] = useState(true);
  const [scope, setScope] = useState<SearchScope | null>(null);
  const [term, setTerm] = useState("");
  const [limit, setLimit] = useState(20);
  const [plan, setPlan] = useState<SearchPlan | null>(null);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [failures, setFailures] = useState<SearchFailure[]>([]);
  const [totalFailures, setTotalFailures] = useState(0);
  const [scannedTables, setScannedTables] = useState(0);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [resultsTruncated, setResultsTruncated] = useState(false);
  const [visibleResultCount, setVisibleResultCount] = useState(200);
  const runIdRef = useRef(0);
  const currentQueryIdRef = useRef<string | null>(null);

  const stopSearch = useCallback(() => {
    runIdRef.current += 1;
    const queryId = currentQueryIdRef.current;
    currentQueryIdRef.current = null;
    if (queryId) void queryService.cancelQuery(queryId).catch(() => undefined);
    setIsPlanning(false);
    setIsScanning(false);
    setStatusMessage("Search stopped. Completed results are preserved.");
  }, []);

  useEffect(() => {
    stopSearch();
    const connectionState = useConnectionStore.getState();
    const schemaState = useSchemaStore.getState();
    const connectionId = request.connectionId || connectionState.activeConnectionId;
    const connection = connectionState.connections.find(
      (item) => item.id === connectionId,
    );
    setOpen(true);
    setPlan(null);
    setHits([]);
    setFailures([]);
    setTotalFailures(0);
    setScannedTables(0);
    setStatusMessage(null);
    setResultsTruncated(false);
    setVisibleResultCount(200);
    if (!connection) {
      setScope(null);
      setStatusMessage("Connect a SQL data source before searching its rows.");
      return;
    }
    const explicitSchema = request.schema?.trim() || undefined;
    setScope({
      connectionId: connection.id,
      connectionName: connection.name,
      driver: connection.driver,
      database: request.database?.trim() || connection.database?.trim() || undefined,
      schema:
        explicitSchema ||
        (request.table
          ? schemaState.currentSchema?.trim() || undefined
          : undefined),
      table: request.table?.trim() || undefined,
    });
  }, [
    request,
    requestVersion,
    stopSearch,
  ]);

  useEffect(() => () => stopSearch(), [stopSearch]);

  const closeDialog = useCallback(() => {
    stopSearch();
    setOpen(false);
  }, [stopSearch]);

  const enumerateTasks = useCallback(async (target: SearchScope) => {
    const capabilityContext =
      await databaseService.getConnectionDatabaseCapabilityContext(
        target.connectionId,
      );
    const capabilities = capabilityContext.capabilities;
    if (!capabilities.supportsSqlQuery || !capabilities.supportsTableBrowsing) {
      throw new Error(
        `${capabilities.displayName} does not expose SQL row search capabilities.`,
      );
    }

    let schemas: string[];
    if (target.schema) {
      schemas = [target.schema];
    } else if (target.database && capabilities.supportsDatabaseCatalogs) {
      schemas = await schemaService.getDatabaseSchemas(
        target.connectionId,
        target.database,
      );
    } else {
      schemas = await schemaService.getSchemas(target.connectionId);
    }
    schemas = [...new Set(schemas.map((value) => value.trim()).filter(Boolean))]
      .filter((value) => !isSystemNamespace(target.driver, value))
      .sort((left, right) => left.localeCompare(right));

    if (target.table) {
      const tableSchema = target.schema || schemas[0];
      if (!tableSchema) throw new Error("The table search target has no schema.");
      return {
        tasks: [
          { schema: tableSchema, table: target.table, tableType: "TABLE" },
        ],
        metadataTruncated: false,
        databaseScopedMetadata: Boolean(
          target.database && capabilities.supportsDatabaseCatalogs,
        ),
        failures: [] as SearchFailure[],
      };
    }

    const tablesBySchema = await mapDatabaseSearchWithConcurrency(
      schemas,
      6,
      async (schema) => {
        try {
          return {
            schema,
            tables: target.database && capabilities.supportsDatabaseCatalogs
              ? await schemaService.getDatabaseTables(
                  target.connectionId,
                  target.database,
                  schema,
                )
              : await schemaService.getTables(target.connectionId, schema),
            error: null,
          };
        } catch (error) {
          return { schema, tables: [], error: boundedError(error) };
        }
      },
    );
    const candidates = tablesBySchema.flatMap(({ schema, tables }) =>
      tables.map((table) => ({
        name: `${schema}\0${table.name}`,
        type: table.type,
        schema,
        table: table.name,
      })),
    );
    const eligible = eligibleDatabaseSearchTables(
      candidates,
      DATABASE_SEARCH_MAX_TABLES,
    );
    return {
      tasks: eligible.tables.map((table) => ({
        schema: table.schema,
        table: table.table,
        tableType: table.type,
      })),
      metadataTruncated: eligible.truncated,
      databaseScopedMetadata: Boolean(
        target.database && capabilities.supportsDatabaseCatalogs,
      ),
      failures: tablesBySchema
        .filter((item) => item.error)
        .map((item) => ({
          schema: item.schema,
          table: "metadata",
          message: item.error!,
        })),
    };
  }, []);

  const runPlanBatch = useCallback(
    async (
      nextPlan: SearchPlan,
      scanAllRemaining: boolean,
      resetBudgets = false,
      initialErrorCount = 0,
    ) => {
      const runId = runIdRef.current + 1;
      runIdRef.current = runId;
      const range = databaseSearchBatchRange(
        nextPlan.nextIndex,
        nextPlan.tasks.length,
        scanAllRemaining,
      );
      let storedResults = resetBudgets ? 0 : hits.length;
      let storedBytes = (resetBudgets ? [] : hits).reduce(
        (total, hit) =>
          total +
          databaseSearchResultByteSize(
            relationLabel(hit.schema, hit.table),
            hit.preview,
            hit.whereInput,
          ),
        0,
      );
      let errorCount = resetBudgets ? initialErrorCount : totalFailures;
      setIsScanning(true);
      setStatusMessage(
        `Scanning tables ${range.start + 1}–${range.end} of ${nextPlan.tasks.length}…`,
      );

      for (let index = range.start; index < range.end; index += 1) {
        if (runIdRef.current !== runId) return;
        const task = nextPlan.tasks[index]!;
        const queryId = `database-search:${crypto.randomUUID()}`;
        currentQueryIdRef.current = queryId;
        try {
          const columns =
            nextPlan.databaseScopedMetadata && nextPlan.scope.database
            ? await schemaService.getDatabaseColumns(
                nextPlan.scope.connectionId,
                nextPlan.scope.database,
                task.schema,
                task.table,
              )
            : await schemaService.getColumns(
                nextPlan.scope.connectionId,
                task.schema,
                task.table,
              );
          if (runIdRef.current !== runId) return;
          const execution = await databaseSearchService.executeDatabaseSearch(
            nextPlan.scope.connectionId,
            {
              schema: task.schema,
              tableName: task.table,
              columns: columns.map(databaseSearchColumn),
              term: nextPlan.term,
              limit: nextPlan.limit,
            },
            queryId,
            nextPlan.scope.database,
          );
          if (runIdRef.current !== runId) return;
          const result = execution.results.find(
            (candidate) => candidate.rows.length > 0,
          );
          if (result) {
            const resultColumns = result.columns.map((column) => column.name);
            const matchedColumnsByRow = result.rows.map((row) =>
              findMatchedSearchColumns(
                resultColumns,
                row,
                columns,
                nextPlan.term,
              ).filter((name) => execution.searchableColumns.includes(name)),
            );
            const whereInputs =
              await databaseSearchService.buildSearchResultWheres(
                nextPlan.scope.connectionId,
                {
                  columns: columns.map(databaseSearchColumn),
                  resultColumns,
                  rows: result.rows,
                  matchedColumns: matchedColumnsByRow,
                },
              );
            if (runIdRef.current !== runId) return;
            const additions: SearchHit[] = [];
            for (let rowIndex = 0; rowIndex < result.rows.length; rowIndex += 1) {
              const row = result.rows[rowIndex]!;
              const matchedColumns = matchedColumnsByRow[rowIndex]!;
              const preview = databaseSearchRowPreview(
                resultColumns,
                row,
                matchedColumns,
              );
              const whereInput = whereInputs[rowIndex] || "";
              const byteSize = databaseSearchResultByteSize(
                relationLabel(task.schema, task.table),
                preview,
                whereInput,
              );
              if (
                storedResults >= DATABASE_SEARCH_MAX_RESULTS ||
                storedBytes + byteSize > DATABASE_SEARCH_MAX_RESULT_BYTES
              ) {
                setResultsTruncated(true);
                continue;
              }
              storedResults += 1;
              storedBytes += byteSize;
              additions.push({
                id: `${task.schema}\0${task.table}\0${index}\0${rowIndex}`,
                schema: task.schema,
                table: task.table,
                tableType: task.tableType,
                matchedColumns,
                preview,
                whereInput,
              });
            }
            if (additions.length > 0) {
              setHits((current) => [...current, ...additions]);
            }
          }
        } catch (error) {
          if (runIdRef.current !== runId) return;
          errorCount += 1;
          setTotalFailures(errorCount);
          if (errorCount <= DATABASE_SEARCH_MAX_ERRORS) {
            setFailures((current) => [
              ...current,
              {
                schema: task.schema,
                table: task.table,
                message: boundedError(error),
              },
            ]);
          }
        } finally {
          if (currentQueryIdRef.current === queryId) {
            currentQueryIdRef.current = null;
          }
        }
        if (runIdRef.current !== runId) return;
        setScannedTables(index + 1);
      }

      const completedPlan = { ...nextPlan, nextIndex: range.end };
      setPlan(completedPlan);
      setIsScanning(false);
      setStatusMessage(
        range.end >= nextPlan.tasks.length
          ? `Search complete · ${nextPlan.tasks.length.toLocaleString()} tables scanned.`
          : `${range.end.toLocaleString()} of ${nextPlan.tasks.length.toLocaleString()} tables scanned.`,
      );
    },
    [hits, totalFailures],
  );

  const startSearch = useCallback(async () => {
    const normalizedTerm = term.trim();
    if (!scope || !normalizedTerm || isPlanning || isScanning) return;
    stopSearch();
    const planningRunId = runIdRef.current + 1;
    runIdRef.current = planningRunId;
    setIsPlanning(true);
    setHits([]);
    setFailures([]);
    setTotalFailures(0);
    setScannedTables(0);
    setResultsTruncated(false);
    setVisibleResultCount(200);
    setStatusMessage("Resolving the live database scope…");
    try {
      const readinessError = await setActiveConnection(scope.connectionId);
      if (readinessError) throw new Error(readinessError);
      if (runIdRef.current !== planningRunId) return;
      const enumerated = await enumerateTasks(scope);
      if (runIdRef.current !== planningRunId) return;
      if (enumerated.tasks.length === 0) {
        setPlan(null);
        setFailures(enumerated.failures);
        setTotalFailures(enumerated.failures.length);
        setStatusMessage(
          enumerated.failures.length
            ? "No searchable tables were resolved; some schema metadata requests failed."
            : "No searchable base tables were found in this scope.",
        );
        return;
      }
      const nextPlan: SearchPlan = {
        scope: { ...scope },
        term: normalizedTerm,
        limit: Math.min(100, Math.max(1, Math.trunc(limit))),
        tasks: enumerated.tasks,
        nextIndex: 0,
        metadataTruncated: enumerated.metadataTruncated,
        databaseScopedMetadata: enumerated.databaseScopedMetadata,
      };
      setFailures(enumerated.failures);
      setTotalFailures(enumerated.failures.length);
      setPlan(nextPlan);
      await runPlanBatch(
        nextPlan,
        false,
        true,
        enumerated.failures.length,
      );
    } catch (error) {
      setStatusMessage(`Search could not start: ${boundedError(error)}`);
    } finally {
      setIsPlanning(false);
    }
  }, [
    enumerateTasks,
    isPlanning,
    isScanning,
    limit,
    runPlanBatch,
    scope,
    setActiveConnection,
    stopSearch,
    term,
  ]);

  const openHit = useCallback(
    async (hit: SearchHit) => {
      if (!plan || !hit.whereInput) return;
      const readinessError = await setActiveConnection(
        plan.scope.connectionId,
      );
      if (readinessError) {
        setStatusMessage(`Could not open result: ${readinessError}`);
        return;
      }
      const tabs = useTabStore.getState();
      const tabId = tabs.findOrCreateTableTab(
        plan.scope.connectionId,
        hit.schema,
        hit.table,
        hit.tableType || "TABLE",
        plan.scope.database,
      );
      const loaded = await tabs.loadTablePage(tabId, 0, hit.whereInput);
      if (loaded) setOpen(false);
    },
    [plan, setActiveConnection],
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void startSearch();
  };

  const progress = plan?.tasks.length
    ? Math.min(100, (scannedTables / plan.tasks.length) * 100)
    : 0;
  const hasRemaining = Boolean(plan && plan.nextIndex < plan.tasks.length);
  const continuationMatchesInput = Boolean(
    plan && plan.term === term.trim() && plan.limit === limit,
  );
  const visibleHits = useMemo(
    () => hits.slice(0, visibleResultCount),
    [hits, visibleResultCount],
  );
  const scopeLabel = scope
    ? [scope.connectionName, scope.database, scope.schema, scope.table]
        .filter(Boolean)
        .join(" / ")
    : "No connected data source";

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && closeDialog()}>
      <DialogContent className="grid h-[min(760px,calc(100vh-32px))] w-[min(960px,calc(100vw-32px))] max-w-none grid-rows-[auto_auto_auto_minmax(0,1fr)_auto] gap-0 overflow-hidden rounded-[7px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-0 text-[hsl(var(--wb-text))] shadow-[0_18px_48px_rgba(0,0,0,0.42)] [&>button]:right-3 [&>button]:top-3">
        <DialogHeader className="space-y-0 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-4 py-3 pr-11 text-left">
          <div className="flex items-center gap-2">
            <Search size={14} className="text-[hsl(var(--wb-accent))]" />
            <DialogTitle className="text-[13px] font-semibold">
              Search Database Rows
            </DialogTitle>
          </div>
          <DialogDescription className="mt-1 truncate text-[10px] text-[hsl(var(--wb-text-muted))]">
            {scopeLabel}
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid grid-cols-[minmax(0,1fr)_112px_auto] gap-2 border-b border-[hsl(var(--wb-border-subtle))] p-3"
          onSubmit={submit}
        >
          <Input
            autoFocus
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Value to find across table rows"
            className="h-8 rounded-[4px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2.5 text-[12px] focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] focus-visible:ring-offset-0"
            disabled={!scope || isPlanning || isScanning}
          />
          <label className="relative">
            <span className="sr-only">Rows per table</span>
            <Input
              type="number"
              min={1}
              max={100}
              value={limit}
              onChange={(event) =>
                setLimit(
                  Math.min(100, Math.max(1, Number(event.target.value) || 1)),
                )
              }
              className="h-8 rounded-[4px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] pr-12 text-[12px] focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] focus-visible:ring-offset-0"
              disabled={isPlanning || isScanning}
            />
            <span className="pointer-events-none absolute right-2 top-2 text-[9px] uppercase text-[hsl(var(--wb-text-muted))]">
              / table
            </span>
          </label>
          {isPlanning || isScanning ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 rounded-[4px] border-[hsl(var(--wb-border))] px-3 text-[11px]"
              onClick={stopSearch}
            >
              <Square size={11} /> Stop
            </Button>
          ) : (
            <Button
              type="submit"
              size="sm"
              className="h-8 gap-1.5 rounded-[4px] px-3 text-[11px]"
              disabled={!scope || !term.trim()}
            >
              <Search size={12} /> Search
            </Button>
          )}
        </form>

        <div className="border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-3 py-2">
          <div className="flex min-h-5 items-center gap-3 text-[10px] text-[hsl(var(--wb-text-muted))]">
            {(isPlanning || isScanning) && (
              <LoaderCircle
                size={12}
                className="animate-spin text-[hsl(var(--wb-accent))] motion-reduce:animate-none"
              />
            )}
            <span className="min-w-0 flex-1 truncate">
              {statusMessage || "Enter a value to search the selected database scope."}
            </span>
            <span>{hits.length.toLocaleString()} matches</span>
            {totalFailures > 0 && (
              <span className="text-amber-500">
                {totalFailures.toLocaleString()} failed
              </span>
            )}
          </div>
          <div className="mt-1.5 h-0.5 overflow-hidden bg-[hsl(var(--wb-border-subtle))]">
            <div
              className="h-full bg-[hsl(var(--wb-accent))] transition-[width] duration-200 motion-reduce:transition-none"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="min-h-0 overflow-auto bg-[hsl(var(--wb-editor))]">
          {visibleHits.length === 0 ? (
            <div className="flex h-full min-h-48 flex-col items-center justify-center gap-2 px-6 text-center">
              <Database size={24} className="text-[hsl(var(--wb-text-muted))]" />
              <p className="text-[12px] text-[hsl(var(--wb-text))]">
                {isPlanning || isScanning
                  ? "Scanning live table data…"
                  : "No matching rows yet"}
              </p>
              <p className="max-w-md text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
                Search runs one bounded table query at a time. Views, binary
                values, and system schemas are excluded.
              </p>
            </div>
          ) : (
            <div role="list" aria-label="Database search results">
              {visibleHits.map((hit) => (
                <button
                  key={hit.id}
                  type="button"
                  role="listitem"
                  className="group grid w-full grid-cols-[minmax(170px,0.7fr)_minmax(0,1.3fr)_auto] items-center gap-3 border-b border-[hsl(var(--wb-border-subtle))] px-3 py-2 text-left hover:bg-[hsl(var(--wb-hover))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[hsl(var(--wb-accent))]"
                  onClick={() => void openHit(hit)}
                  disabled={!hit.whereInput}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Table2 size={12} className="shrink-0 text-[hsl(var(--wb-accent))]" />
                    <span className="truncate font-mono text-[11px] text-[hsl(var(--wb-text))]">
                      {relationLabel(hit.schema, hit.table)}
                    </span>
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[11px] text-[hsl(var(--wb-text))]">
                      {hit.preview || "Matching row"}
                    </span>
                    <span className="mt-0.5 flex gap-1 overflow-hidden text-[9px] text-[hsl(var(--wb-text-muted))]">
                      {hit.matchedColumns.slice(0, 4).map((column) => (
                        <span
                          key={column}
                          className="rounded-[3px] border border-[hsl(var(--wb-border-subtle))] px-1 py-0.5"
                        >
                          {column}
                        </span>
                      ))}
                    </span>
                  </span>
                  <ArrowUpRight
                    size={12}
                    className="text-[hsl(var(--wb-text-muted))] group-hover:text-[hsl(var(--wb-text))]"
                  />
                </button>
              ))}
              {visibleResultCount < hits.length && (
                <button
                  type="button"
                  className="h-8 w-full text-[10px] text-[hsl(var(--wb-accent))] hover:bg-[hsl(var(--wb-hover))]"
                  onClick={() =>
                    setVisibleResultCount((count) =>
                      Math.min(hits.length, count + 200),
                    )
                  }
                >
                  Show next {Math.min(200, hits.length - visibleResultCount)} results
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex min-h-11 items-center gap-2 border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-3 py-2">
          <div className="min-w-0 flex-1 text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">
            {plan?.metadataTruncated && (
              <span className="mr-3 text-amber-500">
                Table plan limited to {DATABASE_SEARCH_MAX_TABLES.toLocaleString()} entries.
              </span>
            )}
            {resultsTruncated && (
              <span className="mr-3 text-amber-500">
                Stored results reached the 5,000-row / 8 MiB safety budget.
              </span>
            )}
            {failures.length > 0 && (
              <span title={failures.slice(0, 20).map((failure) => `${relationLabel(failure.schema, failure.table)}: ${failure.message}`).join("\n")}>
                <AlertTriangle size={10} className="mr-1 inline text-amber-500" />
                Hover for the first {Math.min(20, failures.length)} table errors.
              </span>
            )}
          </div>
          {hasRemaining && !isPlanning && !isScanning && continuationMatchesInput && plan && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 rounded-[4px] border-[hsl(var(--wb-border))] px-2.5 text-[10px]"
                onClick={() => void runPlanBatch(plan, false)}
              >
                Next {databaseSearchNextBatchSize(plan.nextIndex, plan.tasks.length)} tables
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 rounded-[4px] px-2.5 text-[10px]"
                onClick={() => void runPlanBatch(plan, true)}
              >
                Scan all remaining
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
