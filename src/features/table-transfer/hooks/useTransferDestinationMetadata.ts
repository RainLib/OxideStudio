import { supportsBoundedTableDataTransfer } from "@/features/table-transfer/model/transferPolicy";
import { databaseService, schemaService } from "@/services/tauri";
import type {
  DatabaseCapabilities,
  TableDataTransferEndpoint,
  TableDataTransferMode,
  TableDataTransferTargetPlan,
} from "@/services/tauri/types";
import {
  ensureConnectionReady,
  type ConnectionConfig,
} from "@/store/useConnectionStore";
import { useEffect, useState } from "react";

interface TransferDestinationMetadataOptions {
  open: boolean;
  targetConnectionId: string;
  targetConnection: ConnectionConfig | undefined;
  externalTransferConnectionIds: Set<string>;
  setTargetCapabilities: React.Dispatch<
    React.SetStateAction<DatabaseCapabilities | null>
  >;
  setTargetDistribution: React.Dispatch<
    React.SetStateAction<"managed" | "bundled" | "external" | null>
  >;
  setDatabases: React.Dispatch<React.SetStateAction<string[]>>;
  setTargetDatabase: React.Dispatch<React.SetStateAction<string>>;
  setSchemas: React.Dispatch<React.SetStateAction<string[]>>;
  setTables: React.Dispatch<React.SetStateAction<string[]>>;
  setTargetTable: React.Dispatch<React.SetStateAction<string>>;
  setTargetTableMode: React.Dispatch<React.SetStateAction<"existing" | "new">>;
  setMode: React.Dispatch<React.SetStateAction<TableDataTransferMode>>;
  setReseedIdentity: React.Dispatch<React.SetStateAction<boolean>>;
  setTargetPlan: React.Dispatch<
    React.SetStateAction<TableDataTransferTargetPlan | null>
  >;
  setTargetPlanPreviewKey: React.Dispatch<React.SetStateAction<string>>;
  setTargetPlanConfirmation: React.Dispatch<React.SetStateAction<string>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  initialTarget: Omit<TableDataTransferEndpoint, "table"> | undefined;
  source: TableDataTransferEndpoint;
  targetCapabilities: DatabaseCapabilities | null;
  targetSupportsCatalogs: boolean;
  targetDatabase: string;
  setTargetSchema: React.Dispatch<React.SetStateAction<string>>;
  targetSchema: string;
  targetTableMode: "existing" | "new";
  pendingRetryTargetTable: string | null;
  setPendingRetryTargetTable: React.Dispatch<
    React.SetStateAction<string | null>
  >;
}

export function useTransferDestinationMetadata({
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
}: TransferDestinationMetadataOptions) {
  const [isDatabasesLoading, setIsDatabasesLoading] = useState(false);
  const [isSchemasLoading, setIsSchemasLoading] = useState(false);
  const [isTablesLoading, setIsTablesLoading] = useState(false);

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

        const nextDatabases =
          await schemaService.getDatabases(targetConnectionId);
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
            nextSchemas.includes(current) ? current : nextSchemas[0] || "",
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
    setTargetTable((current) => (targetTableMode === "new" ? current : ""));
    void (
      targetSupportsCatalogs
        ? schemaService.getDatabaseTables(
            targetConnectionId,
            targetDatabase,
            targetSchema,
          )
        : schemaService.getTables(targetConnectionId, targetSchema)
    )
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

  return { isDatabasesLoading, isSchemasLoading, isTablesLoading };
}
