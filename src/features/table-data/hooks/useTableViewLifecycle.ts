import type {
  TabData,
  TablePageLoadOptions,
} from "@/features/workspace-tabs/model/types";
import type { TableFilter } from "@/services/tauri/types/tableRows";
import { useEffect } from "react";

interface TableViewLifecycleOptions {
  setMetadataError: React.Dispatch<React.SetStateAction<string | null>>;
  setCsvImportSource: React.Dispatch<
    React.SetStateAction<{
      file: File;
      nativePath?: string | undefined;
      previewTruncated?: boolean | undefined;
      contentDigest?: string | undefined;
    } | null>
  >;
  setIsTransferDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setShowDdl: React.Dispatch<React.SetStateAction<boolean>>;
  setShowStructure: React.Dispatch<React.SetStateAction<boolean>>;
  setMongoDocumentAction: React.Dispatch<
    React.SetStateAction<{
      mode: "clone" | "edit" | "delete";
      sourceId: unknown;
    } | null>
  >;
  setDocumentFilterDraft: React.Dispatch<React.SetStateAction<string>>;
  activeTab: TabData | undefined;
  setDocumentSortDraft: React.Dispatch<React.SetStateAction<string>>;
  showDdl: boolean;
  tableDdl: string;
  isDdlLoading: boolean;
  ddlError: string | null;
  refreshDdl: (force?: boolean) => Promise<void>;
  refreshDdlOnOpen: boolean;
  tabConnectionId: string | null;
  isSearchObjectPreview: boolean;
  loadDocumentPage: (
    tabId: string,
    page?: number | undefined,
    options?:
      | {
          filter?: string | null | undefined;
          sort?: string | null | undefined;
          discardAction?: string | undefined;
          discardDraftsConfirmed?: boolean | undefined;
        }
      | undefined,
  ) => Promise<boolean>;
  isNativeObjectPreview: boolean;
  runTabQuery: (
    id: string,
    connectionId: string,
    sqlOverride?: string | undefined,
    transactionId?: string | undefined,
    sourceStartOffset?: number | undefined,
  ) => Promise<void>;
  loadTablePage: (
    tabId: string,
    page?: number | undefined,
    filterSql?: string | null | undefined,
    filters?: TableFilter[] | null | undefined,
    options?: TablePageLoadOptions | undefined,
  ) => Promise<boolean>;
}

export function useTableViewLifecycle({
  setMetadataError,
  setCsvImportSource,
  setIsTransferDialogOpen,
  setShowDdl,
  setShowStructure,
  setMongoDocumentAction,
  setDocumentFilterDraft,
  activeTab,
  setDocumentSortDraft,
  showDdl,
  tableDdl,
  isDdlLoading,
  ddlError,
  refreshDdl,
  refreshDdlOnOpen,
  tabConnectionId,
  isSearchObjectPreview,
  loadDocumentPage,
  isNativeObjectPreview,
  runTabQuery,
  loadTablePage,
}: TableViewLifecycleOptions) {
  useEffect(() => {
    setMetadataError(null);
    setCsvImportSource(null);
    setIsTransferDialogOpen(false);
    setShowDdl(false);
    setShowStructure(false);
    setMongoDocumentAction(null);
    setDocumentFilterDraft(activeTab?.documentFilter || "");
    setDocumentSortDraft(activeTab?.documentSort || "");
  }, [activeTab?.id]);

  useEffect(() => {
    if (showDdl && !tableDdl && !isDdlLoading && !ddlError) {
      void refreshDdl(refreshDdlOnOpen);
    }
  }, [ddlError, isDdlLoading, refreshDdl, refreshDdlOnOpen, showDdl, tableDdl]);

  // Auto-fetch data on mount if no results
  useEffect(() => {
    if (
      activeTab &&
      activeTab.type === "table" &&
      !activeTab.results &&
      !activeTab.isExecuting &&
      !activeTab.error &&
      tabConnectionId &&
      activeTab.tableName &&
      activeTab.schemaName
    ) {
      if (isSearchObjectPreview) {
        void loadDocumentPage(activeTab.id, 0);
      } else if (isNativeObjectPreview && activeTab.sql.trim()) {
        void runTabQuery(activeTab.id, tabConnectionId, activeTab.sql);
      } else {
        void loadTablePage(activeTab.id, 0);
      }
    }
  }, [
    activeTab,
    isNativeObjectPreview,
    isSearchObjectPreview,
    loadDocumentPage,
    loadTablePage,
    runTabQuery,
    tabConnectionId,
  ]);
}
