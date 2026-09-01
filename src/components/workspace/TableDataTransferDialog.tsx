import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRightLeft,
  CheckCircle2,
  Database,
  FilePlus2,
  ListChecks,
  Loader2,
  ShieldAlert,
} from "lucide-react";
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
import { resolveInitialTransferTableSelection } from "@/features/database-explorer/model/tableTransferSelection";
import { canConfigureUnquotedTransferTargetColumns } from "@/lib/tableDataTransferPolicy";
import { ensureConnectionReady, type ConnectionConfig } from "@/store/useConnectionStore";
import { databaseService, schemaService, tableService } from "@/services/tauri";
import type {
  DatabaseCapabilities,
  FunctionInfo,
  SchemaObjectInfo,
  TableDataTransferBatchExecuteRequest,
  TableDataTransferBatchPlan,
  TableDataTransferEndpoint,
  TableDataTransferMode,
  TableDataTransferObjectKind,
  TableDataTransferObjectSelection,
  TableDataTransferProgress,
  TableDataTransferPreview,
  TableDataTransferReport,
  TableDataTransferTargetPlan,
  TableDataTransferTargetPlanRequest,
  TableInfo,
} from "@/services/tauri/types";

interface TableDataTransferDialogProps {
  open: boolean;
  projectId?: string | null;
  source: TableDataTransferEndpoint;
  initialSourceScope?: "table" | "schema" | "database";
  initialSourceTables?: string[];
  initialTarget?: Omit<TableDataTransferEndpoint, "table">;
  sourceSchemas?: string[];
  sourceCapabilities?: DatabaseCapabilities | null;
  connections: ConnectionConfig[];
  onClose: () => void;
  onTransferred: () => void;
}

const fieldClass =
  "h-7 w-full rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 text-[11px] text-[hsl(var(--wb-text))] outline-none placeholder:text-[hsl(var(--wb-text-muted))] focus:border-[hsl(var(--wb-accent))]";
const settingsRowClass =
  "grid gap-1 sm:grid-cols-[132px_minmax(0,1fr)] sm:items-center";

type TransferDialogSection = "setup" | "review";

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
  distribution: "bundled" | "external" | "managed" | null,
) {
  return distribution === "bundled";
}

function supportsPostgresIdentityReseed(driver: string | undefined) {
  return new Set(["postgres", "postgresql", "pgsql"]).has(
    driver?.trim().toLocaleLowerCase() || "",
  );
}

function transferSchemaRestoreFamily(driver: string | undefined) {
  const normalized = driver?.trim().toLocaleLowerCase() || "";
  if (new Set(["postgres", "postgresql", "pgsql"]).has(normalized)) {
    return "postgres";
  }
  if (new Set(["mysql", "mariadb"]).has(normalized)) return "mysql";
  return null;
}

const transferObjectKindOrder: TableDataTransferObjectKind[] = [
  "SEQUENCE",
  "VIEW",
  "MATERIALIZED_VIEW",
  "FUNCTION",
  "PROCEDURE",
  "TRIGGER",
  "EVENT",
];

function transferObjectKey(object: TableDataTransferObjectSelection) {
  return `${object.objectType}:${object.parentName || ""}:${object.name}`;
}

export function buildTransferObjectInventory(
  relations: TableInfo[],
  routines: FunctionInfo[],
  descriptors: SchemaObjectInfo[],
): TableDataTransferObjectSelection[] {
  const inventory: TableDataTransferObjectSelection[] = [];
  for (const relation of relations) {
    const objectType = relation.type?.trim().toLocaleUpperCase() || "";
    if (objectType.includes("MATERIALIZED") && objectType.includes("VIEW")) {
      inventory.push({ objectType: "MATERIALIZED_VIEW", name: relation.name });
    } else if (objectType.includes("VIEW")) {
      inventory.push({ objectType: "VIEW", name: relation.name });
    }
  }
  for (const routine of routines) {
    inventory.push({
      objectType: routine.routine_type?.toLocaleLowerCase() === "procedure"
        ? "PROCEDURE"
        : "FUNCTION",
      name: routine.name,
    });
  }
  const descriptorKinds = new Map<string, TableDataTransferObjectKind>([
    ["TRIGGER", "TRIGGER"],
    ["SEQUENCE", "SEQUENCE"],
    ["EVENT", "EVENT"],
  ]);
  for (const descriptor of descriptors) {
    const objectType = descriptorKinds.get(
      descriptor.objectType.trim().toLocaleUpperCase().replace(/ /g, "_"),
    );
    if (!objectType) continue;
    inventory.push({
      objectType,
      name: descriptor.name,
      parentName: descriptor.parentName || undefined,
    });
  }
  const unique = new Map(
    inventory.map((object) => [transferObjectKey(object), object]),
  );
  return [...unique.values()].sort((left, right) => {
    const kindOrder = transferObjectKindOrder.indexOf(left.objectType) -
      transferObjectKindOrder.indexOf(right.objectType);
    if (kindOrder !== 0) return kindOrder;
    return `${left.parentName || ""}:${left.name}`.localeCompare(
      `${right.parentName || ""}:${right.name}`,
    );
  });
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
  initialSourceScope = "table",
  initialSourceTables,
  initialTarget,
  sourceSchemas = [source.schema],
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
  const [quoteTargetColumnNames, setQuoteTargetColumnNames] = useState(true);
  const [restoreSourceSchemaObjects, setRestoreSourceSchemaObjects] =
    useState(false);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [databases, setDatabases] = useState<string[]>([]);
  const [targetCapabilities, setTargetCapabilities] =
    useState<DatabaseCapabilities | null>(null);
  const [targetDistribution, setTargetDistribution] = useState<
    "bundled" | "external" | "managed" | null
  >(null);
  const [externalTransferConnectionIds, setExternalTransferConnectionIds] =
    useState<Set<string>>(() => new Set());
  const [isDatabasesLoading, setIsDatabasesLoading] = useState(false);
  const [isSchemasLoading, setIsSchemasLoading] = useState(false);
  const [tables, setTables] = useState<string[]>([]);
  const [sourceTables, setSourceTables] = useState<string[]>([]);
  const [sourceTransferObjects, setSourceTransferObjects] = useState<
    TableDataTransferObjectSelection[]
  >([]);
  const [selectedTransferObjectKeys, setSelectedTransferObjectKeys] = useState<
    Set<string>
  >(() => new Set());
  const [isSourceObjectsLoading, setIsSourceObjectsLoading] = useState(false);
  const [activeSourceSchema, setActiveSourceSchema] = useState(source.schema);
  const [selectedSourceTables, setSelectedSourceTables] = useState<Set<string>>(
    () =>
      new Set(
        initialSourceTables?.length ? initialSourceTables : [source.table],
      ),
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
  const [activeSection, setActiveSection] =
    useState<TransferDialogSection>("setup");
  const setupSectionRef = useRef<HTMLElement>(null);
  const reviewSectionRef = useRef<HTMLElement>(null);

  const targetConnection = useMemo(
    () =>
      connections.find(
        (connection) => connection.id === targetConnectionId,
      ),
    [connections, targetConnectionId],
  );
  const sourceConnection = useMemo(
    () => connections.find((connection) => connection.id === source.connectionId),
    [connections, source.connectionId],
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
  const selectedSourceTable = useMemo(
    () =>
      [...selectedSourceTables].sort((left, right) =>
        left.localeCompare(right),
      )[0] || source.table,
    [selectedSourceTables, source.table],
  );
  const effectiveSource = useMemo(
    () => ({ ...source, schema: activeSourceSchema, table: selectedSourceTable }),
    [activeSourceSchema, selectedSourceTable, source],
  );
  const canConfigureTargetColumnQuoting = canConfigureUnquotedTransferTargetColumns(
    targetConnection?.driver,
    targetDistribution,
    targetCapabilities,
  );
  const selectedTransferObjects = useMemo(
    () => sourceTransferObjects.filter((object) =>
      selectedTransferObjectKeys.has(transferObjectKey(object))),
    [selectedTransferObjectKeys, sourceTransferObjects],
  );
  const isBatchTransfer =
    selectedSourceTables.size > 1 || selectedTransferObjects.length > 0;
  const canRestoreSourceSchemaObjects = Boolean(
    sourceConnection &&
      targetConnection &&
      !sourceConnection.driverPackageVersion &&
      !targetConnection.driverPackageVersion &&
      transferSchemaRestoreFamily(effectiveSource.driver) &&
      transferSchemaRestoreFamily(effectiveSource.driver) ===
        transferSchemaRestoreFamily(targetConnection.driver) &&
      (isBatchTransfer || effectiveSource.table === targetTable),
  );
  const sourceTransferObjectGroups = useMemo(
    () => transferObjectKindOrder
      .map((kind) => ({
        kind,
        objects: sourceTransferObjects.filter(
          (object) => object.objectType === kind,
        ),
      }))
      .filter((group) => group.objects.length > 0),
    [sourceTransferObjects],
  );

  useEffect(() => {
    if (!open || !sourceSupportsTransfer) return;
    let cancelled = false;
    setIsSourceObjectsLoading(true);
    void (async () => {
      try {
        const readiness = await ensureConnectionReady(source.connectionId);
        if (readiness.status !== "ready" || cancelled) return;
        const relationRequest = source.database
          ? schemaService.getDatabaseTables(
              source.connectionId,
              source.database,
              activeSourceSchema,
            )
          : schemaService.getTables(source.connectionId, activeSourceSchema);
        const routineRequest = source.database &&
          typeof schemaService.getDatabaseFunctions === "function"
          ? schemaService
              .getDatabaseFunctions(
                source.connectionId,
                source.database,
                activeSourceSchema,
              )
              .catch(() => [])
          : typeof schemaService.getFunctions === "function"
            ? schemaService
                .getFunctions(source.connectionId, activeSourceSchema)
                .catch(() => [])
            : Promise.resolve([] as FunctionInfo[]);
        const descriptorRequest = source.database &&
          typeof schemaService.getDatabaseSchemaObjects === "function"
          ? schemaService
              .getDatabaseSchemaObjects(
                source.connectionId,
                source.database,
                activeSourceSchema,
              )
              .catch(() => [])
          : typeof schemaService.getSchemaObjects === "function"
            ? schemaService
                .getSchemaObjects(source.connectionId, activeSourceSchema)
                .catch(() => [])
            : Promise.resolve([] as SchemaObjectInfo[]);
        const [items, routines, descriptors] = await Promise.all([
          relationRequest,
          routineRequest,
          descriptorRequest,
        ]);
        if (cancelled) return;
        const names = items
          .filter((item) => !item.type?.toUpperCase().includes("VIEW"))
          .map((item) => item.name)
          .sort((left, right) => left.localeCompare(right));
        const initialTable =
          activeSourceSchema === source.schema && names.includes(source.table)
            ? source.table
            : names[0];
        setSourceTables(names);
        const nextObjects = buildTransferObjectInventory(
          items,
          routines,
          descriptors,
        );
        setSourceTransferObjects(nextObjects);
        setSelectedTransferObjectKeys((current) => {
          const available = new Set(nextObjects.map(transferObjectKey));
          return new Set([...current].filter((key) => available.has(key)));
        });
        setSelectedSourceTables((current) => {
          return resolveInitialTransferTableSelection({
            availableTables: names,
            sourceTable: initialTable || source.table,
            sourceSchemaMatches: activeSourceSchema === source.schema,
            initialScope: initialSourceScope,
            requestedTables: initialSourceTables,
            currentSelection: current,
          });
        });
      } catch {
        // The active source remains usable for a single-table transfer even
        // when the optional multi-select inventory could not be refreshed.
        if (!cancelled && activeSourceSchema === source.schema) {
          setSourceTables([source.table]);
          setSelectedSourceTables(new Set([source.table]));
          setSourceTransferObjects([]);
          setSelectedTransferObjectKeys(new Set());
        }
      } finally {
        if (!cancelled) setIsSourceObjectsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    activeSourceSchema,
    initialSourceScope,
    initialSourceTables,
    open,
    source,
    sourceSupportsTransfer,
  ]);

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
      source: effectiveSource,
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
      quoteTargetColumnNames,
      restoreSourceSchemaObjects,
    };
  }, [
    batchSize,
    maxRows,
    mode,
    projectId,
    reseedIdentity,
    quoteTargetColumnNames,
    restoreSourceSchemaObjects,
    effectiveSource,
    transferId,
    targetConnection,
    targetDatabase,
    targetSchema,
    targetTable,
  ]);
  const batchRequest = useMemo<TableDataTransferBatchExecuteRequest | null>(() => {
    if (
      !targetConnection ||
      (selectedSourceTables.size < 2 && selectedTransferObjects.length === 0)
    ) return null;
    return {
      projectId: projectId || undefined,
      transferId,
      plan: {
        sourceConnectionId: effectiveSource.connectionId,
        sourceDriver: effectiveSource.driver,
        sourceDatabase: effectiveSource.database,
        sourceSchema: effectiveSource.schema,
        targetConnectionId: targetConnection.id,
        targetDriver: targetConnection.driver,
        targetDatabase: targetDatabase || undefined,
        targetSchema,
        tables: [...selectedSourceTables].sort((left, right) =>
          left.localeCompare(right),
        ),
        objects: selectedTransferObjects,
        mode,
        maxRows: Number.parseInt(maxRows, 10) || undefined,
        batchSize: Number.parseInt(batchSize, 10) || undefined,
        reseedIdentity,
        quoteTargetColumnNames,
        restoreSourceSchemaObjects,
      },
    };
  }, [
    batchSize,
    maxRows,
    mode,
    reseedIdentity,
    quoteTargetColumnNames,
    restoreSourceSchemaObjects,
    projectId,
    selectedSourceTables,
    selectedTransferObjects,
    effectiveSource,
    targetConnection,
    targetDatabase,
    targetSchema,
    transferId,
  ]);
  const targetPlanRequest = useMemo<TableDataTransferTargetPlanRequest | null>(
    () =>
      targetConnection && targetTableMode === "new"
        ? {
            source: effectiveSource,
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
      effectiveSource,
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
      (connection) => connection.id === initialTarget?.connectionId,
    ) || eligibleTargetConnections.find(
      (connection) =>
        connection.id !== source.connectionId || connection.driver !== source.driver,
    ) || eligibleTargetConnections.find((connection) => connection.id === source.connectionId);
    setTargetConnectionId(firstTarget?.id || "");
    setActiveSourceSchema(source.schema);
    setTransferId(createTableDataTransferId());
    setTargetDatabase(initialTarget?.database || "");
    setTargetSchema(initialTarget?.schema || source.schema);
    setTargetTable("");
    setTargetTableMode("existing");
    setMode("append");
    setReseedIdentity(false);
    setQuoteTargetColumnNames(true);
    setRestoreSourceSchemaObjects(false);
    setSchemas([]);
    setDatabases([]);
    setTargetCapabilities(null);
    setTargetDistribution(null);
    setTables([]);
    setSourceTables([]);
    setSourceTransferObjects([]);
    setSelectedTransferObjectKeys(new Set());
    setSelectedSourceTables(
      new Set(initialSourceTables?.length ? initialSourceTables : [source.table]),
    );
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
    setActiveSection("setup");
  }, [
    eligibleTargetConnections,
    initialSourceTables,
    initialTarget?.connectionId,
    initialTarget?.database,
    initialTarget?.schema,
    open,
    source.connectionId,
    source.driver,
    source.schema,
    source.table,
  ]);

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
          targetConnectionId === initialTarget?.connectionId
            ? initialTarget.database
            : undefined,
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
    initialTarget?.connectionId,
    initialTarget?.database,
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

  useEffect(() => {
    if (!canRestoreSourceSchemaObjects && restoreSourceSchemaObjects) {
      setRestoreSourceSchemaObjects(false);
      resetTransferReview();
    }
  }, [canRestoreSourceSchemaObjects, restoreSourceSchemaObjects]);

  const handleTargetTableModeChange = (nextMode: "existing" | "new") => {
    setTargetTableMode(nextMode);
    setTargetTable(
      nextMode === "existing" ? (tables[0] || "") : effectiveSource.table,
    );
    setTargetPlan(null);
    setTargetPlanPreviewKey("");
    setTargetPlanConfirmation("");
    setRestoreSourceSchemaObjects(false);
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
      !targetPlan.canExecute ||
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
      setRestoreSourceSchemaObjects(true);
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
      else if (next.size > 1 || selectedTransferObjects.length > 0) {
        next.delete(table);
      }
      return next;
    });
    resetTransferReview();
    setError(null);
  };

  const toggleTransferObject = (
    object: TableDataTransferObjectSelection,
    checked: boolean,
  ) => {
    setTargetTableMode("existing");
    setTargetPlan(null);
    setTargetPlanPreviewKey("");
    setTargetPlanConfirmation("");
    setSelectedTransferObjectKeys((current) => {
      const key = transferObjectKey(object);
      const next = new Set(current);
      if (checked) next.add(key);
      else if (next.size > 1 || selectedSourceTables.size > 0) next.delete(key);
      return next;
    });
    resetTransferReview();
    setError(null);
  };

  const handleRetryReport = (report: TableDataTransferReport) => {
    if (!canRetryTableDataTransferReport(report, effectiveSource)) return;
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
  const hasCurrentReview = isBatchTransfer ? batchPlanIsCurrent : planIsCurrent;
  const destinationReady = Boolean(
    targetConnectionId &&
      targetSchema.trim() &&
      (isBatchTransfer || targetTable.trim()),
  );
  const reviewReady = hasCurrentReview || Boolean(targetPlan);

  useEffect(() => {
    if (!reviewReady) return;
    setActiveSection("review");
    const section = reviewSectionRef.current;
    if (!section?.scrollIntoView) return;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")
      .matches;
    section.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "start",
    });
  }, [reviewReady]);

  const selectSection = (section: TransferDialogSection) => {
    setActiveSection(section);
    const target =
      section === "setup" ? setupSectionRef.current : reviewSectionRef.current;
    if (!target?.scrollIntoView) return;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")
      .matches;
    target.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "start",
    });
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && !isSubmitting && onClose()}>
      <DialogContent className="flex h-[min(740px,calc(100vh-32px))] max-h-none w-[min(960px,calc(100vw-32px))] max-w-none flex-col gap-0 overflow-hidden rounded-[8px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] p-0 text-[12px] text-[hsl(var(--wb-text))] shadow-[0_12px_36px_rgba(0,0,0,0.4)]">
        <DialogHeader className="relative flex h-10 shrink-0 items-center justify-center border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-frame))] px-4 py-0">
          <DialogTitle className="text-[12px] font-semibold tracking-normal text-[hsl(var(--wb-text-muted))]">
            Data transfer
          </DialogTitle>
          <DialogDescription className="sr-only">
            Copy data to a reviewed target table without writing rows until confirmation.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-[200px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col border-r border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))]">
            <div className="border-b border-[hsl(var(--wb-border-subtle))] px-3 py-3">
              <div className="flex items-center gap-1.5 text-[10px] font-medium text-[hsl(var(--wb-text))]">
                <ArrowRightLeft size={13} className="text-[hsl(var(--wb-accent))]" />
                Source
              </div>
              <p className="mt-1 truncate font-mono text-[9px] text-[hsl(var(--wb-text-muted))]" title={displayEndpoint(effectiveSource)}>
                {displayEndpoint(effectiveSource)}
              </p>
              <p className="mt-1 text-[9px] text-[hsl(var(--wb-text-muted))]">
                {selectedSourceTables.size} selected {selectedSourceTables.size === 1 ? "table" : "tables"}
              </p>
            </div>

            <nav className="space-y-0.5 p-1.5" aria-label="Transfer workflow">
              {[
                {
                  id: "setup" as const,
                  label: "Transfer setup",
                  detail: destinationReady
                    ? `${targetConnection?.name || "Target"} · ${targetSchema}`
                    : "Choose destination",
                  complete: destinationReady,
                  Icon: Database,
                },
                {
                  id: "review" as const,
                  label: "Review & confirm",
                  detail: reviewReady
                    ? canExecute
                      ? "Ready to run"
                      : "Review required"
                    : "Preview mapping first",
                  complete: canExecute,
                  Icon: ListChecks,
                },
              ].map(({ id, label, detail, complete, Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => selectSection(id)}
                  aria-current={activeSection === id ? "step" : undefined}
                  className={`flex w-full items-start gap-2 rounded-[4px] px-2 py-2 text-left outline-none transition-colors hover:bg-[hsl(var(--wb-hover))] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[hsl(var(--wb-accent))] motion-reduce:transition-none ${activeSection === id ? "bg-[hsl(var(--wb-active-strong))]" : ""}`}
                >
                  {complete ? (
                    <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-[hsl(var(--wb-accent))]" />
                  ) : (
                    <Icon size={13} className="mt-0.5 shrink-0 text-[hsl(var(--wb-text-muted))]" />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-[10px] font-medium text-[hsl(var(--wb-text))]">{label}</span>
                    <span className="mt-0.5 block truncate text-[9px] text-[hsl(var(--wb-text-muted))]">{detail}</span>
                  </span>
                </button>
              ))}
            </nav>

            <div className="mt-auto border-t border-[hsl(var(--wb-border-subtle))] px-3 py-2.5 text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">
              Preview is read-only. A reviewed token is required before any target rows change.
            </div>
          </aside>

          <main className="flex min-h-0 flex-col bg-[hsl(var(--wb-editor))]">
            <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[hsl(var(--wb-border-subtle))] px-5">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold">
                  Transfer {initialSourceScope === "table" ? "table" : initialSourceScope} data
                </div>
                <p className="mt-0.5 truncate text-[10px] text-[hsl(var(--wb-text-muted))]">
                  {displayEndpoint(effectiveSource)} → {targetTableMode === "new" ? "new target table" : "existing target table"}
                </p>
              </div>
              <span className={`shrink-0 rounded-[3px] px-1.5 py-0.5 text-[9px] ${hasCurrentReview ? "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-accent))]" : "bg-[hsl(var(--wb-hover))] text-[hsl(var(--wb-text-muted))]"}`}>
                {hasCurrentReview ? "Reviewed" : "Draft"}
              </span>
            </div>

            <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
          <section ref={setupSectionRef} className="space-y-4 px-5 py-4">
            <div>
              <div className="text-[12px] font-medium">Transfer setup</div>
              <p className="mt-0.5 text-[10px] wb-muted">Choose where this data will be copied. No data is changed until you confirm a reviewed plan.</p>
            </div>
            {initialSourceScope === "database" && sourceSchemas.length > 1 && (
              <label className="block space-y-1">
                <span className="text-[10px] font-medium">Source schema</span>
                <Select
                  value={activeSourceSchema}
                  onValueChange={(nextSchema) => {
                    setActiveSourceSchema(nextSchema);
                    setSourceTables([]);
                    setSelectedSourceTables(new Set());
                    setSourceTransferObjects([]);
                    setSelectedTransferObjectKeys(new Set());
                    resetTransferReview();
                    setError(null);
                  }}
                  disabled={isSubmitting}
                >
                  <SelectTrigger className={fieldClass}>
                    <SelectValue placeholder="Choose source schema" />
                  </SelectTrigger>
                  <SelectContent>
                    {sourceSchemas.map((schema) => (
                      <SelectItem key={schema} value={schema}>
                        {schema}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="block text-[9px] leading-4 wb-muted">
                  Database entry keeps schema boundaries explicit. Choose a
                  schema, then review all its tables as one bounded batch.
                </span>
              </label>
            )}
            {sourceTables.length > 1 && (
              <div className="space-y-1.5 border-y border-[hsl(var(--wb-border-subtle))] py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-medium">Source scope</span>
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
                        disabled={
                          isSubmitting ||
                          (selectedSourceTables.size === 1 &&
                            selectedSourceTables.has(table) &&
                            selectedTransferObjects.length === 0)
                        }
                      />
                      <span className="truncate" title={table}>{table}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            {(isSourceObjectsLoading || sourceTransferObjectGroups.length > 0) && (
              <div
                className="space-y-2 border-b border-[hsl(var(--wb-border-subtle))] pb-3"
                data-transfer-object-selector
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[10px] font-medium">Schema objects</div>
                    <p className="mt-0.5 text-[9px] leading-4 wb-muted">
                      Optional, explicit selection. Existing target objects are
                      skipped; they are never silently replaced.
                    </p>
                  </div>
                  <span className="shrink-0 text-[9px] wb-muted">
                    {selectedTransferObjects.length} selected
                  </span>
                </div>
                {isSourceObjectsLoading && sourceTransferObjectGroups.length === 0 ? (
                  <div className="flex items-center gap-1.5 text-[9px] wb-muted">
                    <Loader2 size={11} className="animate-spin" />
                    Reading object catalog…
                  </div>
                ) : (
                  <div className="custom-scrollbar max-h-40 space-y-2 overflow-auto pr-1">
                    {sourceTransferObjectGroups.map((group) => (
                      <div key={group.kind} className="space-y-1">
                        <div className="text-[9px] font-medium tracking-wide wb-muted">
                          {group.kind.replace(/_/g, " ")}
                        </div>
                        {group.objects.map((object) => {
                          const key = transferObjectKey(object);
                          const checked = selectedTransferObjectKeys.has(key);
                          return (
                            <label
                              key={key}
                              className="flex cursor-pointer items-center gap-1.5 text-[10px]"
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(nextChecked) =>
                                  toggleTransferObject(
                                    object,
                                    nextChecked === true,
                                  )
                                }
                                disabled={
                                  isSubmitting ||
                                  (checked &&
                                    selectedTransferObjects.length === 1 &&
                                    selectedSourceTables.size === 0)
                                }
                              />
                              <span className="min-w-0 truncate" title={key}>
                                {object.parentName
                                  ? `${object.parentName}.${object.name}`
                                  : object.name}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
                <p className="text-[9px] leading-4 wb-muted">
                  Native PostgreSQL objects use catalog-built DDL and the same
                  transaction as table data. Other driver families remain
                  visible in review but are blocked until their DDL execution
                  contract is verified.
                </p>
              </div>
            )}
            <label className={settingsRowClass}>
              <span className="text-[10px] font-medium">Destination connection</span>
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
              <label className={settingsRowClass}>
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
            <label className={settingsRowClass}>
              <span className="text-[10px] wb-muted">Schema</span>
              <Select value={targetSchema} onValueChange={setTargetSchema} disabled={isSubmitting || isSchemasLoading}>
                <SelectTrigger className={fieldClass}><SelectValue placeholder={isSchemasLoading ? "Loading schemas…" : "Choose schema"} /></SelectTrigger>
                <SelectContent>
                  {schemas.map((schema) => <SelectItem key={schema} value={schema}>{schema}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <label className={settingsRowClass}>
              <span className="text-[10px] font-medium">Destination table</span>
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
              <label className={settingsRowClass}>
                <span className="text-[10px] wb-muted">Existing table</span>
                <Select value={targetTable} onValueChange={setTargetTable} disabled={isSubmitting || isTablesLoading || isBatchTransfer}>
                  <SelectTrigger className={fieldClass}><SelectValue placeholder={isTablesLoading ? "Loading tables…" : "Choose table"} /></SelectTrigger>
                  <SelectContent>
                    {tables.map((table) => <SelectItem key={table} value={table}>{table}</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>
            ) : (
              <label className={settingsRowClass}>
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
                <label className={settingsRowClass}>
                  <span className="text-[10px] font-medium">Copy mode</span>
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
                {mode === "overwrite" && (
                  <p className="flex items-start gap-1.5 rounded-[4px] border border-[hsl(var(--wb-warning)/0.35)] bg-[hsl(var(--wb-warning)/0.08)] px-2 py-1.5 text-[10px] leading-4 text-[hsl(var(--wb-text))]">
                    <ShieldAlert size={13} className="mt-0.5 shrink-0 text-[hsl(var(--wb-warning))]" />
                    Replace deletes destination rows inside the reviewed transaction before copying. Check the preview carefully before confirming.
                  </p>
                )}
                {canConfigureTargetColumnQuoting && (
                  <label className="flex items-start gap-2 rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] p-2 text-[10px] leading-4">
                    <Checkbox
                      checked={quoteTargetColumnNames}
                      onCheckedChange={(checked) => {
                        setQuoteTargetColumnNames(checked === true);
                        resetTransferReview();
                      }}
                      disabled={isSubmitting}
                    />
                    <span>
                      Quote destination column names
                      <span className="mt-0.5 block wb-muted">
                        Disable only when the GaussDB/openGauss target expects
                        unquoted identifiers to fold to lowercase. Reserved or
                        unsafe names remain quoted by the Host.
                      </span>
                    </span>
                  </label>
                )}
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
                {canRestoreSourceSchemaObjects && (
                  <label className="flex items-start gap-2 rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] p-2 text-[10px] leading-4">
                    <Checkbox
                      checked={restoreSourceSchemaObjects}
                      onCheckedChange={(checked) => {
                        setRestoreSourceSchemaObjects(checked === true);
                        resetTransferReview();
                      }}
                      disabled={isSubmitting}
                    />
                    <span>
                      Restore source indexes and constraints after the row copy
                      <span className="mt-0.5 block wb-muted">
                        Same-product catalog metadata only. The exact DDL is reviewed first,
                        runs inside the target transaction, and restores foreign keys last.
                      </span>
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

          <section ref={reviewSectionRef} className="min-w-0 border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-5 py-4">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <div className="text-[12px] font-medium">Review & confirm</div>
                <p className="mt-0.5 text-[10px] wb-muted">Inspect the generated mapping before a single row is written.</p>
              </div>
              {hasCurrentReview && <span className="shrink-0 rounded-[3px] bg-[hsl(var(--wb-active-strong))] px-1.5 py-0.5 text-[9px] text-[hsl(var(--wb-accent))]">Ready for confirmation</span>}
            </div>
            {recentReports.length > 0 && targetTableMode === "existing" && (
              <div className="mb-3 space-y-1 rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] p-2 text-[10px]">
                <p className="font-medium wb-muted">Recent target transfer history</p>
                {recentReports.map((report) => {
                  const retryable = canRetryTableDataTransferReport(report, effectiveSource);
                  return (
                    <div key={report.id} className="flex items-center justify-between gap-2 leading-4">
                      <span
                        className="min-w-0 truncate wb-muted"
                        title={`${report.source.schema}.${report.source.table} → ${report.rowsTransferred.toLocaleString()} rows${report.targetRowsBefore != null ? ` · target baseline ${report.targetRowsBefore.toLocaleString()} rows` : ""}`}
                      >
                        {report.status} · {report.source.schema}.{report.source.table} · {report.rowsTransferred.toLocaleString()} rows
                        {report.targetRowsBefore != null
                          ? ` · baseline ${report.targetRowsBefore.toLocaleString()}`
                          : ""}
                      </span>
                      {report.verification && (
                        <span
                          className={
                            report.verification.status === "verified" ||
                            (report.verification.status === "notAvailable" &&
                              report.verification.identityReseedVerified === true)
                              ? "shrink-0 text-[hsl(var(--wb-success))]"
                              : report.verification.status === "needsReview"
                                ? "shrink-0 text-[hsl(var(--wb-warning))]"
                                : "shrink-0 wb-muted"
                          }
                          title={report.verification.message}
                        >
                          {report.verification.identityReseedVerified === false
                              ? "review generator"
                              : report.verification.status === "needsReview"
                                ? "review count"
                                : report.verification.status === "verified"
                            ? "verified"
                            : report.verification.identityReseedVerified === true
                              ? "generator verified"
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
                    <div className="mb-1 flex items-center justify-between gap-2 font-medium">
                      <span>{targetPlan.columns.length} mapped column(s)</span>
                      <code className="truncate text-[9px] wb-muted">
                        {targetPlan.mappingProfile}
                      </code>
                    </div>
                    <div className="max-h-36 overflow-auto font-mono leading-5 wb-muted">
                      {targetPlan.columns.map((column) => (
                        <div
                          key={column.name}
                          className="border-b border-[hsl(var(--wb-border-subtle))] py-1 last:border-b-0"
                          title={column.reason}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate">
                              {column.name}: {column.sourceDataType || "unknown"} → {column.targetDataType}
                              {column.targetLength ? `(${column.targetLength})` : ""}
                            </span>
                            <span className={transferCompatibilityClass(column.compatibility)}>
                              {column.compatibility}
                            </span>
                          </div>
                          <div className="truncate text-[9px] wb-muted">
                            {column.isPrimaryKey ? "primary key · " : ""}
                            {column.isNotNull ? "not null · " : "nullable · "}
                            {column.identityRetained
                              ? `new target identity${
                                  column.targetIdentityGeneration === "always"
                                    ? " (always)"
                                    : column.targetIdentityGeneration === "byDefault"
                                      ? " (by default)"
                                      : ""
                                } · `
                              : column.sourceAutoIncrement
                                ? "identity materialized · "
                                : ""}
                            {column.hasSourceDefault
                              ? column.defaultRetained
                                ? "default retained · "
                                : "default omitted · "
                              : ""}
                            {column.reason}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {targetPlan.canExecute ? (
                    <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] p-2 font-mono leading-4 text-[hsl(var(--wb-text-muted))]">
                      {targetPlan.statements.join("\n\n")}
                    </pre>
                  ) : (
                    <p className="rounded-[4px] border border-[hsl(var(--destructive)/0.35)] bg-[hsl(var(--destructive)/0.08)] p-2 leading-4 text-[hsl(var(--destructive))]">
                      Target-table creation is blocked. At least one source type has no explicit mapping in this profile, so no executable DDL was generated.
                    </p>
                  )}
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
                  {targetPlan.canExecute && (
                    <>
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
                    </>
                  )}
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
                        const generatorPlans = preflight?.identityReseedPlans || [];
                        const schemaStatements = preflight?.schemaRestoreStatements || [];
                        return (
                          <div key={table} className="space-y-1 border-b border-[hsl(var(--wb-border-subtle))] py-1 last:border-b-0">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate">{table}</span>
                              <span className={preflight?.canExecute ? "text-[hsl(var(--wb-success))]" : "text-[hsl(var(--destructive))]"}>
                                {preflight?.canExecute
                                  ? `${preflight.mappedColumns} mapped${generatorPlans.length > 0 ? ` · ${generatorPlans.length} generator(s)` : ""}`
                                  : "blocked"}
                              </span>
                            </div>
                            {generatorPlans.map((generator) => (
                              <div
                                key={`${generator.column}:${generator.sequenceSchema}:${generator.sequenceName}`}
                                className="truncate pl-2 text-[9px] wb-muted"
                                title={`${generator.ownerSchema}.${generator.ownerTable}.${generator.ownerColumn}`}
                              >
                                {generator.column} → {generator.sequenceSchema}.{generator.sequenceName}
                                {` · last ${generator.currentValue ?? "unavailable"} · target max ${generator.targetMaxValue ?? "empty"}`}
                              </div>
                            ))}
                            {schemaStatements.length > 0 && (
                              <details className="pl-2 text-[9px] wb-muted">
                                <summary className="cursor-pointer select-none">
                                  Restore {schemaStatements.length} index/constraint statement(s)
                                </summary>
                                <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded-[3px] bg-[hsl(var(--wb-panel))] p-1.5">
                                  {schemaStatements.join("\n\n")}
                                </pre>
                              </details>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  {(batchPlan.objectPreflights?.length || 0) > 0 && (
                    <div
                      className="rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] p-2"
                      data-transfer-object-review
                    >
                      <div className="mb-1 font-medium">
                        {batchPlan.objectPreflights?.length} schema object(s)
                      </div>
                      <div className="custom-scrollbar max-h-56 space-y-1 overflow-auto font-mono leading-4">
                        {batchPlan.objectPreflights?.map((object) => (
                          <div
                            key={`${object.objectType}:${object.parentName || ""}:${object.name}`}
                            className="border-b border-[hsl(var(--wb-border-subtle))] py-1.5 last:border-b-0"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="min-w-0 truncate">
                                {object.objectType.replace(/_/g, " ")} · {object.parentName ? `${object.parentName}.` : ""}{object.name}
                              </span>
                              <span
                                className={
                                  object.action === "create"
                                    ? "text-[hsl(var(--wb-success))]"
                                    : object.action === "skipExisting"
                                      ? "wb-muted"
                                      : "text-[hsl(var(--destructive))]"
                                }
                              >
                                {object.action === "skipExisting"
                                  ? "skip existing"
                                  : object.action}
                              </span>
                            </div>
                            {object.dependsOn.length > 0 && (
                              <div className="truncate text-[9px] wb-muted">
                                depends on {object.dependsOn.join(", ")}
                              </div>
                            )}
                            {object.statements.length > 0 && (
                              <details className="mt-1 text-[9px] wb-muted">
                                <summary className="cursor-pointer select-none">
                                  Review {object.statements.length} DDL statement(s)
                                </summary>
                                <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded-[3px] bg-[hsl(var(--wb-panel))] p-1.5">
                                  {object.statements.join("\n\n")}
                                </pre>
                              </details>
                            )}
                            {object.warnings.map((warning) => (
                              <div
                                key={warning}
                                className={object.canExecute ? "text-[9px] wb-muted" : "text-[9px] text-[hsl(var(--destructive))]"}
                              >
                                {warning}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
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
                      : preview.targetRowsBefore != null
                        ? ` · target baseline ${preview.targetRowsBefore.toLocaleString()} row(s)`
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
                {(preview.identityReseedPlans?.length || 0) > 0 && (
                  <div className="rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] p-2">
                    <div className="mb-1 font-medium">PostgreSQL generator plan</div>
                    <div className="space-y-1 font-mono leading-4 wb-muted">
                      {preview.identityReseedPlans?.map((generator) => (
                        <div
                          key={`${generator.column}:${generator.sequenceSchema}:${generator.sequenceName}`}
                          className="border-b border-[hsl(var(--wb-border-subtle))] py-1 last:border-b-0"
                        >
                          <div>
                            {generator.column} → {generator.sequenceSchema}.{generator.sequenceName}
                          </div>
                          <div className="text-[9px]">
                            owner {generator.ownerSchema}.{generator.ownerTable}.{generator.ownerColumn}
                            {` · current ${generator.currentValue ?? "unavailable"} · target max ${generator.targetMaxValue ?? "empty"}`}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {(preview.schemaRestoreStatements?.length || 0) > 0 && (
                  <details className="rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] p-2">
                    <summary className="cursor-pointer select-none font-medium">
                      Restore {preview.schemaRestoreStatements?.length} index/constraint statement(s) after copy
                    </summary>
                    <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono leading-4 wb-muted">
                      {preview.schemaRestoreStatements?.join("\n\n")}
                    </pre>
                  </details>
                )}
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
          </main>
        </div>

        {error && <div role="alert" className="flex items-start gap-2 border-t border-[hsl(var(--destructive)/0.3)] bg-[hsl(var(--destructive)/0.08)] px-4 py-2 text-[10px] text-[hsl(var(--destructive))]"><AlertCircle size={13} className="mt-0.5 shrink-0" />{error}</div>}

        <DialogFooter className="flex-row items-center justify-between border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-5 py-3">
          <p className="hidden text-[10px] wb-muted sm:block">
            {hasCurrentReview ? "Settings are locked to this one-time review token." : "Preview is read-only and does not write rows."}
          </p>
          <div className="ml-auto flex items-center gap-2">
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
              {isSubmitting ? <Loader2 size={13} className="animate-spin" /> : isBatchTransfer ? "Transfer selected items" : mode === "overwrite" ? "Replace target rows" : mode === "upsert" ? "Upsert rows" : "Append rows"}
            </Button>
          )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
