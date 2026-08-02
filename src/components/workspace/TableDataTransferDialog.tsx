import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowRightLeft, FilePlus2, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Button } from "@/components/ui/button";
import { ensureConnectionReady, type ConnectionConfig } from "@/store/useConnectionStore";
import { databaseService, schemaService, tableService } from "@/services/tauri";
import type {
  DatabaseCapabilities,
  TableDataTransferEndpoint,
  TableDataTransferProgress,
  TableDataTransferPreview,
  TableDataTransferTargetPlan,
  TableDataTransferTargetPlanRequest,
} from "@/services/tauri/types";

interface TableDataTransferDialogProps {
  open: boolean;
  source: TableDataTransferEndpoint;
  sourceCapabilities?: DatabaseCapabilities | null;
  connections: ConnectionConfig[];
  onClose: () => void;
  onTransferred: () => void;
}

const fieldClass =
  "h-7 w-full rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 text-[11px] text-[hsl(var(--wb-text))] outline-none placeholder:text-[hsl(var(--wb-text-muted))] focus:border-[hsl(var(--wb-accent))]";

function displayEndpoint(endpoint: TableDataTransferEndpoint) {
  return [endpoint.database, endpoint.schema, endpoint.table]
    .filter((value) => value?.trim())
    .join(".");
}

function createTableDataTransferId() {
  const randomId = globalThis.crypto?.randomUUID?.();
  return randomId
    ? `transfer-${randomId}`
    : `transfer-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function transferCompatibilityClass(
  compatibility: TableDataTransferPreview["mappedColumns"][number]["compatibility"],
) {
  switch (compatibility) {
    case "exact":
      return "text-[hsl(var(--wb-success))]";
    case "safe":
      return "text-[hsl(var(--wb-accent))]";
    case "review":
      return "text-[hsl(var(--wb-warning))]";
    case "unsupported":
      return "text-[hsl(var(--destructive))]";
  }
}

/**
 * Keep the chooser aligned with the Rust `table_data_dialect` boundary. A
 * connection being present in Explorer, or even supporting ordinary row
 * editing, does not prove that cross-connection paging, type mapping and
 * parameterized batch writes have been verified for it.
 */
export function supportsBoundedTableDataTransfer(
  driver: string,
  capabilities?: DatabaseCapabilities | null,
) {
  // When capabilities are available they describe the exact live connection.
  // An external package may use a familiar driver id (for example postgres)
  // while deliberately withholding the reviewed transfer contract, so a
  // bundled-name fallback must never override an explicit false value.
  if (capabilities) return capabilities.supportsTableDataTransfer === true;
  return new Set([
    "postgres",
    "postgresql",
    "pgsql",
    "mysql",
    "mariadb",
    "sqlite",
    "sqlite3",
    "duckdb",
  ]).has(driver.trim().toLocaleLowerCase());
}

export function canExecuteTableDataTransfer(
  preview: TableDataTransferPreview | null,
  confirmation: string,
  isSubmitting: boolean,
) {
  return Boolean(
    preview?.canExecute === true &&
      confirmation.trim() === preview.confirmationToken &&
      !isSubmitting,
  );
}

export function TableDataTransferDialog({
  open,
  source,
  sourceCapabilities,
  connections,
  onClose,
  onTransferred,
}: TableDataTransferDialogProps) {
  const [targetConnectionId, setTargetConnectionId] = useState("");
  const [transferId, setTransferId] = useState(createTableDataTransferId);
  const [targetDatabase, setTargetDatabase] = useState("");
  const [targetSchema, setTargetSchema] = useState("");
  const [targetTable, setTargetTable] = useState("");
  const [targetTableMode, setTargetTableMode] = useState<"existing" | "new">(
    "existing",
  );
  const [mode, setMode] = useState<"append" | "overwrite">("append");
  const [maxRows, setMaxRows] = useState("1000");
  const [batchSize, setBatchSize] = useState("250");
  const [schemas, setSchemas] = useState<string[]>([]);
  const [databases, setDatabases] = useState<string[]>([]);
  const [targetCapabilities, setTargetCapabilities] =
    useState<DatabaseCapabilities | null>(null);
  const [externalTransferConnectionIds, setExternalTransferConnectionIds] =
    useState<Set<string>>(() => new Set());
  const [isDatabasesLoading, setIsDatabasesLoading] = useState(false);
  const [isSchemasLoading, setIsSchemasLoading] = useState(false);
  const [tables, setTables] = useState<string[]>([]);
  const [isTablesLoading, setIsTablesLoading] = useState(false);
  const [preview, setPreview] = useState<TableDataTransferPreview | null>(null);
  const [previewRequestKey, setPreviewRequestKey] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [targetPlan, setTargetPlan] =
    useState<TableDataTransferTargetPlan | null>(null);
  const [targetPlanPreviewKey, setTargetPlanPreviewKey] = useState("");
  const [targetPlanConfirmation, setTargetPlanConfirmation] = useState("");
  const [isCreatingTarget, setIsCreatingTarget] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [progress, setProgress] =
    useState<TableDataTransferProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const targetConnection = useMemo(
    () =>
      connections.find(
        (connection) => connection.id === targetConnectionId,
      ),
    [connections, targetConnectionId],
  );
  const eligibleTargetConnections = useMemo(
    () =>
      connections.filter((connection) =>
        supportsBoundedTableDataTransfer(connection.driver) ||
        externalTransferConnectionIds.has(connection.id),
      ),
    [connections, externalTransferConnectionIds],
  );
  const sourceSupportsTransfer = supportsBoundedTableDataTransfer(
    source.driver,
    sourceCapabilities,
  );
  const request = useMemo(() => {
    if (!targetConnection) return null;
    return {
      transferId,
      source,
      target: {
        connectionId: targetConnection.id,
        driver: targetConnection.driver,
        database: targetDatabase || undefined,
        schema: targetSchema,
        table: targetTable,
      },
      mode,
      maxRows: Number.parseInt(maxRows, 10) || undefined,
      batchSize: Number.parseInt(batchSize, 10) || undefined,
    };
  }, [
    batchSize,
    maxRows,
    mode,
    source,
    transferId,
    targetConnection,
    targetDatabase,
    targetSchema,
    targetTable,
  ]);
  const targetPlanRequest = useMemo<TableDataTransferTargetPlanRequest | null>(
    () =>
      targetConnection && targetTableMode === "new"
        ? {
            source,
            target: {
              connectionId: targetConnection.id,
              driver: targetConnection.driver,
              database: targetDatabase || undefined,
              schema: targetSchema,
              table: targetTable,
            },
          }
        : null,
    [
      source,
      targetConnection,
      targetDatabase,
      targetSchema,
      targetTable,
      targetTableMode,
    ],
  );
  const targetSupportsCatalogs =
    targetCapabilities?.supportsDatabaseCatalogs === true;
  const targetSupportsGeneratedTable = Boolean(
    targetConnection &&
      !targetConnection.driverPackageVersion &&
      targetCapabilities?.supportsTableDdl !== false &&
      new Set([
        "postgres",
        "postgresql",
        "pgsql",
        "mysql",
        "mariadb",
        "sqlite",
        "sqlite3",
      ]).has(targetConnection.driver.trim().toLocaleLowerCase()),
  );
  const requestKey = useMemo(
    () => (request ? JSON.stringify(request) : ""),
    [request],
  );
  const targetPlanRequestKey = useMemo(
    () => (targetPlanRequest ? JSON.stringify(targetPlanRequest) : ""),
    [targetPlanRequest],
  );

  useEffect(() => {
    if (!open) return;
    const firstTarget = eligibleTargetConnections.find(
      (connection) =>
        connection.id !== source.connectionId || connection.driver !== source.driver,
    ) || eligibleTargetConnections.find((connection) => connection.id === source.connectionId);
    setTargetConnectionId(firstTarget?.id || "");
    setTransferId(createTableDataTransferId());
    setTargetDatabase("");
    setTargetSchema(source.schema);
    setTargetTable("");
    setTargetTableMode("existing");
    setMode("append");
    setSchemas([]);
    setDatabases([]);
    setTargetCapabilities(null);
    setTables([]);
    setPreview(null);
    setPreviewRequestKey("");
    setConfirmation("");
    setTargetPlan(null);
    setTargetPlanPreviewKey("");
    setTargetPlanConfirmation("");
    setIsCreatingTarget(false);
    setError(null);
    setIsSubmitting(false);
    setIsExecuting(false);
    setIsCancelling(false);
    setProgress(null);
  }, [eligibleTargetConnections, open, source.connectionId, source.driver, source.schema]);

  useEffect(() => {
    if (!open) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void tableService
      .listenTableDataTransferProgress((nextProgress) => {
        if (!disposed && nextProgress.transferId === transferId) {
          setProgress(nextProgress);
        }
      })
      .then((nextUnlisten) => {
        if (disposed) nextUnlisten();
        else unlisten = nextUnlisten;
      })
      .catch((nextError) => {
        if (!disposed) {
          setError(
            nextError instanceof Error ? nextError.message : String(nextError),
          );
        }
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [open, transferId]);

  // Built-in engines are known synchronously. For every other connection,
  // ask the package manager for its signed capability contract before putting
  // it in the target chooser. This keeps ordinary JDBC/read-only packages out
  // while allowing a reviewed native sidecar to participate without another
  // frontend allow-list release.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const externalConnections = connections.filter(
      (connection) => !supportsBoundedTableDataTransfer(connection.driver),
    );
    if (externalConnections.length === 0) {
      setExternalTransferConnectionIds(new Set());
      return;
    }
    void Promise.all(
      externalConnections.map(async (connection) => {
        try {
          const capabilities = await databaseService.getDatabaseCapabilities(
            connection.driver,
            connection.driverPackageVersion,
          );
          return capabilities.supportsTableDataTransfer === true
            ? connection.id
            : null;
        } catch {
          // A stale/inactive package must not become a write target merely
          // because its connection was retained in local state.
          return null;
        }
      }),
    ).then((connectionIds) => {
      if (!cancelled) {
        setExternalTransferConnectionIds(
          new Set(connectionIds.filter((id): id is string => id !== null)),
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [connections, open]);

  useEffect(() => {
    if (
      !open ||
      !targetConnectionId ||
      (!supportsBoundedTableDataTransfer(targetConnection?.driver || "") &&
        !externalTransferConnectionIds.has(targetConnectionId))
    ) {
      return;
    }
    let cancelled = false;
    setTargetCapabilities(null);
    setDatabases([]);
    setTargetDatabase("");
    setIsDatabasesLoading(true);
    setSchemas([]);
    setTables([]);
    setTargetTable("");
    setTargetTableMode("existing");
    setTargetPlan(null);
    setTargetPlanPreviewKey("");
    setTargetPlanConfirmation("");
    setError(null);
    void (async () => {
      try {
        const readiness = await ensureConnectionReady(targetConnectionId);
        if (readiness.status === "error") throw new Error(readiness.message);
        if (readiness.status === "cancelled" || cancelled) return;
        const capabilities = await databaseService.getDatabaseCapabilities(
          targetConnection?.driver || "postgres",
          targetConnection?.driverPackageVersion,
        );
        if (cancelled) return;
        setTargetCapabilities(capabilities);
        if (!capabilities.supportsDatabaseCatalogs) return;

        const nextDatabases = await schemaService.getDatabases(targetConnectionId);
        if (cancelled) return;
        setDatabases(nextDatabases);
        const preferredDatabase = [
          source.database,
          targetConnection?.database,
          nextDatabases[0],
        ].find((database) => database && nextDatabases.includes(database));
        setTargetDatabase(preferredDatabase || "");
      } catch (nextError) {
        if (!cancelled) {
          setError(
            nextError instanceof Error ? nextError.message : String(nextError),
          );
        }
      } finally {
        if (!cancelled) setIsDatabasesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    open,
    source.database,
    targetConnection?.database,
    targetConnection?.driver,
    targetConnection?.driverPackageVersion,
    targetConnectionId,
    externalTransferConnectionIds,
  ]);

  useEffect(() => {
    if (!open || !targetConnectionId || !targetCapabilities) return;
    if (targetSupportsCatalogs && !targetDatabase) return;
    let cancelled = false;
    setIsSchemasLoading(true);
    setSchemas([]);
    void (async () => {
      try {
        const nextSchemas = targetSupportsCatalogs
          ? await schemaService.getDatabaseSchemas(
              targetConnectionId,
              targetDatabase,
            )
          : await schemaService.getSchemas(targetConnectionId);
        if (!cancelled) {
          setSchemas(nextSchemas);
          setTargetSchema((current) =>
            nextSchemas.includes(current) ? current : (nextSchemas[0] || ""),
          );
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(
            nextError instanceof Error ? nextError.message : String(nextError),
          );
        }
      } finally {
        if (!cancelled) setIsSchemasLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    open,
    targetCapabilities,
    targetConnectionId,
    targetDatabase,
    targetSupportsCatalogs,
  ]);

  useEffect(() => {
    if (
      !open ||
      !targetConnectionId ||
      !targetSchema.trim() ||
      !targetCapabilities ||
      (targetSupportsCatalogs && !targetDatabase)
    ) {
      return;
    }
    let cancelled = false;
    setIsTablesLoading(true);
    setTables([]);
    setTargetTable((current) =>
      targetTableMode === "new" ? current : "",
    );
    void (targetSupportsCatalogs
      ? schemaService.getDatabaseTables(
          targetConnectionId,
          targetDatabase,
          targetSchema,
        )
      : schemaService.getTables(targetConnectionId, targetSchema))
      .then((items) => {
        if (cancelled) return;
        const names = items
          .filter((item) => !item.type?.toUpperCase().includes("VIEW"))
          .map((item) => item.name)
          .sort((left, right) => left.localeCompare(right));
        setTables(names);
        if (targetTableMode === "existing") {
          setTargetTable(names[0] || "");
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(
            nextError instanceof Error ? nextError.message : String(nextError),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setIsTablesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    open,
    targetCapabilities,
    targetConnectionId,
    targetDatabase,
    targetSchema,
    targetTableMode,
    targetSupportsCatalogs,
  ]);

  const resetTransferReview = () => {
    setPreview(null);
    setPreviewRequestKey("");
    setConfirmation("");
    setProgress(null);
  };

  const handleTargetTableModeChange = (nextMode: "existing" | "new") => {
    setTargetTableMode(nextMode);
    setTargetTable(nextMode === "existing" ? (tables[0] || "") : source.table);
    setTargetPlan(null);
    setTargetPlanPreviewKey("");
    setTargetPlanConfirmation("");
    resetTransferReview();
    setError(null);
  };

  const handlePreviewTarget = async () => {
    if (
      !targetPlanRequest ||
      !targetSchema.trim() ||
      !targetTable.trim()
    ) {
      setError("Choose a target connection and schema, then enter a new table name.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    setTargetPlan(null);
    setTargetPlanPreviewKey("");
    setTargetPlanConfirmation("");
    try {
      const nextPlan = await tableService.previewTableDataTransferTarget(
        targetPlanRequest,
      );
      setTargetPlan(nextPlan);
      setTargetPlanPreviewKey(targetPlanRequestKey);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateTarget = async () => {
    if (
      !targetPlanRequest ||
      !targetPlan ||
      targetPlanPreviewKey !== targetPlanRequestKey ||
      targetPlanConfirmation.trim() !== targetPlan.confirmationToken
    ) {
      return;
    }
    setIsSubmitting(true);
    setIsCreatingTarget(true);
    setError(null);
    try {
      const created = await tableService.createTableDataTransferTarget(
        targetPlanRequest,
        targetPlanConfirmation,
      );
      const nextTables = targetSupportsCatalogs
        ? await schemaService.getDatabaseTables(
            targetConnectionId,
            targetDatabase,
            targetSchema,
          )
        : await schemaService.getTables(targetConnectionId, targetSchema);
      const names = nextTables
        .filter((item) => !item.type?.toUpperCase().includes("VIEW"))
        .map((item) => item.name)
        .sort((left, right) => left.localeCompare(right));
      setTables(names);
      setTargetTableMode("existing");
      setTargetTable(created.table);
      setTargetPlan(null);
      setTargetPlanPreviewKey("");
      setTargetPlanConfirmation("");
      resetTransferReview();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setIsCreatingTarget(false);
      setIsSubmitting(false);
    }
  };

  const handlePreview = async () => {
    if (!sourceSupportsTransfer) {
      setError(
        `${source.driver} does not have a verified bounded table-data transfer path yet.`,
      );
      return;
    }
    if (
      !targetConnection ||
      !supportsBoundedTableDataTransfer(
        targetConnection.driver,
        targetCapabilities,
      )
    ) {
      setError(
        "Choose a connection with a verified bounded table-data transfer path.",
      );
      return;
    }
    if (!request || !targetSchema.trim() || !targetTable.trim()) {
      setError("Choose a target connection, schema, and table before previewing.");
      return;
    }
    if (targetTableMode !== "existing") {
      setError("Review and create the empty target table before previewing data transfer.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    setPreview(null);
    setPreviewRequestKey("");
    setProgress(null);
    setConfirmation("");
    try {
      const nextPreview = await tableService.previewTableDataTransfer(request);
      setPreview(nextPreview);
      setPreviewRequestKey(requestKey);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleModeChange = (nextMode: "append" | "overwrite") => {
    setMode(nextMode);
    setPreview(null);
    setPreviewRequestKey("");
    setConfirmation("");
    setProgress(null);
  };

  const handleTransfer = async () => {
    if (!request || !preview || previewRequestKey !== requestKey) return;
    setIsSubmitting(true);
    setIsExecuting(true);
    setIsCancelling(false);
    setError(null);
    try {
      await tableService.executeTableDataTransfer(request, confirmation);
      onTransferred();
      onClose();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setIsSubmitting(false);
      setIsExecuting(false);
      setIsCancelling(false);
    }
  };

  const handleCancelTransfer = async () => {
    if (!isExecuting || isCancelling) return;
    setIsCancelling(true);
    setError(null);
    try {
      await tableService.cancelTableDataTransfer(transferId);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      setIsCancelling(false);
    }
  };

  const planIsCurrent = Boolean(preview && previewRequestKey === requestKey);
  const canExecute =
    planIsCurrent &&
    canExecuteTableDataTransfer(preview, confirmation, isSubmitting);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && !isSubmitting && onClose()}>
      <DialogContent className="w-[min(800px,calc(100vw-32px))] max-w-none gap-0 overflow-hidden rounded-[7px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-0 text-[hsl(var(--wb-text))]">
        <DialogHeader className="border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-[4px] bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-accent))]">
              <ArrowRightLeft size={15} />
            </span>
            <div>
              <DialogTitle className="text-[13px] tracking-normal">Transfer table data</DialogTitle>
              <DialogDescription className="text-[10px] text-[hsl(var(--wb-text-muted))]">
                {displayEndpoint(source)} → {targetTableMode === "new" ? "review new target table" : `existing target table · ${mode}`}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] divide-x divide-[hsl(var(--wb-border-subtle))]">
          <section className="space-y-3 p-4">
            <div className="text-[11px] font-medium">Target</div>
            <label className="block space-y-1">
              <span className="text-[10px] wb-muted">Connection</span>
              <Select value={targetConnectionId} onValueChange={setTargetConnectionId} disabled={isSubmitting}>
                <SelectTrigger className={fieldClass}><SelectValue placeholder="Choose connection" /></SelectTrigger>
                <SelectContent>
                  {eligibleTargetConnections.map((connection) => (
                    <SelectItem key={connection.id} value={connection.id}>
                      {connection.name} · {connection.driver}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            {!sourceSupportsTransfer && (
              <p className="text-[10px] leading-4 text-[hsl(var(--destructive))]">
                {source.driver} does not yet have a verified source paging and type-mapping path.
              </p>
            )}
            {eligibleTargetConnections.length === 0 && (
              <p className="text-[10px] leading-4 wb-muted">
                Add a PostgreSQL, MySQL/MariaDB, SQLite, or DuckDB connection to use bounded table transfer.
              </p>
            )}
            {targetSupportsCatalogs && (
              <label className="block space-y-1">
                <span className="text-[10px] wb-muted">Database</span>
                <Select
                  value={targetDatabase}
                  onValueChange={setTargetDatabase}
                  disabled={isSubmitting || isDatabasesLoading}
                >
                  <SelectTrigger className={fieldClass}>
                    <SelectValue
                      placeholder={
                        isDatabasesLoading
                          ? "Loading databases…"
                          : "Choose database"
                      }
                    />
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
            <label className="block space-y-1">
              <span className="text-[10px] wb-muted">Schema</span>
              <Select value={targetSchema} onValueChange={setTargetSchema} disabled={isSubmitting || isSchemasLoading}>
                <SelectTrigger className={fieldClass}><SelectValue placeholder={isSchemasLoading ? "Loading schemas…" : "Choose schema"} /></SelectTrigger>
                <SelectContent>
                  {schemas.map((schema) => <SelectItem key={schema} value={schema}>{schema}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] wb-muted">Target table</span>
              <Select
                value={targetTableMode}
                onValueChange={(value) =>
                  handleTargetTableModeChange(value as "existing" | "new")
                }
                disabled={isSubmitting || isTablesLoading}
              >
                <SelectTrigger className={fieldClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="existing">Use existing table</SelectItem>
                  {targetSupportsGeneratedTable && (
                    <SelectItem value="new">Create new table…</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </label>
            {targetTableMode === "existing" ? (
              <label className="block space-y-1">
                <span className="text-[10px] wb-muted">Existing table</span>
                <Select value={targetTable} onValueChange={setTargetTable} disabled={isSubmitting || isTablesLoading}>
                  <SelectTrigger className={fieldClass}><SelectValue placeholder={isTablesLoading ? "Loading tables…" : "Choose table"} /></SelectTrigger>
                  <SelectContent>
                    {tables.map((table) => <SelectItem key={table} value={table}>{table}</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>
            ) : (
              <label className="block space-y-1">
                <span className="text-[10px] wb-muted">New table name</span>
                <input
                  className={fieldClass}
                  value={targetTable}
                  onChange={(event) => {
                    setTargetTable(event.target.value);
                    setTargetPlan(null);
                    setTargetPlanPreviewKey("");
                    setTargetPlanConfirmation("");
                    resetTransferReview();
                  }}
                  placeholder="e.g. copied_table"
                  disabled={isSubmitting}
                />
              </label>
            )}
            {targetTableMode === "existing" && (
              <>
                <label className="block space-y-1">
                  <span className="text-[10px] wb-muted">Transfer mode</span>
                  <Select
                    value={mode}
                    onValueChange={(value) =>
                      handleModeChange(value as "append" | "overwrite")
                    }
                    disabled={isSubmitting}
                  >
                    <SelectTrigger className={fieldClass}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="append">Append rows</SelectItem>
                      <SelectItem value="overwrite">Replace target rows</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block space-y-1">
                    <span className="text-[10px] wb-muted">Row limit</span>
                    <input className={fieldClass} inputMode="numeric" value={maxRows} onChange={(event) => setMaxRows(event.target.value)} disabled={isSubmitting} />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[10px] wb-muted">Batch size</span>
                    <input className={fieldClass} inputMode="numeric" value={batchSize} onChange={(event) => setBatchSize(event.target.value)} disabled={isSubmitting} />
                  </label>
                </div>
                <p className="text-[10px] leading-4 wb-muted">
                  Transfer streams bounded batches through one target transaction and commits only after every step succeeds. {mode === "overwrite" ? "Replace mode deletes the previewed target rows inside that transaction and rolls the deletion back on failure." : "Append mode leaves existing rows unchanged."} Only verified paging, binding, and transaction paths are listed.
                </p>
              </>
            )}
          </section>

          <section className="min-w-0 p-4">
            <div className="mb-3 text-[11px] font-medium">Review</div>
            {targetTableMode === "new" ? (
              !targetPlan ? (
                <div className="space-y-3 text-[10px]">
                  <p className="leading-4 wb-muted">
                    Generate a target-dialect CREATE TABLE plan from the source metadata. No DDL runs during preview.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-[10px]"
                    onClick={handlePreviewTarget}
                    disabled={
                      isSubmitting ||
                      !targetPlanRequest ||
                      !targetSchema.trim() ||
                      !targetTable.trim()
                    }
                  >
                    {isSubmitting ? (
                      <Loader2 size={12} className="mr-1.5 animate-spin" />
                    ) : (
                      <FilePlus2 size={12} className="mr-1.5" />
                    )}
                    Review create table
                  </Button>
                </div>
              ) : (
                <div className="space-y-3 text-[10px]">
                  <div className="rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] p-2">
                    <div className="mb-1 font-medium">
                      {targetPlan.columns.length} generated column(s)
                    </div>
                    <div className="max-h-36 overflow-auto font-mono leading-5 wb-muted">
                      {targetPlan.columns.map((column) => (
                        <div
                          key={column.name}
                          className="border-b border-[hsl(var(--wb-border-subtle))] py-1 last:border-b-0"
                          title={column.reason}
                        >
                          <div className="truncate">
                            {column.name}: {column.sourceDataType || "unknown"} → {column.targetDataType}
                            {column.targetLength ? `(${column.targetLength})` : ""}
                          </div>
                          <div className="truncate text-[9px] wb-muted">
                            {column.isPrimaryKey ? "primary key · " : ""}
                            {column.isNotNull ? "not null · " : "nullable · "}
                            {column.reason}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] p-2 font-mono leading-4 text-[hsl(var(--wb-text-muted))]">
                    {targetPlan.statements.join("\n\n")}
                  </pre>
                  {targetPlan.warnings.map((warning) => (
                    <p key={warning} className="leading-4 wb-muted">
                      {warning}
                    </p>
                  ))}
                  {targetPlanPreviewKey !== targetPlanRequestKey && (
                    <p className="leading-4 text-[hsl(var(--wb-warning))]">
                      The target definition changed after preview. Review it again.
                    </p>
                  )}
                  <label className="block space-y-1">
                    <span className="text-[10px] wb-muted">
                      Type{" "}
                      <code className="select-all text-[hsl(var(--wb-text))]">
                        {targetPlan.confirmationToken}
                      </code>{" "}
                      to create this empty table
                    </span>
                    <input
                      className={fieldClass}
                      value={targetPlanConfirmation}
                      onChange={(event) =>
                        setTargetPlanConfirmation(event.target.value)
                      }
                      autoComplete="off"
                      spellCheck={false}
                      disabled={
                        isSubmitting ||
                        targetPlanPreviewKey !== targetPlanRequestKey
                      }
                    />
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 text-[10px]"
                    onClick={handleCreateTarget}
                    disabled={
                      isSubmitting ||
                      targetPlanPreviewKey !== targetPlanRequestKey ||
                      targetPlanConfirmation.trim() !==
                        targetPlan.confirmationToken
                    }
                  >
                    {isCreatingTarget && (
                      <Loader2 size={12} className="mr-1.5 animate-spin" />
                    )}
                    Create empty target table
                  </Button>
                </div>
              )
            ) : !preview ? (
              <p className="text-[10px] leading-4 wb-muted">Preview reads both table definitions, checks required columns, and creates a one-time confirmation for this exact plan.</p>
            ) : (
              <div className="space-y-3 text-[10px]">
                <div className="rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] p-2">
                  <div className="mb-1 font-medium">
                    {preview.previewRows} sample row(s) · limit {preview.maxRows.toLocaleString()}
                    {preview.targetRowsToDelete != null
                      ? ` · deletes ${preview.targetRowsToDelete.toLocaleString()} target row(s)`
                      : ""}
                  </div>
                  <div className="max-h-40 overflow-auto font-mono leading-5 wb-muted">
                    {preview.mappedColumns.map((mapping) => (
                      <div
                        key={`${mapping.source}:${mapping.target}`}
                        className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 border-b border-[hsl(var(--wb-border-subtle))] py-1 last:border-b-0"
                        title={mapping.reason}
                      >
                        <span className="min-w-0 truncate">
                          {mapping.source} <span className="wb-muted">({mapping.sourceDataType || "unknown"})</span>
                          {" → "}
                          {mapping.target} <span className="wb-muted">({mapping.targetDataType || mapping.dataType || "unknown"})</span>
                        </span>
                        <span className={transferCompatibilityClass(mapping.compatibility)}>
                          {mapping.compatibility}
                        </span>
                        <span className="col-span-2 truncate text-[9px] wb-muted">
                          {mapping.conversion === "none"
                            ? "No conversion"
                            : mapping.conversion.replace(/([A-Z])/g, " $1").toLowerCase()}
                          {" · "}
                          {mapping.reason}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                {!preview.canExecute && (
                  <p className="leading-4 text-[hsl(var(--destructive))]">
                    This plan contains an unsupported type conversion. Change the target column type and preview again.
                  </p>
                )}
                {!planIsCurrent && (
                  <p className="leading-4 text-[hsl(var(--wb-warning))]">
                    Transfer settings changed after preview. Preview the current plan again.
                  </p>
                )}
                {progress && (
                  <div className="space-y-1 border-t border-[hsl(var(--wb-border-subtle))] pt-2">
                    <div className="flex items-center justify-between wb-muted">
                      <span>
                        {progress.status === "running"
                          ? "Transferring"
                          : progress.status === "done"
                            ? "Transfer complete"
                            : progress.status === "cancelled"
                              ? "Transfer cancelled"
                              : "Transfer failed"}
                      </span>
                      <span>
                        {progress.rowsTransferred.toLocaleString()} rows · {progress.batches} batch(es) · limit {progress.maxRows.toLocaleString()}
                      </span>
                    </div>
                    <div
                      className="h-1 overflow-hidden rounded-full bg-[hsl(var(--wb-border-subtle))]"
                      role="progressbar"
                      aria-label="Table data transfer progress"
                      aria-valuemin={0}
                      aria-valuemax={progress.maxRows}
                      aria-valuenow={Math.min(progress.rowsTransferred, progress.maxRows)}
                    >
                      <div
                        className="h-full bg-[hsl(var(--wb-accent))] transition-[width] duration-150"
                        style={{
                          width: `${progress.status === "done" ? 100 : Math.min(100, (progress.rowsTransferred / Math.max(1, progress.maxRows)) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
                {preview.warnings.map((warning) => <p key={warning} className="leading-4 wb-muted">{warning}</p>)}
                <label className="block space-y-1">
                  <span className="text-[10px] wb-muted">Type <code className="select-all text-[hsl(var(--wb-text))]">{preview.confirmationToken}</code> to {mode === "overwrite" ? "replace target rows" : "append rows"}</span>
                  <input className={fieldClass} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" spellCheck={false} disabled={isSubmitting || !preview.canExecute || !planIsCurrent} />
                </label>
              </div>
            )}
          </section>
        </div>

        {error && <div role="alert" className="flex items-start gap-2 border-t border-[hsl(var(--destructive)/0.3)] bg-[hsl(var(--destructive)/0.08)] px-4 py-2 text-[10px] text-[hsl(var(--destructive))]"><AlertCircle size={13} className="mt-0.5 shrink-0" />{error}</div>}

        <DialogFooter className="border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-4 py-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-[11px]"
            onClick={isExecuting ? () => void handleCancelTransfer() : onClose}
            disabled={(isSubmitting && !isExecuting) || isCancelling}
          >
            {isExecuting
              ? isCancelling
                ? "Cancelling…"
                : "Cancel transfer"
              : "Cancel"}
          </Button>
          {targetTableMode === "new" ? null : !preview ? (
            <Button type="button" size="sm" className="h-7 text-[11px]" onClick={() => void handlePreview()} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 size={13} className="animate-spin" /> : "Preview transfer"}
            </Button>
          ) : (
            <Button type="button" size="sm" className="h-7 text-[11px]" onClick={() => void handleTransfer()} disabled={!canExecute}>
              {isSubmitting ? <Loader2 size={13} className="animate-spin" /> : mode === "overwrite" ? "Replace target rows" : "Append rows"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
