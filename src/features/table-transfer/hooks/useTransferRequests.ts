import type {
  DatabaseCapabilities,
  TableDataTransferBatchExecuteRequest,
  TableDataTransferMode,
  TableDataTransferObjectSelection,
  TableDataTransferTargetPlanRequest,
} from "@/services/tauri/types";
import type { DatabaseDriver } from "@/services/tauri/types/database";
import { type ConnectionConfig } from "@/store/useConnectionStore";
import { useMemo } from "react";

interface TransferRequestsOptions {
  targetConnection: ConnectionConfig | undefined;
  projectId: string | null | undefined;
  transferId: string;
  effectiveSource: {
    schema: string;
    table: string;
    connectionId: string;
    driver: DatabaseDriver;
    database?: string | undefined;
  };
  targetDatabase: string;
  targetSchema: string;
  targetTable: string;
  mode: TableDataTransferMode;
  maxRows: string;
  batchSize: string;
  reseedIdentity: boolean;
  quoteTargetColumnNames: boolean;
  restoreSourceSchemaObjects: boolean;
  selectedSourceTables: Set<string>;
  selectedTransferObjects: TableDataTransferObjectSelection[];
  targetTableMode: "existing" | "new";
  targetCapabilities: DatabaseCapabilities | null;
}

export function useTransferRequests({
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
}: TransferRequestsOptions) {
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
  const batchRequest =
    useMemo<TableDataTransferBatchExecuteRequest | null>(() => {
      if (
        !targetConnection ||
        (selectedSourceTables.size < 2 && selectedTransferObjects.length === 0)
      )
        return null;
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

  return {
    request,
    batchRequest,
    targetPlanRequest,
    targetSupportsCatalogs,
    targetSupportsGeneratedTable,
    requestKey,
    batchRequestKey,
    targetPlanRequestKey,
  };
}
