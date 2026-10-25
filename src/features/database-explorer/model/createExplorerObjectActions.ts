import { confirmAction, showMessage } from "@/lib/appDialogs";
import type { TableOperationTarget } from "@/hooks/useTableOperations";
import {
  isMaterializedViewObject,
  isReadOnlyRelationObject,
  isViewObject,
  relationObjectLabel,
} from "@/lib/databaseDialect";
import type { TableInfo } from "@/services/tauri/types";

interface CreateExplorerObjectActionsContext {
  setActiveTable: React.Dispatch<React.SetStateAction<string>>;
  setActiveTableType: React.Dispatch<React.SetStateAction<string | null>>;
  setRenameDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  getTableDdl: (
    tableName: string,
    objectType?: string | null | undefined,
    target?: TableOperationTarget | undefined,
  ) => Promise<string>;
  setDdlContent: React.Dispatch<React.SetStateAction<string>>;
  setDdlViewerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setColumnsDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  getViewDefinition: (
    viewName: string,
    objectType?: string | null | undefined,
    target?: TableOperationTarget | undefined,
  ) => Promise<string>;
  setViewDialogMode: React.Dispatch<React.SetStateAction<"create" | "edit">>;
  setViewDialogKind: React.Dispatch<
    React.SetStateAction<"view" | "materializedView">
  >;
  setViewDialogInitialName: React.Dispatch<React.SetStateAction<string>>;
  setViewDialogInitialSql: React.Dispatch<React.SetStateAction<string>>;
  setIsCreateViewDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  truncateTable: (
    tableName: string,
    target?: TableOperationTarget | undefined,
  ) => Promise<void>;
  dropTable: (
    tableName: string,
    objectType?: string | null | undefined,
    target?: TableOperationTarget | undefined,
  ) => Promise<void>;
  refreshMaterializedView: (
    viewName: string,
    objectType?: string | null | undefined,
    target?: TableOperationTarget | undefined,
  ) => Promise<void>;
}

export function createExplorerObjectActions({
  setActiveTable,
  setActiveTableType,
  setRenameDialogOpen,
  getTableDdl,
  setDdlContent,
  setDdlViewerOpen,
  setColumnsDialogOpen,
  getViewDefinition,
  setViewDialogMode,
  setViewDialogKind,
  setViewDialogInitialName,
  setViewDialogInitialSql,
  setIsCreateViewDialogOpen,
  truncateTable,
  dropTable,
  refreshMaterializedView,
}: CreateExplorerObjectActionsContext) {
  const copyText = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch (error: any) {
      showMessage(`Failed to copy: ${error?.message || error}`);
    }
  };

  const handleRenameClick = (table: TableInfo) => {
    setActiveTable(table.name);
    setActiveTableType(table.type || null);
    setRenameDialogOpen(true);
  };

  const handleDdlClick = async (
    table: TableInfo,
    target?: TableOperationTarget,
  ) => {
    setActiveTable(table.name);
    setActiveTableType(table.type || null);
    const ddl = await getTableDdl(table.name, table.type, target);
    setDdlContent(ddl);
    setDdlViewerOpen(true);
  };

  const handleCopyTableDdl = async (
    table: TableInfo,
    target?: TableOperationTarget,
  ) => {
    const ddl = await getTableDdl(table.name, table.type, target);
    await copyText(ddl);
  };

  const handleEditColumnsClick = (table: TableInfo) => {
    setActiveTable(table.name);
    setActiveTableType(table.type || null);
    setColumnsDialogOpen(true);
  };

  const handleEditViewClick = async (
    table: TableInfo,
    target?: TableOperationTarget,
  ) => {
    if (!isViewObject(table.type) || isMaterializedViewObject(table.type))
      return;
    setActiveTable(table.name);
    setActiveTableType(table.type || null);

    try {
      const definition = await getViewDefinition(
        table.name,
        table.type,
        target,
      );
      setViewDialogMode("edit");
      setViewDialogKind("view");
      setViewDialogInitialName(table.name);
      setViewDialogInitialSql(definition);
      setIsCreateViewDialogOpen(true);
    } catch (e: any) {
      showMessage(`Failed to load view definition: ${e}`);
    }
  };

  const handleTruncateClick = async (
    table: TableInfo,
    target?: TableOperationTarget,
  ) => {
    if (isReadOnlyRelationObject(table.type)) return;
    const confirmed = (await confirmAction(
      `Empty all rows from "${table.name}"? This cannot be undone.`,
    ));
    if (!confirmed) return;
    await truncateTable(table.name, target);
  };

  const handleDropClick = async (
    table: TableInfo,
    target?: TableOperationTarget,
  ) => {
    const label = relationObjectLabel(table.type).toLowerCase();
    const confirmed = (await confirmAction(
      `Drop ${label} "${table.name}"? This will remove the ${label}.`,
    ));
    if (!confirmed) return;
    await dropTable(table.name, table.type, target);
  };

  const handleRefreshMaterializedViewClick = async (
    table: TableInfo,
    target?: TableOperationTarget,
  ) => {
    if (!isMaterializedViewObject(table.type)) return;
    try {
      await refreshMaterializedView(table.name, table.type, target);
    } catch (e: any) {
      showMessage(`Failed to refresh materialized view: ${e}`);
    }
  };

  return {
    copyText,
    handleRenameClick,
    handleDdlClick,
    handleCopyTableDdl,
    handleEditColumnsClick,
    handleEditViewClick,
    handleTruncateClick,
    handleDropClick,
    handleRefreshMaterializedViewClick,
  };
}
