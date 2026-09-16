import { databaseService, tableService } from "@/services/tauri";
import { loadTableMetadata } from "@/services/tableMetadataCache";
import { useConnectionStore } from "@/store/useConnectionStore";
import {
  defaultDatabaseCapabilities,
  defaultLengthForDataType,
  supportsAutoIncrementForDataType,
} from "@/lib/databaseDialect";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useTabStore } from "@/store/useTabStore";
import { useEffect, useState } from "react";
import {
  createAlterColumnDraft,
  createDefaultColumnDraft,
  lengthForColumnType,
  type AlterColumnDraft,
  type ColumnDraft,
  type EditColumnsDialogProps,
} from "@/features/table-data/model/editColumnsDialog";
import type { ColumnInfo, DatabaseCapabilities } from "@/services/tauri/types";

export function useEditColumnsDialogController({
  isOpen,
  onClose,
  connectionId,
  driver,
  schema,
  tableName,
}: EditColumnsDialogProps) {
  const fallbackCapabilities = defaultDatabaseCapabilities(driver);
  const [capabilities, setCapabilities] =
    useState<DatabaseCapabilities>(fallbackCapabilities);
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [draft, setDraft] = useState<ColumnDraft>(
    createDefaultColumnDraft(fallbackCapabilities)
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [droppingColumn, setDroppingColumn] = useState<string | null>(null);
  const [renamingColumn, setRenamingColumn] = useState<string | null>(null);
  const [alterDraft, setAlterDraft] = useState<AlterColumnDraft | null>(null);
  const [alteringColumn, setAlteringColumn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { loadTables, bumpMetadataVersion } = useSchemaStore();
  const { refreshTableTabs } = useTabStore();
  const packageVersion = useConnectionStore((state) =>
    state.connections.find((item) => item.id === connectionId)
      ?.driverPackageVersion,
  );
  const draftAutoIncrementSupported = supportsAutoIncrementForDataType(
    capabilities,
    draft.type
  );

  const loadColumns = async (force = false) => {
    if (!connectionId || !schema || !tableName) return;

    setIsLoading(true);
    setError(null);
    try {
      const metadata = await loadTableMetadata({
        connectionId,
        driver,
        schema,
        table: tableName,
        includeIndexes: false,
        includeConstraints: false,
        force,
      });
      setColumns(metadata.columns);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setIsLoading(false);
    }
  };

  const refreshAfterColumnChange = async () => {
    if (connectionId && schema && tableName) {
      const hasOpenTableTab = useTabStore.getState().tabs.some(
        (tab) =>
          tab.type === "table" &&
          tab.connectionId === connectionId &&
          tab.schemaName === schema &&
          tab.tableName === tableName
      );

      if (hasOpenTableTab) {
        await Promise.all([
          loadTables(connectionId, schema, true),
          refreshTableTabs(connectionId, schema, tableName),
        ]);
        const refreshedTab = useTabStore.getState().tabs.find(
          (tab) =>
            tab.type === "table" &&
            tab.connectionId === connectionId &&
            tab.schemaName === schema &&
            tab.tableName === tableName
        );
        setColumns(refreshedTab?.tableColumns || []);
      } else {
        await Promise.all([
          loadTables(connectionId, schema, true),
          loadColumns(true),
        ]);
      }
    }

    bumpMetadataVersion();
  };

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    const fallback = defaultDatabaseCapabilities(driver);
    setCapabilities(fallback);
    setDraft(createDefaultColumnDraft(fallback));
    setColumns([]);
    setAlterDraft(null);
    setError(null);

    databaseService
      .getDatabaseCapabilities(driver, packageVersion)
      .then((value) => {
        if (cancelled) return;
        setCapabilities(value);
        setDraft(createDefaultColumnDraft(value));
      })
      .catch((err) => {
        console.error("Failed to load database capabilities:", err);
      });

    loadColumns();

    return () => {
      cancelled = true;
    };
  }, [isOpen, connectionId, driver, packageVersion, schema, tableName]);

  const updateDraft = (
    field: keyof ColumnDraft,
    value: string | boolean
  ) => {
    setDraft((current) => {
      const next = { ...current, [field]: value };
      if (field === "type" && typeof value === "string") {
        next.length = defaultLengthForDataType(value);
        if (!supportsAutoIncrementForDataType(capabilities, value)) {
          next.isAutoIncrement = false;
        }
      }
      return next;
    });
  };

  const updateAlterDraft = (
    field: keyof AlterColumnDraft,
    value: string | boolean
  ) => {
    setAlterDraft((current) => {
      if (!current) return current;
      const next = { ...current, [field]: value };
      if (field === "type" && typeof value === "string") {
        next.length = lengthForColumnType(value, next.length);
      }
      return next;
    });
  };

  const handleAddColumn = async () => {
    if (!draft.name.trim()) {
      setError("Column name is required");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await tableService.addTableColumn(connectionId, driver, schema, tableName, {
        name: draft.name.trim(),
        dataType: draft.type,
        length: draft.length.trim() || null,
        isPrimaryKey: draft.isPrimaryKey,
        isNotNull: draft.isNotNull,
        isAutoIncrement: draft.isAutoIncrement,
        comment: draft.comment.trim() || null,
      });

      setDraft(createDefaultColumnDraft(capabilities));
      await refreshAfterColumnChange();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDropColumn = async (columnName: string) => {
    const confirmed = window.confirm(
      `Drop column "${columnName}" from "${tableName}"? This cannot be undone.`
    );
    if (!confirmed) return;

    setDroppingColumn(columnName);
    setError(null);
    try {
      await tableService.dropTableColumn(
        connectionId,
        driver,
        schema,
        tableName,
        columnName
      );
      await refreshAfterColumnChange();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setDroppingColumn(null);
    }
  };

  const handleRenameColumn = async (columnName: string) => {
    const nextName = window.prompt("Rename column to:", columnName);
    if (nextName === null) return;

    const trimmedName = nextName.trim();
    if (!trimmedName || trimmedName === columnName) return;

    setRenamingColumn(columnName);
    setError(null);
    try {
      await tableService.renameTableColumn(
        connectionId,
        driver,
        schema,
        tableName,
        columnName,
        trimmedName
      );
      await refreshAfterColumnChange();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setRenamingColumn(null);
    }
  };

  const handleStartAlterColumn = (column: ColumnInfo) => {
    setAlterDraft(createAlterColumnDraft(column, capabilities));
    setError(null);
  };

  const handleAlterColumn = async () => {
    if (!alterDraft) return;

    const typeChanged =
      alterDraft.type !== alterDraft.originalType ||
      alterDraft.length.trim() !== alterDraft.originalLength;
    const notNullChanged =
      alterDraft.isNotNull !== alterDraft.originalIsNotNull;

    setAlteringColumn(alterDraft.name);
    setError(null);
    try {
      await tableService.alterTableColumn(
        connectionId,
        driver,
        schema,
        tableName,
        {
          name: alterDraft.name,
          dataType: typeChanged ? alterDraft.type : null,
          length: typeChanged ? alterDraft.length.trim() || null : null,
          isNotNull: notNullChanged ? alterDraft.isNotNull : null,
          defaultMode:
            alterDraft.defaultMode === "keep" ? null : alterDraft.defaultMode,
          defaultValue:
            alterDraft.defaultMode === "set"
              ? alterDraft.defaultValue.trim()
              : null,
          commentMode:
            alterDraft.commentMode === "keep" ? null : alterDraft.commentMode,
          comment:
            alterDraft.commentMode === "set" ? alterDraft.comment : null,
        }
      );
      setAlterDraft(null);
      await refreshAfterColumnChange();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setAlteringColumn(null);
    }
  };

  const alterTypeOptions =
    alterDraft && !capabilities.commonDataTypes.includes(alterDraft.type)
      ? [alterDraft.type, ...capabilities.commonDataTypes]
      : capabilities.commonDataTypes;


  return {
    isOpen,
    onClose,
    schema,
    tableName,
    error,
    isLoading,
    columns,
    alteringColumn,
    renamingColumn,
    droppingColumn,
    isSubmitting,
    handleStartAlterColumn,
    handleRenameColumn,
    handleDropColumn,
    alterDraft,
    setAlterDraft,
    alterTypeOptions,
    updateAlterDraft,
    handleAlterColumn,
    draft,
    updateDraft,
    capabilities,
    draftAutoIncrementSupported,
    handleAddColumn,
  };
}

export type EditColumnsDialogController = ReturnType<
  typeof useEditColumnsDialogController
>;
