import { dmlPreviewTabTitle } from "@/features/query-editor/model/dmlChangePreview";
import { queryService, schemaService } from "@/services/tauri";
import { useTabStore } from "@/store/useTabStore";
import { useCallback, useEffect, useState } from "react";

interface UseEditorChangePreviewContext {
  currentPreviewSql: string;
  activeTab:
    | import("@/features/workspace-tabs/model/types").TabData
    | undefined;
  effectiveConnectionId: string | null;
  canPreviewChanges: boolean;

  showExecutionNotice: (message: string) => void;
  editorRef: React.RefObject<
    import("monaco-editor").editor.IStandaloneCodeEditor | null
  >;

  driver: import("@/services/tauri/types").DatabaseDriver;
  capabilities: import("@/services/tauri/types").DatabaseCapabilities;
  currentSchema: string | null;
  previewChangesActionRef: React.RefObject<() => void>;
  canPreviewChangesRef: React.RefObject<boolean>;
  previewChangesContextRef: React.RefObject<{
    set: (value: boolean) => void;
  } | null>;
}

export function useEditorChangePreview({
  currentPreviewSql,
  activeTab,
  effectiveConnectionId,
  canPreviewChanges,

  showExecutionNotice,
  editorRef,

  driver,
  capabilities,
  currentSchema,
  previewChangesActionRef,
  canPreviewChangesRef,
  previewChangesContextRef,
}: UseEditorChangePreviewContext) {
  const [isPreviewingChanges, setIsPreviewingChanges] = useState(false);

  const handlePreviewChanges = useCallback(async () => {
    const sourceSql = currentPreviewSql.trim();
    if (
      !activeTab ||
      !effectiveConnectionId ||
      !canPreviewChanges ||
      isPreviewingChanges
    ) {
      if (!sourceSql)
        showExecutionNotice(
          "Place the cursor in one UPDATE, INSERT, or DELETE statement",
        );
      return;
    }

    const sourceModel = editorRef.current?.getModel?.();
    const sourceModelVersion = sourceModel?.getVersionId?.();
    const sourceTabId = activeTab.id;
    const contextIsCurrent = () =>
      useTabStore.getState().tabs.some((tab) => tab.id === sourceTabId) &&
      (!sourceModel ||
        (editorRef.current?.getModel?.() === sourceModel &&
          sourceModel.getVersionId?.() === sourceModelVersion));

    setIsPreviewingChanges(true);
    try {
      let preview = await queryService.buildDmlChangePreviewSql({
        sql: sourceSql,
        databaseType: driver,
        identifierQuote: capabilities.identifierQuote || undefined,
      });
      if (!contextIsCurrent()) return;

      const table = preview.tables.length === 1 ? preview.tables[0] : undefined;
      if (preview.operation === "update" && table?.table) {
        try {
          const columns = await schemaService.getColumns(
            effectiveConnectionId,
            table.schema || activeTab.targetSchema || currentSchema || "",
            table.table,
          );
          if (!contextIsCurrent()) return;
          if (columns.length > 0) {
            preview = await queryService.buildDmlChangePreviewSql({
              sql: sourceSql,
              databaseType: driver,
              identifierQuote: capabilities.identifierQuote || undefined,
              columns: columns.map((column) => column.name),
            });
          }
        } catch {
          // Metadata is an ordering enhancement only. The parser-generated
          // wildcard preview remains complete when metadata is unavailable.
        }
      }
      if (!contextIsCurrent()) return;

      const previewSql = `/* Change preview · ${preview.operation.toUpperCase()} · original DML was not executed */\n${preview.sql}`;
      const tabs = useTabStore.getState();
      const previewTabId = tabs.createTab(
        "query",
        dmlPreviewTabTitle(preview.operation),
        previewSql,
        {
          connectionId: effectiveConnectionId,
          databaseName: activeTab.databaseName || undefined,
          schemaName: activeTab.targetSchema || currentSchema || undefined,
        },
      );
      await useTabStore
        .getState()
        .runTabQuery(previewTabId, effectiveConnectionId);
    } catch (error) {
      showExecutionNotice(
        error instanceof Error
          ? error.message
          : "Unable to build a safe change preview for this statement",
      );
    } finally {
      setIsPreviewingChanges(false);
    }
  }, [
    activeTab,
    canPreviewChanges,
    capabilities.identifierQuote,
    currentPreviewSql,
    currentSchema,
    driver,
    effectiveConnectionId,
    isPreviewingChanges,
    showExecutionNotice,
  ]);
  previewChangesActionRef.current = () => void handlePreviewChanges();
  canPreviewChangesRef.current = canPreviewChanges;

  useEffect(() => {
    previewChangesContextRef.current?.set(canPreviewChanges);
  }, [canPreviewChanges]);

  return { handlePreviewChanges, isPreviewingChanges };
}
