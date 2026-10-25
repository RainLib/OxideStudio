import { confirmAction, promptValue } from "@/lib/appDialogs";
import { tableService } from "@/services/tauri";
import type { ConstraintInfo, IndexInfo } from "@/services/tauri/types";

interface TableStructureActionsContext {
  tabConnectionId: string | null;
  activeTab: import("@/store/useTabStore").TabData;
  canManageIndexes: boolean;
  isIndexSubmitting: boolean;
  setIsIndexSubmitting: React.Dispatch<React.SetStateAction<boolean>>;
  setMetadataError: React.Dispatch<React.SetStateAction<string | null>>;
  driver: import("@/services/tauri/types").DatabaseDriver;
  setIsIndexDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  refreshStructure: (force?: boolean) => Promise<void>;
  bumpMetadataVersion: () => void;
  activeCapabilities: import("@/services/tauri/types").DatabaseCapabilities;
  canManageConstraints: boolean | undefined;
  isConstraintSubmitting: boolean;
  setIsConstraintSubmitting: React.Dispatch<React.SetStateAction<boolean>>;
  setIsConstraintDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

export function createTableStructureActions({
  tabConnectionId,
  activeTab,
  canManageIndexes,
  isIndexSubmitting,
  setIsIndexSubmitting,
  setMetadataError,
  driver,
  setIsIndexDialogOpen,
  refreshStructure,
  bumpMetadataVersion,
  activeCapabilities,
  canManageConstraints,
  isConstraintSubmitting,
  setIsConstraintSubmitting,
  setIsConstraintDialogOpen,
}: TableStructureActionsContext) {
  const handleCreateIndex = async (
    indexName: string,
    columns: string[],
    unique: boolean,
  ) => {
    if (
      !tabConnectionId ||
      !activeTab.tableName ||
      !activeTab.schemaName ||
      !canManageIndexes ||
      isIndexSubmitting
    ) {
      return;
    }

    setIsIndexSubmitting(true);
    setMetadataError(null);
    try {
      await tableService.createTableIndex(
        tabConnectionId,
        driver,
        activeTab.schemaName,
        activeTab.tableName,
        indexName,
        columns,
        unique,
      );
      setIsIndexDialogOpen(false);
      await refreshStructure(true);
      bumpMetadataVersion();
    } catch (err: any) {
      setMetadataError(err?.message || String(err));
    } finally {
      setIsIndexSubmitting(false);
    }
  };

  const handleDropIndex = async (index: IndexInfo) => {
    if (
      !tabConnectionId ||
      !activeTab.tableName ||
      !activeTab.schemaName ||
      !canManageIndexes ||
      index.is_primary
    ) {
      return;
    }

    const confirmed = (await confirmAction(
      `Drop index "${index.name}" from "${activeTab.tableName}"?`,
    ));
    if (!confirmed) return;

    setMetadataError(null);
    try {
      await tableService.dropTableIndex(
        tabConnectionId,
        driver,
        activeTab.schemaName,
        activeTab.tableName,
        index.name,
      );
      await refreshStructure(true);
      bumpMetadataVersion();
    } catch (err: any) {
      setMetadataError(err?.message || String(err));
    }
  };

  const handleRenameIndex = async (index: IndexInfo) => {
    if (
      !tabConnectionId ||
      !activeTab.tableName ||
      !activeTab.schemaName ||
      !canManageIndexes ||
      !activeCapabilities.supportsIndexRename ||
      index.is_primary
    ) {
      return;
    }

    const nextName = (await promptValue("Rename index to:", index.name));
    if (nextName === null) return;

    const trimmedName = nextName.trim();
    if (!trimmedName || trimmedName === index.name) return;

    setMetadataError(null);
    try {
      await tableService.renameTableIndex(
        tabConnectionId,
        driver,
        activeTab.schemaName,
        activeTab.tableName,
        index.name,
        trimmedName,
      );
      await refreshStructure(true);
      bumpMetadataVersion();
    } catch (err: any) {
      setMetadataError(err?.message || String(err));
    }
  };

  const handleCreateUniqueConstraint = async (
    constraintName: string,
    columns: string[],
  ) => {
    if (
      !tabConnectionId ||
      !activeTab.tableName ||
      !activeTab.schemaName ||
      !canManageConstraints ||
      !activeCapabilities.supportsCheckConstraints ||
      isConstraintSubmitting
    ) {
      return;
    }

    setIsConstraintSubmitting(true);
    setMetadataError(null);
    try {
      await tableService.createTableUniqueConstraint(
        tabConnectionId,
        driver,
        activeTab.schemaName,
        activeTab.tableName,
        constraintName,
        columns,
      );
      setIsConstraintDialogOpen(false);
      await refreshStructure(true);
      bumpMetadataVersion();
    } catch (err: any) {
      setMetadataError(err?.message || String(err));
    } finally {
      setIsConstraintSubmitting(false);
    }
  };

  const handleCreatePrimaryKey = async (
    constraintName: string,
    columns: string[],
  ) => {
    if (
      !tabConnectionId ||
      !activeTab.tableName ||
      !activeTab.schemaName ||
      !canManageConstraints ||
      !activeCapabilities.supportsForeignKeys ||
      isConstraintSubmitting
    ) {
      return;
    }

    setIsConstraintSubmitting(true);
    setMetadataError(null);
    try {
      await tableService.createTablePrimaryKey(
        tabConnectionId,
        driver,
        activeTab.schemaName,
        activeTab.tableName,
        constraintName,
        columns,
      );
      setIsConstraintDialogOpen(false);
      await refreshStructure(true);
      bumpMetadataVersion();
    } catch (err: any) {
      setMetadataError(err?.message || String(err));
    } finally {
      setIsConstraintSubmitting(false);
    }
  };

  const handleCreateCheckConstraint = async (
    constraintName: string,
    expression: string,
  ) => {
    if (
      !tabConnectionId ||
      !activeTab.tableName ||
      !activeTab.schemaName ||
      !canManageConstraints ||
      isConstraintSubmitting
    ) {
      return;
    }

    setIsConstraintSubmitting(true);
    setMetadataError(null);
    try {
      await tableService.createTableCheckConstraint(
        tabConnectionId,
        driver,
        activeTab.schemaName,
        activeTab.tableName,
        constraintName,
        expression,
      );
      setIsConstraintDialogOpen(false);
      await refreshStructure(true);
      bumpMetadataVersion();
    } catch (err: any) {
      setMetadataError(err?.message || String(err));
    } finally {
      setIsConstraintSubmitting(false);
    }
  };

  const handleCreateForeignKey = async (request: {
    constraintName: string;
    columns: string[];
    referencedTable: string;
    referencedColumns: string[];
    onDelete: string | null;
    onUpdate: string | null;
  }) => {
    if (
      !tabConnectionId ||
      !activeTab.tableName ||
      !activeTab.schemaName ||
      !canManageConstraints ||
      isConstraintSubmitting
    ) {
      return;
    }

    setIsConstraintSubmitting(true);
    setMetadataError(null);
    try {
      await tableService.createTableForeignKey(
        tabConnectionId,
        driver,
        activeTab.schemaName,
        activeTab.tableName,
        request.constraintName,
        request.columns,
        activeTab.schemaName,
        request.referencedTable,
        request.referencedColumns,
        request.onDelete,
        request.onUpdate,
      );
      setIsConstraintDialogOpen(false);
      await refreshStructure(true);
      bumpMetadataVersion();
    } catch (err: any) {
      setMetadataError(err?.message || String(err));
    } finally {
      setIsConstraintSubmitting(false);
    }
  };

  const handleDropConstraint = async (constraint: ConstraintInfo) => {
    if (
      !tabConnectionId ||
      !activeTab.tableName ||
      !activeTab.schemaName ||
      !canManageConstraints
    ) {
      return;
    }

    const confirmed = (await confirmAction(
      `Drop constraint "${constraint.name}" from "${activeTab.tableName}"?`,
    ));
    if (!confirmed) return;

    setMetadataError(null);
    try {
      await tableService.dropTableConstraint(
        tabConnectionId,
        driver,
        activeTab.schemaName,
        activeTab.tableName,
        constraint.name,
      );
      await refreshStructure(true);
      bumpMetadataVersion();
    } catch (err: any) {
      setMetadataError(err?.message || String(err));
    }
  };

  return {
    handleCreateIndex,
    handleDropIndex,
    handleRenameIndex,
    handleCreateUniqueConstraint,
    handleCreatePrimaryKey,
    handleCreateCheckConstraint,
    handleCreateForeignKey,
    handleDropConstraint,
  };
}
