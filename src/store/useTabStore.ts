import { confirmDiscardTabChanges } from "@/features/workspace-tabs/model/tabLifecycle";
import type { TabState } from "@/features/workspace-tabs/model/types";
import { createCreationSlice } from "@/features/workspace-tabs/state/creationSlice";
import { createDocumentPagingSlice } from "@/features/workspace-tabs/state/documentPagingSlice";
import { createEditorSlice } from "@/features/workspace-tabs/state/editorSlice";
import { createGridDraftsSlice } from "@/features/workspace-tabs/state/gridDraftsSlice";
import { createGridFiltersSlice } from "@/features/workspace-tabs/state/gridFiltersSlice";
import { createGridLayoutSlice } from "@/features/workspace-tabs/state/gridLayoutSlice";
import { createLifecycleSlice } from "@/features/workspace-tabs/state/lifecycleSlice";
import { createNativePagingSlice } from "@/features/workspace-tabs/state/nativePagingSlice";
import { createProjectFilesSlice } from "@/features/workspace-tabs/state/projectFilesSlice";
import { createQueryExecutionSlice } from "@/features/workspace-tabs/state/queryExecutionSlice";
import { createResultsSlice } from "@/features/workspace-tabs/state/resultsSlice";
import { createRowMutationsSlice } from "@/features/workspace-tabs/state/rowMutationsSlice";
import { createSchemaToolsSlice } from "@/features/workspace-tabs/state/schemaToolsSlice";
import { createTableMetadataSlice } from "@/features/workspace-tabs/state/tableMetadataSlice";
import { createTablePagingSlice } from "@/features/workspace-tabs/state/tablePagingSlice";
import { create } from "zustand";
export {
  canCreateDataCompareSource,
  dataCompareSourceFromTab,
} from "@/features/workspace-tabs/model/dataCompare";
export { queryTextForLanguage } from "@/features/workspace-tabs/model/queryLanguage";
export { querySchemaContextForTab } from "@/features/workspace-tabs/model/tabIdentity";
export {
  hasPendingTableChanges,
  hasUnsavedTabChanges,
  tabAfterReleasingRuntimePayload,
} from "@/features/workspace-tabs/model/tabLifecycle";
export type {
  EditorSelectionState,
  EditorViewportState,
  EditorViewSelectionState,
  ProjectFileImagePreview,
  QueryLanguage,
  QueryResultGridState,
  QueryResultRun,
  TabData,
  TabType,
} from "@/features/workspace-tabs/model/types";

export const useTabStore = create<TabState>((set, get) => ({
  tabs: [],

  activeTabId: null,

  closedTabsStack: [],
  ...createCreationSlice(set, get),
  ...createSchemaToolsSlice(set, get),
  ...createProjectFilesSlice(set, get),
  ...createLifecycleSlice(set, get),
  ...createEditorSlice(set, get),
  ...createResultsSlice(set, get),
  ...createQueryExecutionSlice(set, get),
  ...createGridFiltersSlice(set, get),
  ...createGridDraftsSlice(set, get),
  ...createRowMutationsSlice(set, get),
  ...createTableMetadataSlice(set, get),
  ...createTablePagingSlice(set, get),
  ...createNativePagingSlice(set, get),
  ...createDocumentPagingSlice(set, get),
  ...createGridLayoutSlice(set, get),
}));

export function confirmDiscardTableChanges(tabId: string, action: string) {
  const tab = useTabStore.getState().tabs.find((item) => item.id === tabId);
  return !tab || confirmDiscardTabChanges([tab], action);
}

export function confirmDiscardAllTabChanges(action: string) {
  return confirmDiscardTabChanges(useTabStore.getState().tabs, action);
}

export function confirmDiscardProjectFileChanges(
  projectId: string,
  action: string,
) {
  return confirmDiscardTabChanges(
    useTabStore
      .getState()
      .tabs.filter((tab) => tab.fileProjectId === projectId),
    action,
  );
}
