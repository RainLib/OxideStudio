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
import { Checkbox } from "@/components/ui/checkbox";
import { ensureConnectionReady, type ConnectionConfig } from "@/store/useConnectionStore";
import { databaseService, schemaService, tableService } from "@/services/tauri";
import type {
  DatabaseCapabilities,
  TableDataTransferBatchExecuteRequest,
  TableDataTransferBatchPlan,
  TableDataTransferEndpoint,
  TableDataTransferMode,
  TableDataTransferProgress,
  TableDataTransferPreview,
  TableDataTransferReport,
  TableDataTransferTargetPlan,
  TableDataTransferTargetPlanRequest,
} from "@/services/tauri/types";

interface TableDataTransferDialogProps {
  open: boolean;
  projectId?: string | null;
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

export function supportsTableDataTransferUpsert(
  distribution: "bundled" | "external" | null,
) {
  return distribution === "bundled";
}

function supportsPostgresIdentityReseed(driver: string | undefined) {
  return new Set(["postgres", "postgresql", "pgsql"]).has(
    driver?.trim().toLocaleLowerCase() || "",
  );
}

/**
 * A transfer report is deliberately not an executable job. It can only seed a
 * fresh review when this dialog is still opened for the same source relation;
 * the target's current metadata and a new confirmation token remain the
 * authority before any rows can be written.
 */
export function canRetryTableDataTransferReport(
  report: TableDataTransferReport,
  source: TableDataTransferEndpoint,
) {
  return (
    report.source.connectionId === source.connectionId &&
    report.source.driver === source.driver &&
    report.source.database === source.database &&
    report.source.schema === source.schema &&
    report.source.table === source.table
  );
}

export function TableDataTransferDialog({
  open,
  projectId,
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
  const [mode, setMode] = useState<TableDataTransferMode>("append");
  const [maxRows, setMaxRows] = useState("1000");
  const [batchSize, setBatchSize] = useState("250");
  const [reseedIdentity, setReseedIdentity] = useState(false);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [databases, setDatabases] = useState<string[]>([]);
  const [targetCapabilities, setTargetCapabilities] =
    useState<DatabaseCapabilities | null>(null);
  const [targetDistribution, setTargetDistribution] = useState<
    "bundled" | "external" | null
  >(null);
  const [externalTransferConnectionIds, setExternalTransferConnectionIds] =
    useState<Set<string>>(() => new Set());
  const [isDatabasesLoading, setIsDatabasesLoading] = useState(false);
  const [isSchemasLoading, setIsSchemasLoading] = useState(false);
  const [tables, setTables] = useState<string[]>([]);
  const [sourceTables, setSourceTables] = useState<string[]>([]);
  const [selectedSourceTables, setSelectedSourceTables] = useState<Set<string>>(
    () => new Set([source.table]),
  );
  const [isTablesLoading, setIsTablesLoading] = useState(false);
  const [preview, setPreview] = useState<TableDataTransferPreview | null>(null);
  const [previewRequestKey, setPreviewRequestKey] = useState("");
  const [batchPlan, setBatchPlan] = useState<TableDataTransferBatchPlan | null>(null);
  const [batchPlanRequestKey, setBatchPlanRequestKey] = useState("");
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
  const [recentReports, setRecentReports] =
    useState<TableDataTransferReport[]>([]);
  const [pendingRetryTargetTable, setPendingRetryTargetTable] = useState<
    string | null
  >(null);
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
  const isBatchTransfer = selectedSourceTables.size > 1;

  useEffect(() => {
    if (!open || !sourceSupportsTransfer) return;
    let cancelled = false;
    void (async () => {
      try {
        const readiness = await ensureConnectionReady(source.connectionId);
        if (readiness.status !== "ready" || cancelled) return;
        const items = source.database
          ? await schemaService.getDatabaseTables(
              source.connectionId,
              source.database,
              source.schema,
            )
          : await schemaService.getTables(source.connectionId, source.schema);
        if (cancelled) return;
        const names = items
          .filter((item) => !item.type?.toUpperCase().includes("VIEW"))
          .map((item) => item.name)
          .sort((left, right) => left.localeCompare(right));
        if (!names.includes(source.table)) names.unshift(source.table);
        setSourceTables(names);
        setSelectedSourceTables((current) => {
          const selected = [...current].filter((table) => names.includes(table));
          return new Set(selected.length > 0 ? selected : [source.table]);
        });
      } catch {
        // The active source remains usable for a single-table transfer even
        // when the optional multi-select inventory could not be refreshed.
        if (!cancelled) setSourceTables([source.table]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, source, sourceSupportsTransfer]);

  useEffect(() => {
    if (!open || !projectId || !targetConnectionId) {
      setRecentReports([]);
      return;
    }
    let active = true;
    void tableService
      .listTableDataTransferReports(projectId, targetConnectionId, 5)
      .then((reports) => {
        if (active) setRecentReports(reports);
      })
      .catch(() => {
        // History is an audit convenience. A transient local-store failure
        // must never make an otherwise valid transfer target unavailable.
        if (active) setRecentReports([]);
      });
    return () => {
      active = false;
    };
  }, [open, projectId, targetConnectionId]);

  const request = useMemo(() => {
    if (!targetConnection) return null;
    return {
      projectId: projectId || undefined,
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
      reseedIdentity,
    };
  }, [
    batchSize,
    maxRows,
    mode,
    projectId,
    reseedIdentity,
    source,
    transferId,
    targetConnection,
    targetDatabase,
    targetSchema,
    targetTable,
  ]);
  const batchRequest = useMemo<TableDataTransferBatchExecuteRequest | null>(() => {
    if (!targetConnection || selectedSourceTables.size < 2) return null;
    return {
      projectId: projectId || undefined,
      transferId,
      plan: {
        sourceConnectionId: source.connectionId,
        sourceDriver: source.driver,
        sourceDatabase: source.database,
        sourceSchema: source.schema,
        targetConnectionId: targetConnection.id,
        targetDriver: targetConnection.driver,
        targetDatabase: targetDatabase || undefined,
        targetSchema,
        tables: [...selectedSourceTables].sort((left, right) =>
          left.localeCompare(right),
        ),
        mode,
        maxRows: Number.parseInt(maxRows, 10) || undefined,
        batchSize: Number.parseInt(batchSize, 10) || undefined,
        reseedIdentity,
      },
    };
  }, [
    batchSize,
    maxRows,
    mode,
    reseedIdentity,
    projectId,
    selectedSourceTables,
    source,
    targetConnection,
    targetDatabase,
    targetSchema,
    transferId,
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
  const batchRequestKey = useMemo(
    () => (batchRequest ? JSON.stringify(batchRequest.plan) : ""),
    [batchRequest],
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
    setReseedIdentity(false);
    setSchemas([]);
    setDatabases([]);
    setTargetCapabilities(null);
    setTargetDistribution(null);
    setTables([]);
    setSourceTables([]);
    setSelectedSourceTables(new Set([source.table]));
    setPreview(null);
    setPreviewRequestKey("");
    setBatchPlan(null);
    setBatchPlanRequestKey("");
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
    setPendingRetryTargetTable(null);
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
    setTargetDistribution(null);
    setDatabases([]);
    setTargetDatabase("");
    setIsDatabasesLoading(true);
    setSchemas([]);
    setTables([]);
    setTargetTable("");
    setTargetTableMode("existing");
    setMode("append");
    setReseedIdentity(false);
    setTargetPlan(null);
    setTargetPlanPreviewKey("");
    setTargetPlanConfirmation("");
    setError(null);
    void (async () => {
      try {
        const readiness = await ensureConnectionReady(targetConnectionId);
        if (readiness.status === "error") throw new Error(readiness.message);
        if (readiness.status === "cancelled" || cancelled) return;
        let capabilities: DatabaseCapabilities;
        if (
          typeof databaseService.getConnectionDatabaseCapabilityContext ===
          "function"
        ) {
          const context =
            await databaseService.getConnectionDatabaseCapabilityContext(
              targetConnectionId,
            );
          capabilities = context.capabilities;
          if (!cancelled) setTargetDistribution(context.distribution);
        } else {
          capabilities = await databaseService.getDatabaseCapabilities(
            targetConnection?.driver || "postgres",
            targetConnection?.driverPackageVersion,
          );
        }
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
          if (
            pendingRetryTargetTable &&
            names.includes(pendingRetryTargetTable)
          ) {
            setTargetTable(pendingRetryTargetTable);
            setPendingRetryTargetTable(null);
          } else {
            setTargetTable(names[0] || "");
            if (pendingRetryTargetTable) {
              setPendingRetryTargetTable(null);
              setError(
                `The previous target table ${pendingRetryTargetTable} is no longer available. Choose a current target table before previewing.`,
              );
            }
          }
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
    setBatchPlan(null);
    setBatchPlanRequestKey("");
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
    if ((!isBatchTransfer && !request) || (isBatchTransfer && !batchRequest) || !targetSchema.trim() || (!isBatchTransfer && !targetTable.trim())) {
      setError(isBatchTransfer
        ? "Choose a target connection and schema before previewing the selected tables."
        : "Choose a target connection, schema, and table before previewing.");
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
    setBatchPlan(null);
    setBatchPlanRequestKey("");
    setProgress(null);
    setConfirmation("");
    try {
      if (isBatchTransfer && batchRequest) {
        const nextPlan = await tableService.previewTableDataTransferBatchPlan(
          batchRequest.plan,
        );
        setBatchPlan(nextPlan);
        setBatchPlanRequestKey(batchRequestKey);
      } else if (request) {
        const nextPreview = await tableService.previewTableDataTransfer(request);
        setPreview(nextPreview);
        setPreviewRequestKey(requestKey);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleModeChange = (nextMode: TableDataTransferMode) => {
    setMode(nextMode);
    setReseedIdentity(false);
    setPreview(null);
    setPreviewRequestKey("");
    setConfirmation("");
    setProgress(null);
  };

  const toggleSourceTable = (table: string, checked: boolean) => {
    if (checked) {
      // A generated single target cannot safely stand in for several target
      // relations. Batch transfer always maps source tables to existing,
      // same-named target tables in the selected schema.
      setTargetTableMode("existing");
      setTargetPlan(null);
      setTargetPlanPreviewKey("");
      setTargetPlanConfirmation("");
    }
    setSelectedSourceTables((current) => {
      const next = new Set(current);
      if (checked) next.add(table);
      else if (next.size > 1) next.delete(table);
      return next;
    });
    resetTransferReview();
    setError(null);
  };

  const handleRetryReport = (report: TableDataTransferReport) => {
    if (!canRetryTableDataTransferReport(report, source)) return;
    if (report.target.connectionId !== targetConnectionId) return;
    if (
      report.mode === "upsert" &&
      !supportsTableDataTransferUpsert(targetDistribution)
    ) {
      setError(
        "This historical upsert was created by a bundled target driver that is no longer active. Choose a supported mode and preview again.",
      );
      return;
    }
    setTransferId(createTableDataTransferId());
    setTargetTableMode("existing");
    setTargetDatabase(report.target.database || "");
    setTargetSchema(report.target.schema);
    setPendingRetryTargetTable(report.target.table);
    setMode(report.mode);
    setReseedIdentity(false);
    setMaxRows(String(report.maxRows));
    setTargetPlan(null);
    setTargetPlanPreviewKey("");
    setTargetPlanConfirmation("");
    resetTransferReview();
    setError(null);
  };

  const handleTransfer = async () => {
    if (isBatchTransfer) {
      if (
        !batchRequest ||
        !batchPlan ||
        batchPlanRequestKey !== batchRequestKey ||
        !batchPlan.canExecute ||
        confirmation.trim() !== batchPlan.confirmationToken
      ) return;
    } else if (!request || !preview || previewRequestKey !== requestKey) {
      return;
    }
    setIsSubmitting(true);
    setIsExecuting(true);
    setIsCancelling(false);
    setError(null);
    try {
      if (isBatchTransfer && batchRequest) {
        await tableService.executeTableDataTransferBatch(batchRequest, confirmation);
      } else if (request) {
        await tableService.executeTableDataTransfer(request, confirmation);
      }
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
  const batchPlanIsCurrent = Boolean(
    batchPlan && batchPlanRequestKey === batchRequestKey,
  );
  const canExecute = isBatchTransfer
    ? Boolean(
        batchPlanIsCurrent &&
          batchPlan?.canExecute &&
          confirmation.trim() === batchPlan.confirmationToken &&
          !isSubmitting,
      )
    : planIsCurrent &&
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
            {sourceTables.length > 1 && (
              <div className="space-y-1.5 rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-medium">Source tables</span>
                  <span className="text-[9px] wb-muted">
                    {selectedSourceTables.size} selected
                  </span>
                </div>
                <div className="max-h-24 space-y-1 overflow-auto pr-1 text-[10px]">
                  {sourceTables.map((table) => (
                    <label key={table} className="flex cursor-pointer items-center gap-1.5">
                      <Checkbox
                        checked={selectedSourceTables.has(table)}
                        onCheckedChange={(checked) =>
                          toggleSourceTable(table, checked === true)
                        }
                        disabled={isSubmitting || (selectedSourceTables.size === 1 && selectedSourceTables.has(table))}
                      />
                      <span className="truncate" title={table}>{table}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
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
                disabled={isSubmitting || isTablesLoading || isBatchTransfer}
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
                <Select value={targetTable} onValueChange={setTargetTable} disabled={isSubmitting || isTablesLoading || isBatchTransfer}>
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
                      handleModeChange(value as TableDataTransferMode)
                    }
                    disabled={isSubmitting}
                  >
                    <SelectTrigger className={fieldClass}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="append">Append rows</SelectItem>
                      <SelectItem value="overwrite">Replace target rows</SelectItem>
                      {supportsTableDataTransferUpsert(targetDistribution) && (
                        <SelectItem value="upsert">Upsert by target primary key</SelectItem>
                      )}
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
                {supportsPostgresIdentityReseed(targetConnection?.driver) && (
                  <label className="flex items-start gap-2 rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] p-2 text-[10px] leading-4">
                    <Checkbox
                      checked={reseedIdentity}
                      onCheckedChange={(checked) => {
                        setReseedIdentity(checked === true);
                        resetTransferReview();
                      }}
                      disabled={isSubmitting}
                    />
                    <span>
                      Synchronize PostgreSQL serial/identity generators after copy. This runs inside the same target transaction and is included in the confirmation plan.
                    </span>
                  </label>
                )}
                <p className="text-[10px] leading-4 wb-muted">
                  Transfer streams bounded batches through one target transaction and commits only after every step succeeds. {mode === "overwrite" ? "Replace mode deletes the previewed target rows inside that transaction and rolls the deletion back on failure." : mode === "upsert" ? "Upsert mode uses the target table's declared primary key and updates only mapped non-key columns." : "Append mode leaves existing rows unchanged."} Only verified paging, binding, and transaction paths are listed.
                </p>
                {isBatchTransfer && (
                  <p className="text-[10px] leading-4 text-[hsl(var(--wb-warning))]">
                    Batch transfer writes each selected source table to the same-named existing table in the target schema. New-table generation is intentionally unavailable for a multi-table transaction.
                  </p>
                )}
              </>
            )}
          </section>

          <section className="min-w-0 p-4">
            <div className="mb-3 text-[11px] font-medium">Review</div>
            {recentReports.length > 0 && targetTableMode === "existing" && (
              <div className="mb-3 space-y-1 rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] p-2 text-[10px]">
                <p className="font-medium wb-muted">Recent target transfer history</p>
                {recentReports.map((report) => {
                  const retryable = canRetryTableDataTransferReport(report, source);
                  return (
                    <div key={report.id} className="flex items-center justify-between gap-2 leading-4">
                      <span
                        className="min-w-0 truncate wb-muted"
                        title={`${report.source.schema}.${report.source.table} → ${report.rowsTransferred.toLocaleString()} rows`}
                      >
                        {report.status} · {report.source.schema}.{report.source.table} · {report.rowsTransferred.toLocaleString()} rows
                      </span>
                      {report.verification && (
                        <span
                          className={
                            report.verification.status === "verified"
                              ? "shrink-0 text-[hsl(var(--wb-success))]"
                              : report.verification.status === "needsReview"
                                ? "shrink-0 text-[hsl(var(--wb-warning))]"
                                : "shrink-0 wb-muted"
                          }
                          title={report.verification.message}
                        >
                          {report.verification.status === "verified"
                            ? "verified"
                            : report.verification.status === "needsReview"
                              ? "review count"
                              : "count n/a"}
                        </span>
                      )}
                      {retryable && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 shrink-0 px-1.5 text-[10px]"
                          disabled={isSubmitting}
                          onClick={() => handleRetryReport(report)}
                        >
                          Retry setup
                        </Button>
                      )}
                    </div>
                  );
                })}
                <p className="leading-4 wb-muted">
                  Retry setup always requires a fresh preview and confirmation.
                </p>
              </div>
            )}
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
            ) : isBatchTransfer ? (
              !batchPlan ? (
                <p className="text-[10px] leading-4 wb-muted">
                  Batch preview reads every selected source/target definition, derives a parent-first foreign-key order, and binds every mapping into one confirmation token. No rows are written during preview.
                </p>
              ) : (
                <div className="space-y-3 text-[10px]">
                  <div className="rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] p-2">
                    <div className="mb-1 font-medium">
                      {batchPlan.orderedTables.length} table(s) in dependency order
                    </div>
                    <div className="max-h-40 space-y-1 overflow-auto font-mono leading-4 wb-muted">
                      {batchPlan.orderedTables.map((table) => {
                        const preflight = batchPlan.tablePreflights.find(
                          (item) => item.table === table,
                        );
                        return (
                          <div key={table} className="flex items-center justify-between gap-2 border-b border-[hsl(var(--wb-border-subtle))] py-1 last:border-b-0">
                            <span className="truncate">{table}</span>
                            <span className={preflight?.canExecute ? "text-[hsl(var(--wb-success))]" : "text-[hsl(var(--destructive))]"}>
                              {preflight?.canExecute ? `${preflight.mappedColumns} mapped` : "blocked"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  {batchPlan.cyclicTables.length > 0 && (
                    <p className="leading-4 text-[hsl(var(--destructive))]">
                      Foreign-key cycle: {batchPlan.cyclicTables.join(", ")}. This target driver has no reviewed deferred-constraints policy.
                    </p>
                  )}
                  {!batchPlan.canExecute && (
                    <p className="leading-4 text-[hsl(var(--destructive))]">
                      At least one selected table has no executable source-to-target mapping. Correct the target schema and preview again.
                    </p>
                  )}
                  {!batchPlanIsCurrent && (
                    <p className="leading-4 text-[hsl(var(--wb-warning))]">
                      Batch settings changed after preview. Review the current plan again.
                    </p>
                  )}
                  {batchPlan.warnings.map((warning) => (
                    <p key={warning} className="leading-4 wb-muted">{warning}</p>
                  ))}
                  {progress && (
                    <div className="space-y-1 border-t border-[hsl(var(--wb-border-subtle))] pt-2">
                      <div className="flex items-center justify-between wb-muted">
                        <span>{progress.status === "running" ? "Transferring selected tables" : progress.status === "done" ? "Batch transfer complete" : progress.status === "cancelled" ? "Batch transfer cancelled" : "Batch transfer failed"}</span>
                        <span>{progress.rowsTransferred.toLocaleString()} rows · {progress.batches} batch(es)</span>
                      </div>
                      <div className="h-1 overflow-hidden rounded-full bg-[hsl(var(--wb-border-subtle))]" role="progressbar" aria-label="Batch table data transfer progress" aria-valuemin={0} aria-valuemax={progress.maxRows} aria-valuenow={Math.min(progress.rowsTransferred, progress.maxRows)}>
                        <div className="h-full bg-[hsl(var(--wb-accent))] transition-[width] duration-150" style={{ width: `${progress.status === "done" ? 100 : Math.min(100, (progress.rowsTransferred / Math.max(1, progress.maxRows)) * 100)}%` }} />
                      </div>
                    </div>
                  )}
                  <label className="block space-y-1">
                    <span className="text-[10px] wb-muted">
                      Type <code className="select-all text-[hsl(var(--wb-text))]">{batchPlan.confirmationToken}</code> to execute one atomic batch transaction
                    </span>
                    <input
                      className={fieldClass}
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                      disabled={isSubmitting || !batchPlan.canExecute || !batchPlanIsCurrent}
                    />
                  </label>
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
                    {preview.upsertKeyColumns.length > 0
                      ? ` · conflict key ${preview.upsertKeyColumns.join(", ")}`
                      : ""}
                    {preview.identityReseedColumns.length > 0
                      ? ` · synchronizes ${preview.identityReseedColumns.join(", ")}`
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
                  <span className="text-[10px] wb-muted">Type <code className="select-all text-[hsl(var(--wb-text))]">{preview.confirmationToken}</code> to {mode === "overwrite" ? "replace target rows" : mode === "upsert" ? "upsert rows by primary key" : "append rows"}</span>
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
          {targetTableMode === "new" && !isBatchTransfer ? null : !(isBatchTransfer ? batchPlan : preview) ? (
            <Button type="button" size="sm" className="h-7 text-[11px]" onClick={() => void handlePreview()} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 size={13} className="animate-spin" /> : "Preview transfer"}
            </Button>
          ) : (
            <Button type="button" size="sm" className="h-7 text-[11px]" onClick={() => void handleTransfer()} disabled={!canExecute}>
              {isSubmitting ? <Loader2 size={13} className="animate-spin" /> : isBatchTransfer ? "Transfer selected tables" : mode === "overwrite" ? "Replace target rows" : mode === "upsert" ? "Upsert rows" : "Append rows"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
