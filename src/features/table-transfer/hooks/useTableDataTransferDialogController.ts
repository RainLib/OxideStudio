import { canRetryTableDataTransferReport } from "@/features/database-explorer/model/tableDataTransferRetry";
import { canRestoreTransferSchemaObjects } from "@/features/database-explorer/model/tableDataTransferSchemaObjects";
import { useTransferDestinationMetadata } from "@/features/table-transfer/hooks/useTransferDestinationMetadata";
import { useTransferDriverEligibility } from "@/features/table-transfer/hooks/useTransferDriverEligibility";
import { useTransferProgress } from "@/features/table-transfer/hooks/useTransferProgress";
import { useTransferReports } from "@/features/table-transfer/hooks/useTransferReports";
import { useTransferRequests } from "@/features/table-transfer/hooks/useTransferRequests";
import { useTransferSectionNavigation } from "@/features/table-transfer/hooks/useTransferSectionNavigation";
import { useTransferSourceInventory } from "@/features/table-transfer/hooks/useTransferSourceInventory";
import { createTransferExecutionActions } from "@/features/table-transfer/model/createTransferExecutionActions";
import { createTransferReviewActions } from "@/features/table-transfer/model/createTransferReviewActions";
import { createTransferTargetActions } from "@/features/table-transfer/model/createTransferTargetActions";
import {
  canExecuteTableDataTransfer,
  createTableDataTransferId,
  supportsBoundedTableDataTransfer,
  supportsTableDataTransferUpsert,
  transferObjectKey,
  transferObjectKindOrder,
} from "@/features/table-transfer/model/transferPolicy";
import { canConfigureUnquotedTransferTargetColumns } from "@/lib/tableDataTransferPolicy";
import type {
  DatabaseCapabilities,
  TableDataTransferBatchPlan,
  TableDataTransferMode,
  TableDataTransferObjectSelection,
  TableDataTransferPreview,
  TableDataTransferProgress,
  TableDataTransferReport,
  TableDataTransferTargetPlan,
} from "@/services/tauri/types";
import { useEffect, useMemo, useState } from "react";
import type { TableDataTransferDialogProps } from "@/features/table-transfer/model/tableDataTransferDialogTypes";


export function useTableDataTransferDialogController({
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
  const { externalTransferConnectionIds } = useTransferDriverEligibility({
    open,
    connections,
  });
  const [tables, setTables] = useState<string[]>([]);
  const [sourceTables, setSourceTables] = useState<string[]>([]);
  const [sourceTransferObjects, setSourceTransferObjects] = useState<
    TableDataTransferObjectSelection[]
  >([]);
  const [selectedTransferObjectKeys, setSelectedTransferObjectKeys] = useState<
    Set<string>
  >(() => new Set());
  const [activeSourceSchema, setActiveSourceSchema] = useState(source.schema);
  const [selectedSourceTables, setSelectedSourceTables] = useState<Set<string>>(
    () =>
      new Set(
        initialSourceTables?.length ? initialSourceTables : [source.table],
      ),
  );
  const [preview, setPreview] = useState<TableDataTransferPreview | null>(null);
  const [previewRequestKey, setPreviewRequestKey] = useState("");
  const [batchPlan, setBatchPlan] = useState<TableDataTransferBatchPlan | null>(
    null,
  );
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
  const [progress, setProgress] = useState<TableDataTransferProgress | null>(
    null,
  );
  const [pendingRetryTargetTable, setPendingRetryTargetTable] = useState<
    string | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const targetConnection = useMemo(
    () =>
      connections.find((connection) => connection.id === targetConnectionId),
    [connections, targetConnectionId],
  );
  const sourceConnection = useMemo(
    () =>
      connections.find((connection) => connection.id === source.connectionId),
    [connections, source.connectionId],
  );
  const eligibleTargetConnections = useMemo(
    () =>
      connections.filter(
        (connection) =>
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
    () => ({
      ...source,
      schema: activeSourceSchema,
      table: selectedSourceTable,
    }),
    [activeSourceSchema, selectedSourceTable, source],
  );
  const canConfigureTargetColumnQuoting =
    canConfigureUnquotedTransferTargetColumns(
      targetConnection?.driver,
      targetDistribution,
      targetCapabilities,
    );
  const selectedTransferObjects = useMemo(
    () =>
      sourceTransferObjects.filter((object) =>
        selectedTransferObjectKeys.has(transferObjectKey(object)),
      ),
    [selectedTransferObjectKeys, sourceTransferObjects],
  );
  const isBatchTransfer =
    selectedSourceTables.size > 1 || selectedTransferObjects.length > 0;
  const canRestoreSourceSchemaObjects = Boolean(
    sourceConnection &&
      targetConnection &&
      canRestoreTransferSchemaObjects({
        sourceDriver: effectiveSource.driver,
        targetDriver: targetConnection.driver,
        sourceIsExternal: Boolean(sourceConnection.driverPackageVersion),
        targetIsExternal: Boolean(targetConnection.driverPackageVersion),
        sourceTable: effectiveSource.table,
        targetTable,
        isBatchTransfer,
      }),
  );
  const sourceTransferObjectGroups = useMemo(
    () =>
      transferObjectKindOrder
        .map((kind) => ({
          kind,
          objects: sourceTransferObjects.filter(
            (object) => object.objectType === kind,
          ),
        }))
        .filter((group) => group.objects.length > 0),
    [sourceTransferObjects],
  );

  const { isSourceObjectsLoading } = useTransferSourceInventory({
    open,
    sourceSupportsTransfer,
    source,
    activeSourceSchema,
    setSourceTables,
    setSourceTransferObjects,
    setSelectedTransferObjectKeys,
    setSelectedSourceTables,
    initialSourceScope,
    initialSourceTables,
  });

  const { recentReports } = useTransferReports({
    open,
    projectId,
    targetConnectionId,
  });

  const {
    request,
    batchRequest,
    targetPlanRequest,
    targetSupportsCatalogs,
    targetSupportsGeneratedTable,
    requestKey,
    batchRequestKey,
    targetPlanRequestKey,
  } = useTransferRequests({
    targetConnection,
    projectId,
    transferId,
    effectiveSource,
    targetDatabase,
    targetSchema,
    targetTable,
    mode,
    maxRows,
    batchSize,
    reseedIdentity,
    quoteTargetColumnNames,
    restoreSourceSchemaObjects,
    selectedSourceTables,
    selectedTransferObjects,
    targetTableMode,
    targetCapabilities,
  });

  useEffect(() => {
    if (!open) return;
    const firstTarget =
      eligibleTargetConnections.find(
        (connection) => connection.id === initialTarget?.connectionId,
      ) ||
      eligibleTargetConnections.find(
        (connection) =>
          connection.id !== source.connectionId ||
          connection.driver !== source.driver,
      ) ||
      eligibleTargetConnections.find(
        (connection) => connection.id === source.connectionId,
      );
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
      new Set(
        initialSourceTables?.length ? initialSourceTables : [source.table],
      ),
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

  useTransferProgress({
    open,
    transferId,
    setProgress,
    setError,
  });

  const { isDatabasesLoading, isSchemasLoading, isTablesLoading } =
    useTransferDestinationMetadata({
      open,
      targetConnectionId,
      targetConnection,
      externalTransferConnectionIds,
      setTargetCapabilities,
      setTargetDistribution,
      setDatabases,
      setTargetDatabase,
      setSchemas,
      setTables,
      setTargetTable,
      setTargetTableMode,
      setMode,
      setReseedIdentity,
      setTargetPlan,
      setTargetPlanPreviewKey,
      setTargetPlanConfirmation,
      setError,
      initialTarget,
      source,
      targetCapabilities,
      targetSupportsCatalogs,
      targetDatabase,
      setTargetSchema,
      targetSchema,
      targetTableMode,
      pendingRetryTargetTable,
      setPendingRetryTargetTable,
    });

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
      nextMode === "existing" ? tables[0] || "" : effectiveSource.table,
    );
    setTargetPlan(null);
    setTargetPlanPreviewKey("");
    setTargetPlanConfirmation("");
    setRestoreSourceSchemaObjects(false);
    resetTransferReview();
    setError(null);
  };

  const { handlePreviewTarget, handleCreateTarget } =
    createTransferTargetActions({
      targetPlanRequest,
      targetSchema,
      targetTable,
      setError,
      setIsSubmitting,
      setTargetPlan,
      setTargetPlanPreviewKey,
      setTargetPlanConfirmation,
      targetPlanRequestKey,
      targetPlan,
      targetPlanPreviewKey,
      targetPlanConfirmation,
      setIsCreatingTarget,
      targetSupportsCatalogs,
      targetConnectionId,
      targetDatabase,
      setTables,
      setTargetTableMode,
      setTargetTable,
      setRestoreSourceSchemaObjects,
      resetTransferReview,
    });

  const { handlePreview } = createTransferReviewActions({
    sourceSupportsTransfer,
    setError,
    source,
    targetConnection,
    targetCapabilities,
    isBatchTransfer,
    request,
    batchRequest,
    targetSchema,
    targetTable,
    targetTableMode,
    setIsSubmitting,
    setPreview,
    setPreviewRequestKey,
    setBatchPlan,
    setBatchPlanRequestKey,
    setProgress,
    setConfirmation,
    batchRequestKey,
    requestKey,
  });

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

  const { handleTransfer, handleCancelTransfer } =
    createTransferExecutionActions({
      isBatchTransfer,
      batchRequest,
      batchPlan,
      batchPlanRequestKey,
      batchRequestKey,
      confirmation,
      request,
      preview,
      previewRequestKey,
      requestKey,
      setIsSubmitting,
      setIsExecuting,
      setIsCancelling,
      setError,
      onTransferred,
      onClose,
      isExecuting,
      isCancelling,
      transferId,
    });

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

  const {
    activeSection,
    setActiveSection,
    setupSectionRef,
    reviewSectionRef,
    selectSection,
  } = useTransferSectionNavigation({
    reviewReady,
  });


  return {
    open,
    onClose,
    source,
    initialSourceScope,
    sourceSchemas,
    effectiveSource,
    selectedSourceTables,
    destinationReady,
    targetConnection,
    targetSchema,
    reviewReady,
    canExecute,
    selectSection,
    activeSection,
    targetTableMode,
    hasCurrentReview,
    setupSectionRef,
    activeSourceSchema,
    setActiveSourceSchema,
    setSourceTables,
    setSelectedSourceTables,
    setSourceTransferObjects,
    setSelectedTransferObjectKeys,
    resetTransferReview,
    setError,
    isSubmitting,
    sourceTables,
    toggleSourceTable,
    selectedTransferObjects,
    isSourceObjectsLoading,
    sourceTransferObjectGroups,
    selectedTransferObjectKeys,
    toggleTransferObject,
    targetConnectionId,
    setTargetConnectionId,
    eligibleTargetConnections,
    sourceSupportsTransfer,
    targetSupportsCatalogs,
    targetDatabase,
    setTargetDatabase,
    isDatabasesLoading,
    databases,
    setTargetSchema,
    isSchemasLoading,
    schemas,
    handleTargetTableModeChange,
    isTablesLoading,
    isBatchTransfer,
    targetSupportsGeneratedTable,
    targetTable,
    setTargetTable,
    tables,
    setTargetPlan,
    setTargetPlanPreviewKey,
    setTargetPlanConfirmation,
    mode,
    handleModeChange,
    targetDistribution,
    canConfigureTargetColumnQuoting,
    quoteTargetColumnNames,
    setQuoteTargetColumnNames,
    maxRows,
    setMaxRows,
    batchSize,
    setBatchSize,
    reseedIdentity,
    setReseedIdentity,
    canRestoreSourceSchemaObjects,
    restoreSourceSchemaObjects,
    setRestoreSourceSchemaObjects,
    reviewSectionRef,
    recentReports,
    handleRetryReport,
    targetPlan,
    handlePreviewTarget,
    targetPlanRequest,
    targetPlanPreviewKey,
    targetPlanRequestKey,
    targetPlanConfirmation,
    handleCreateTarget,
    isCreatingTarget,
    batchPlan,
    batchPlanIsCurrent,
    progress,
    confirmation,
    setConfirmation,
    preview,
    planIsCurrent,
    error,
    isExecuting,
    isCancelling,
    handleCancelTransfer,
    handlePreview,
    handleTransfer,
  };
}

export type TableDataTransferDialogController = ReturnType<
  typeof useTableDataTransferDialogController
>;
