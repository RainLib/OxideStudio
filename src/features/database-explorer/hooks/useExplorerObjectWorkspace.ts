import { createExplorerObjectActions } from "@/features/database-explorer/model/createExplorerObjectActions";
import { useTableOperations } from "@/hooks/useTableOperations";
import { useState } from "react";
export function useExplorerObjectWorkspace() {
  const [isCreateViewDialogOpen, setIsCreateViewDialogOpen] = useState(false);

  const [viewDialogMode, setViewDialogMode] = useState<"create" | "edit">(
    "create",
  );

  const [viewDialogKind, setViewDialogKind] = useState<
    "view" | "materializedView"
  >("view");

  const [viewDialogInitialName, setViewDialogInitialName] = useState("");

  const [viewDialogInitialSql, setViewDialogInitialSql] = useState("");

  const [renameDialogOpen, setRenameDialogOpen] = useState(false);

  const [ddlViewerOpen, setDdlViewerOpen] = useState(false);

  const [columnsDialogOpen, setColumnsDialogOpen] = useState(false);

  const [activeTable, setActiveTable] = useState("");

  const [activeTableType, setActiveTableType] = useState<string | null>(null);

  const [ddlContent, setDdlContent] = useState("");

  const {
    truncateTable,
    dropTable,
    renameTable,
    exportTableData,
    activeTableExport,
    cancelActiveTableExport,
    importTableData,
    getTableDdl,
    getViewDefinition,
    refreshMaterializedView,
  } = useTableOperations();

  const {
    copyText,
    handleRenameClick,
    handleDdlClick,
    handleCopyTableDdl,
    handleEditColumnsClick,
    handleEditViewClick,
    handleTruncateClick,
    handleDropClick,
    handleRefreshMaterializedViewClick,
  } = createExplorerObjectActions({
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
  });
  return {
    isCreateViewDialogOpen,
    setIsCreateViewDialogOpen,
    viewDialogMode,
    setViewDialogMode,
    viewDialogKind,
    setViewDialogKind,
    viewDialogInitialName,
    setViewDialogInitialName,
    viewDialogInitialSql,
    setViewDialogInitialSql,
    renameDialogOpen,
    setRenameDialogOpen,
    ddlViewerOpen,
    setDdlViewerOpen,
    columnsDialogOpen,
    setColumnsDialogOpen,
    activeTable,
    setActiveTable,
    activeTableType,
    setActiveTableType,
    ddlContent,
    setDdlContent,
    renameTable,
    exportTableData,
    activeTableExport,
    cancelActiveTableExport,
    importTableData,
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
