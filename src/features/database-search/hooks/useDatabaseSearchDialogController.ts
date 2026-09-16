import { isSystemNamespace } from "@/lib/databaseDialect";
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
  DATABASE_SEARCH_MAX_ERRORS,
  DATABASE_SEARCH_MAX_RESULTS,
  DATABASE_SEARCH_MAX_RESULT_BYTES,
  DATABASE_SEARCH_MAX_TABLES,
  databaseSearchBatchRange,
  databaseSearchColumn,
  databaseSearchResultByteSize,
  databaseSearchRowPreview,
  eligibleDatabaseSearchTables,
  findMatchedSearchColumns,
  mapDatabaseSearchWithConcurrency,
} from "@/features/database-search/model/databaseSearch";
import {
  boundedDatabaseSearchError,
  databaseSearchRelationLabel,
  type DatabaseSearchDialogProps,
  type SearchFailure,
  type SearchHit,
  type SearchPlan,
  type SearchScope,
} from "@/features/database-search/model/databaseSearchDialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export function useDatabaseSearchDialogController({
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
          return { schema, tables: [], error: boundedDatabaseSearchError(error) };
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
            databaseSearchRelationLabel(hit.schema, hit.table),
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
                databaseSearchRelationLabel(task.schema, task.table),
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
                message: boundedDatabaseSearchError(error),
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
      setStatusMessage(`Search could not start: ${boundedDatabaseSearchError(error)}`);
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


  return {
    open,
    closeDialog,
    scopeLabel,
    term,
    setTerm,
    limit,
    setLimit,
    scope,
    isPlanning,
    isScanning,
    stopSearch,
    startSearch,
    statusMessage,
    hits,
    totalFailures,
    progress,
    visibleHits,
    openHit,
    visibleResultCount,
    setVisibleResultCount,
    plan,
    resultsTruncated,
    failures,
    hasRemaining,
    continuationMatchesInput,
    runPlanBatch,
  };
}

export type DatabaseSearchDialogController = ReturnType<
  typeof useDatabaseSearchDialogController
>;
