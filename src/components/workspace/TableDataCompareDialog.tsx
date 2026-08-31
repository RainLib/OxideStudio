import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  GitCompareArrows,
  Loader2,
  Table2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { DataCompareSource } from "@/lib/dataCompare";
import {
  comparableRelationNames,
  prepareBatchTableComparison,
  tableDataCompareDifferenceCount,
} from "@/lib/tableDataCompareBatch";
import {
  databaseService,
  schemaService,
  tableService,
  type TableDataCompareEndpoint,
  type TableDataCompareResult,
} from "@/services/tauri";
import {
  ensureConnectionReady,
  type ConnectionConfig,
} from "@/store/useConnectionStore";
import { useTabStore } from "@/store/useTabStore";
import type {
  ColumnInfo,
  DatabaseCapabilities,
  TableDataTransferEndpoint,
} from "@/services/tauri/types";

interface TableDataCompareDialogProps {
  open: boolean;
  source: TableDataTransferEndpoint;
  sourceTables: string[];
  connections: ConnectionConfig[];
  onClose: () => void;
  onTransferMissing: (
    tables: string[],
    target: Omit<TableDataTransferEndpoint, "table">,
  ) => void;
}

type BatchStatus = "same" | "different" | "missing" | "error";

interface BatchCompareResult {
  table: string;
  status: BatchStatus;
  result?: TableDataCompareResult;
  error?: string;
  left?: DataCompareSource;
  right?: DataCompareSource;
}

const fieldClass =
  "h-8 w-full rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 text-[11px] outline-none focus:border-[hsl(var(--wb-accent))]";

function endpointId(endpoint: TableDataCompareEndpoint) {
  return [
    "endpoint",
    endpoint.connectionId,
    endpoint.database || "",
    endpoint.schema,
    endpoint.table,
  ].join(":");
}

function sourceFromColumns(
  endpoint: TableDataCompareEndpoint,
  label: string,
  columns: ColumnInfo[],
): DataCompareSource {
  return {
    id: endpointId(endpoint),
    tabId: endpointId(endpoint),
    label,
    sourceKind: "table",
    resultIndex: 0,
    connectionId: endpoint.connectionId,
    databaseName: endpoint.database,
    schemaName: endpoint.schema,
    objectName: endpoint.table,
    columns: columns.map((column) => ({
      name: column.name,
      dataType: column.data_type,
    })),
    rows: [],
    suggestedKeyColumns: columns
      .filter((column) => column.is_primary_key)
      .map((column) => column.name),
    truncated: false,
    capturedAt: Date.now(),
  };
}

async function columnsFor(endpoint: TableDataCompareEndpoint) {
  return endpoint.database
    ? schemaService.getDatabaseColumns(
        endpoint.connectionId,
        endpoint.database,
        endpoint.schema,
        endpoint.table,
      )
    : schemaService.getColumns(
        endpoint.connectionId,
        endpoint.schema,
        endpoint.table,
      );
}

export function TableDataCompareDialog({
  open,
  source,
  sourceTables,
  connections,
  onClose,
  onTransferMissing,
}: TableDataCompareDialogProps) {
  const openDataCompareSourcesTab = useTabStore(
    (state) => state.openDataCompareSourcesTab,
  );
  const [targetConnectionId, setTargetConnectionId] = useState("");
  const [targetDatabase, setTargetDatabase] = useState("");
  const [targetSchema, setTargetSchema] = useState("");
  const [targetCapabilities, setTargetCapabilities] =
    useState<DatabaseCapabilities | null>(null);
  const [databases, setDatabases] = useState<string[]>([]);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [targetTables, setTargetTables] = useState<string[]>([]);
  const [results, setResults] = useState<BatchCompareResult[]>([]);
  const [completed, setCompleted] = useState(0);
  const [isLoadingTarget, setIsLoadingTarget] = useState(false);
  const [isComparing, setIsComparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeCompareIds = useRef<Set<string>>(new Set());
  const runGeneration = useRef(0);
  const targetConnection = connections.find(
    (connection) => connection.id === targetConnectionId,
  );
  const normalizedSourceTables = useMemo(
    () => [...new Set(sourceTables)].sort((left, right) => left.localeCompare(right)),
    [sourceTables],
  );
  const missingTables = results
    .filter((result) => result.status === "missing")
    .map((result) => result.table);

  useEffect(() => {
    if (!open) return;
    const fallback =
      connections.find((connection) => connection.id !== source.connectionId) ||
      connections.find((connection) => connection.id === source.connectionId);
    setTargetConnectionId(fallback?.id || "");
    setTargetDatabase("");
    setTargetSchema(source.schema);
    setResults([]);
    setCompleted(0);
    setError(null);
  }, [connections, open, source.connectionId, source.schema]);

  useEffect(() => {
    if (!open || !targetConnectionId) return;
    let cancelled = false;
    setIsLoadingTarget(true);
    setTargetCapabilities(null);
    setDatabases([]);
    setSchemas([]);
    setTargetTables([]);
    setResults([]);
    setError(null);
    void (async () => {
      try {
        const readiness = await ensureConnectionReady(targetConnectionId);
        if (readiness.status === "error") throw new Error(readiness.message);
        if (readiness.status === "cancelled" || cancelled) return;
        const context =
          await databaseService.getConnectionDatabaseCapabilityContext(
            targetConnectionId,
          );
        if (cancelled) return;
        setTargetCapabilities(context.capabilities);
        if (!context.capabilities.supportsDatabaseCatalogs) {
          const nextSchemas = await schemaService.getSchemas(targetConnectionId);
          if (cancelled) return;
          setSchemas(nextSchemas);
          setTargetSchema((current) =>
            nextSchemas.includes(current) ? current : nextSchemas[0] || "",
          );
          return;
        }
        const nextDatabases = await schemaService.getDatabases(targetConnectionId);
        if (cancelled) return;
        setDatabases(nextDatabases);
        const preferred = [
          source.database,
          targetConnection?.database,
          nextDatabases[0],
        ].find((database) => database && nextDatabases.includes(database));
        setTargetDatabase(preferred || "");
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
        }
      } finally {
        if (!cancelled) setIsLoadingTarget(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    open,
    source.database,
    targetConnection?.database,
    targetConnectionId,
  ]);

  useEffect(() => {
    if (
      !open ||
      !targetConnectionId ||
      !targetCapabilities?.supportsDatabaseCatalogs ||
      !targetDatabase
    ) {
      return;
    }
    let cancelled = false;
    setIsLoadingTarget(true);
    setSchemas([]);
    setTargetTables([]);
    void schemaService
      .getDatabaseSchemas(targetConnectionId, targetDatabase)
      .then((nextSchemas) => {
        if (cancelled) return;
        setSchemas(nextSchemas);
        setTargetSchema((current) =>
          nextSchemas.includes(current) ? current : nextSchemas[0] || "",
        );
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingTarget(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    open,
    targetCapabilities?.supportsDatabaseCatalogs,
    targetConnectionId,
    targetDatabase,
  ]);

  useEffect(() => {
    if (!open || !targetConnectionId || !targetSchema) return;
    if (targetCapabilities?.supportsDatabaseCatalogs && !targetDatabase) return;
    let cancelled = false;
    setIsLoadingTarget(true);
    setTargetTables([]);
    setResults([]);
    const request = targetCapabilities?.supportsDatabaseCatalogs
      ? schemaService.getDatabaseTables(
          targetConnectionId,
          targetDatabase,
          targetSchema,
        )
      : schemaService.getTables(targetConnectionId, targetSchema);
    void request
      .then((tables) => {
        if (!cancelled) setTargetTables(comparableRelationNames(tables));
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : String(nextError));
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingTarget(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    open,
    targetCapabilities?.supportsDatabaseCatalogs,
    targetConnectionId,
    targetDatabase,
    targetSchema,
  ]);

  useEffect(() => {
    return () => {
      runGeneration.current += 1;
      for (const compareId of activeCompareIds.current) {
        void tableService.cancelTableDataCompare(compareId).catch(() => undefined);
      }
      activeCompareIds.current.clear();
    };
  }, []);

  const compareOne = async (
    table: string,
    targetTableSet: ReadonlySet<string>,
    generation: number,
  ): Promise<BatchCompareResult> => {
    if (!targetConnection) {
      return { table, status: "error", error: "Choose a target connection." };
    }
    if (!targetTableSet.has(table)) return { table, status: "missing" };
    const leftEndpoint: TableDataCompareEndpoint = {
      connectionId: source.connectionId,
      driver: source.driver,
      database: source.database,
      schema: source.schema,
      table,
    };
    const rightEndpoint: TableDataCompareEndpoint = {
      connectionId: targetConnection.id,
      driver: targetConnection.driver,
      database: targetDatabase || undefined,
      schema: targetSchema,
      table,
    };
    try {
      const [leftColumns, rightColumns] = await Promise.all([
        columnsFor(leftEndpoint),
        columnsFor(rightEndpoint),
      ]);
      if (runGeneration.current !== generation) {
        return { table, status: "error", error: "Comparison cancelled." };
      }
      const { columns, keyColumns } = prepareBatchTableComparison(
        leftColumns,
        rightColumns,
      );
      const compareId = tableService.createTableDataCompareId();
      activeCompareIds.current.add(compareId);
      try {
        const result = await tableService.compareTableDataFull({
          compareId,
          source: leftEndpoint,
          target: rightEndpoint,
          columns,
          keyColumns,
        });
        const left = sourceFromColumns(
          leftEndpoint,
          `${source.schema}.${table}`,
          leftColumns,
        );
        const right = sourceFromColumns(
          rightEndpoint,
          `${targetSchema}.${table}`,
          rightColumns,
        );
        const different = tableDataCompareDifferenceCount(result) > 0;
        return {
          table,
          status: different ? "different" : "same",
          result,
          left,
          right,
        };
      } finally {
        activeCompareIds.current.delete(compareId);
      }
    } catch (nextError) {
      return {
        table,
        status: "error",
        error: nextError instanceof Error ? nextError.message : String(nextError),
      };
    }
  };

  const runComparison = async () => {
    if (!targetConnection || !targetSchema || normalizedSourceTables.length === 0) return;
    const generation = runGeneration.current + 1;
    runGeneration.current = generation;
    setIsComparing(true);
    setResults([]);
    setCompleted(0);
    setError(null);
    try {
      const targetTableSet = new Set(targetTables);
      const nextResults = new Array<BatchCompareResult>(normalizedSourceTables.length);
      let cursor = 0;
      const worker = async () => {
        while (cursor < normalizedSourceTables.length) {
          const index = cursor;
          cursor += 1;
          const table = normalizedSourceTables[index]!;
          const result = await compareOne(table, targetTableSet, generation);
          if (runGeneration.current !== generation) return;
          nextResults[index] = result;
          setResults(nextResults.filter(Boolean));
          setCompleted((current) => current + 1);
        }
      };
      await Promise.all(
        Array.from(
          { length: Math.min(2, normalizedSourceTables.length) },
          () => worker(),
        ),
      );
    } finally {
      if (runGeneration.current === generation) setIsComparing(false);
    }
  };

  const cancelComparison = () => {
    runGeneration.current += 1;
    for (const compareId of activeCompareIds.current) {
      void tableService.cancelTableDataCompare(compareId).catch(() => undefined);
    }
    activeCompareIds.current.clear();
    setIsComparing(false);
  };

  const targetForTransfer = targetConnection
    ? {
        connectionId: targetConnection.id,
        driver: targetConnection.driver,
        database: targetDatabase || undefined,
        schema: targetSchema,
      }
    : null;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="flex h-[min(760px,calc(100vh-32px))] w-[min(1040px,calc(100vw-32px))] max-w-none flex-col gap-0 overflow-hidden border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-0 text-[hsl(var(--wb-text))]">
        <DialogHeader className="border-b border-[hsl(var(--wb-border-subtle))] px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <GitCompareArrows size={16} className="text-cyan-300" />
            Compare table data
          </DialogTitle>
          <DialogDescription className="text-[10px] wb-muted">
            Match tables by name, compare two at a time, and open exact differences in the workspace.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-[270px_minmax(0,1fr)]">
          <aside className="overflow-auto border-r border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel)/0.72)] p-4">
            <div className="text-[8px] font-semibold uppercase tracking-[0.13em] wb-muted">
              Source set
            </div>
            <div className="mt-2 rounded-[5px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] px-3 py-2 text-[10px]">
              <div className="truncate font-medium">{source.schema}</div>
              <div className="mt-0.5 wb-muted">
                {normalizedSourceTables.length.toLocaleString()} table(s) selected
              </div>
            </div>

            <div className="mt-5 text-[8px] font-semibold uppercase tracking-[0.13em] wb-muted">
              Compare with
            </div>
            <label className="mt-2 block text-[9px] wb-muted">
              Connection
              <Select value={targetConnectionId} onValueChange={setTargetConnectionId}>
                <SelectTrigger className={cn(fieldClass, "mt-1")}>
                  <SelectValue placeholder="Choose connection" />
                </SelectTrigger>
                <SelectContent>
                  {connections.map((connection) => (
                    <SelectItem key={connection.id} value={connection.id}>
                      {connection.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            {targetCapabilities?.supportsDatabaseCatalogs && (
              <label className="mt-3 block text-[9px] wb-muted">
                Database
                <Select value={targetDatabase} onValueChange={setTargetDatabase}>
                  <SelectTrigger className={cn(fieldClass, "mt-1")}>
                    <SelectValue placeholder="Choose database" />
                  </SelectTrigger>
                  <SelectContent>
                    {databases.map((database) => (
                      <SelectItem key={database} value={database}>
                        {database}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            )}
            <label className="mt-3 block text-[9px] wb-muted">
              Schema
              <Select value={targetSchema} onValueChange={setTargetSchema}>
                <SelectTrigger className={cn(fieldClass, "mt-1")}>
                  <SelectValue placeholder="Choose schema" />
                </SelectTrigger>
                <SelectContent>
                  {schemas.map((schema) => (
                    <SelectItem key={schema} value={schema}>
                      {schema}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <Button
              className="mt-5 h-8 w-full text-[10px]"
              disabled={
                isLoadingTarget ||
                !targetConnection ||
                !targetSchema ||
                normalizedSourceTables.length === 0
              }
              onClick={() => void (isComparing ? cancelComparison() : runComparison())}
            >
              {isComparing ? (
                <>Cancel {completed}/{normalizedSourceTables.length}</>
              ) : isLoadingTarget ? (
                <><Loader2 size={12} className="mr-1.5 animate-spin" /> Reading target</>
              ) : (
                <><GitCompareArrows size={12} className="mr-1.5" /> Compare matching tables</>
              )}
            </Button>
            <p className="mt-2 text-[8px] leading-4 wb-muted">
              Oxide runs at most two comparisons concurrently. Missing tables are handed to the reviewed transfer workflow.
            </p>
          </aside>

          <main className="min-h-0 overflow-auto p-4">
            {error && (
              <div className="mb-3 flex items-start gap-2 rounded-[5px] border border-rose-400/25 bg-rose-400/[0.06] px-3 py-2 text-[9px] text-rose-200">
                <AlertTriangle size={11} className="mt-0.5 shrink-0" /> {error}
              </div>
            )}
            {results.length === 0 ? (
              <div className="flex h-full min-h-64 flex-col items-center justify-center text-center wb-muted">
                <Table2 size={28} className="mb-3 opacity-45" />
                <div className="text-[11px] font-medium text-[hsl(var(--wb-text))]">
                  Ready to inspect {normalizedSourceTables.length.toLocaleString()} table(s)
                </div>
                <div className="mt-1 max-w-sm text-[9px] leading-4">
                  Choose a target namespace. Results keep exact, sampled, missing, and failed states separate.
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="mb-3 flex items-center gap-3 text-[9px] wb-muted">
                  <span>{results.filter((item) => item.status === "same").length} same</span>
                  <span>{results.filter((item) => item.status === "different").length} different</span>
                  <span>{missingTables.length} missing</span>
                  <span>{results.filter((item) => item.status === "error").length} failed</span>
                  {missingTables.length > 0 && targetForTransfer && (
                    <button
                      type="button"
                      className="wb-text-button ml-auto h-7 gap-1.5 px-2.5 text-[9px]"
                      onClick={() => onTransferMissing(missingTables, targetForTransfer)}
                    >
                      Transfer missing tables <ArrowRight size={10} />
                    </button>
                  )}
                </div>
                {results.map((item) => {
                  const count = item.result
                    ? tableDataCompareDifferenceCount(item.result)
                    : 0;
                  return (
                    <div
                      key={item.table}
                      className={cn(
                        "grid grid-cols-[4px_minmax(0,1fr)_auto] items-center overflow-hidden rounded-[5px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))]",
                      )}
                    >
                      <div
                        className={cn(
                          "h-full",
                          item.status === "same" && "bg-emerald-400/70",
                          item.status === "different" && "bg-amber-400/80",
                          item.status === "missing" && "bg-cyan-400/75",
                          item.status === "error" && "bg-rose-400/80",
                        )}
                      />
                      <div className="min-w-0 px-3 py-2.5">
                        <div className="flex items-center gap-2 text-[10px] font-medium">
                          {item.status === "same" && <Check size={10} className="text-emerald-300" />}
                          <span className="truncate font-mono">{item.table}</span>
                          <span className="text-[8px] uppercase tracking-[0.08em] wb-muted">
                            {item.status}
                          </span>
                        </div>
                        <div className="mt-1 text-[8px] leading-4 wb-muted">
                          {item.error ||
                            (item.status === "missing"
                              ? "No same-name target table."
                              : item.result?.degradationLevel === "full"
                                ? `${count.toLocaleString()} exact difference(s)`
                                : `${count.toLocaleString()} sampled difference(s) · ${item.result?.verificationMethod}`)}
                        </div>
                      </div>
                      {item.left && item.right && item.status !== "same" && (
                        <button
                          type="button"
                          className="wb-text-button mr-3 h-7 px-2.5 text-[9px]"
                          onClick={() => {
                            openDataCompareSourcesTab(item.left!, item.right!);
                            onClose();
                          }}
                        >
                          Open table compare
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </main>
        </div>
      </DialogContent>
    </Dialog>
  );
}
