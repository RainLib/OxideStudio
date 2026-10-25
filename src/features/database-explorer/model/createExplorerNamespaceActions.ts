import { confirmAction, promptValue } from "@/lib/appDialogs";
import { defaultDatabaseCapabilities } from "@/lib/databaseDialect";
import { databaseService } from "@/services/tauri";
import type {
  DatabaseCapabilities,
  DatabaseDriver,
} from "@/services/tauri/types/database";

interface CreateExplorerNamespaceActionsContext {
  activeConnectionId: string | null;
  currentSchema: string | null;
  canBrowseTables: boolean;
  activeCapabilities: DatabaseCapabilities;
  createTableTab: (connectionId: string, schemaName: string) => string;
  setViewDialogMode: React.Dispatch<React.SetStateAction<"create" | "edit">>;
  setViewDialogKind: React.Dispatch<
    React.SetStateAction<"view" | "materializedView">
  >;
  setViewDialogInitialName: React.Dispatch<React.SetStateAction<string>>;
  setViewDialogInitialSql: React.Dispatch<React.SetStateAction<string>>;
  setIsCreateViewDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setNamespaceError: React.Dispatch<React.SetStateAction<string | null>>;
  namespaceLabel: string;
  setIsCreateDbDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  activeDriver: DatabaseDriver;
  setActiveConnection: (id: string) => Promise<string | null>;
  loadSchemas: (
    connectionId: string,
    force?: boolean | undefined,
  ) => Promise<void>;
  setCurrentSchema: (schema: string) => Promise<void>;
  bumpMetadataVersion: () => void;
}

export function createExplorerNamespaceActions({
  activeConnectionId,
  currentSchema,
  canBrowseTables,
  activeCapabilities,
  createTableTab,
  setViewDialogMode,
  setViewDialogKind,
  setViewDialogInitialName,
  setViewDialogInitialSql,
  setIsCreateViewDialogOpen,
  setNamespaceError,
  namespaceLabel,
  setIsCreateDbDialogOpen,
  activeDriver,
  setActiveConnection,
  loadSchemas,
  setCurrentSchema,
  bumpMetadataVersion,
}: CreateExplorerNamespaceActionsContext) {
  const handleCreateTable = () => {
    if (
      activeConnectionId &&
      currentSchema &&
      canBrowseTables &&
      activeCapabilities.supportsTableDdl
    ) {
      createTableTab(activeConnectionId, currentSchema);
    }
  };

  const handleCreateView = () => {
    if (
      activeConnectionId &&
      currentSchema &&
      activeCapabilities.supportsViews
    ) {
      setViewDialogMode("create");
      setViewDialogKind("view");
      setViewDialogInitialName("");
      setViewDialogInitialSql("");
      setIsCreateViewDialogOpen(true);
    }
  };

  const handleCreateMaterializedView = () => {
    if (
      activeConnectionId &&
      currentSchema &&
      canBrowseTables &&
      activeCapabilities.supportsMaterializedViews
    ) {
      setViewDialogMode("create");
      setViewDialogKind("materializedView");
      setViewDialogInitialName("");
      setViewDialogInitialSql("");
      setIsCreateViewDialogOpen(true);
    }
  };

  const handleCreateDatabase = () => {
    if (!activeCapabilities.supportsCreateDatabase) {
      setNamespaceError(
        `${activeCapabilities.displayName} ${namespaceLabel} creation is not supported.`,
      );
      return;
    }
    setIsCreateDbDialogOpen(true);
  };

  const handleRenameDatabase = async (
    schemaOverride?: string,
    connectionIdOverride = activeConnectionId || "",
    driverOverride = activeDriver,
  ) => {
    const targetSchema = schemaOverride || currentSchema;
    if (!connectionIdOverride || !targetSchema) return;
    const targetCapabilities = defaultDatabaseCapabilities(driverOverride);
    const targetNamespaceLabel =
      targetCapabilities.namespaceLabel || "database";
    if (!targetCapabilities.supportsRenameDatabase) {
      setNamespaceError(
        `${targetCapabilities.displayName} ${targetNamespaceLabel} rename is not supported safely.`,
      );
      return;
    }

    const nextName = (await promptValue(
      `Rename ${targetNamespaceLabel} to:`,
      targetSchema,
    ));
    if (nextName === null) return;

    const trimmedName = nextName.trim();
    if (!trimmedName || trimmedName === targetSchema) return;

    setNamespaceError(null);
    try {
      const connectionError = await setActiveConnection(connectionIdOverride);
      if (connectionError) throw new Error(connectionError);
      await databaseService.renameDatabase(
        connectionIdOverride,
        driverOverride,
        targetSchema,
        trimmedName,
      );
      await loadSchemas(connectionIdOverride, true);
      await setCurrentSchema(trimmedName);
      bumpMetadataVersion();
    } catch (err: any) {
      setNamespaceError(err?.message || String(err));
    }
  };

  const handleDropDatabase = async (
    schemaOverride?: string,
    connectionIdOverride = activeConnectionId || "",
    driverOverride = activeDriver,
  ) => {
    const targetSchema = schemaOverride || currentSchema;
    if (!connectionIdOverride || !targetSchema) return;
    const targetCapabilities = defaultDatabaseCapabilities(driverOverride);
    const targetNamespaceLabel =
      targetCapabilities.namespaceLabel || "database";
    if (!targetCapabilities.supportsCreateDatabase) {
      setNamespaceError(
        `${targetCapabilities.displayName} ${targetNamespaceLabel} deletion is not supported.`,
      );
      return;
    }

    const confirmed = (await confirmAction(
      `Drop ${targetNamespaceLabel} "${targetSchema}" and all contained objects? This cannot be undone.`,
    ));
    if (!confirmed) return;

    setNamespaceError(null);
    try {
      const connectionError = await setActiveConnection(connectionIdOverride);
      if (connectionError) throw new Error(connectionError);
      await databaseService.dropDatabase(
        connectionIdOverride,
        driverOverride,
        targetSchema,
        true,
      );
      await loadSchemas(connectionIdOverride, true);
      bumpMetadataVersion();
    } catch (err: any) {
      setNamespaceError(err?.message || String(err));
    }
  };

  return {
    handleCreateTable,
    handleCreateView,
    handleCreateMaterializedView,
    handleCreateDatabase,
    handleRenameDatabase,
    handleDropDatabase,
  };
}
