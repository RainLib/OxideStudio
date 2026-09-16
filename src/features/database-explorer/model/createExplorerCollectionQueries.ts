import {
  collectionCreateQueryTemplateForCapabilities,
  collectionDeleteQueryTemplateForCapabilities,
  collectionPreviewQueryTemplateForCapabilities,
  collectionPreviewTabTitleForCapabilities,
} from "@/lib/databaseObjectPreview";
import type { CollectionInfo } from "@/services/tauri/types";
import type { DatabaseCapabilities } from "@/services/tauri/types/database";
import { useTabStore } from "@/store/useTabStore";

interface CreateExplorerCollectionQueriesContext {
  selectTable: (table: string | null) => void;
  activeCapabilities: DatabaseCapabilities;
  collectionNamespaceForTemplate: string | null;
  activeConnectionId: string | null;
  canBrowseCollections: boolean;
  loadCollections: (
    connectionId: string,
    namespace: string,
    force?: boolean | undefined,
    filter?: string | undefined,
    revalidateCached?: boolean | undefined,
  ) => Promise<void>;
  collectionNamespace: string;
  bumpMetadataVersion: () => void;
  runTabQuery: (
    id: string,
    connectionId: string,
    sqlOverride?: string | undefined,
    transactionId?: string | undefined,
    sourceStartOffset?: number | undefined,
  ) => Promise<void>;
  findOrCreateObjectDataTab: (
    connectionId: string,
    schemaName: string | null | undefined,
    objectName: string,
    objectType: string | null | undefined,
    previewCommand: string,
    title?: string | undefined,
  ) => string;
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
}

export function createExplorerCollectionQueries({
  selectTable,
  activeCapabilities,
  collectionNamespaceForTemplate,
  activeConnectionId,
  canBrowseCollections,
  loadCollections,
  collectionNamespace,
  bumpMetadataVersion,
  runTabQuery,
  findOrCreateObjectDataTab,
  loadDocumentPage,
}: CreateExplorerCollectionQueriesContext) {
  const handleCollectionSelect = (collectionName: string) => {
    selectTable(collectionName);
  };

  const collectionPreviewSql = (collection: CollectionInfo) =>
    collectionPreviewQueryTemplateForCapabilities(
      activeCapabilities,
      collectionNamespaceForTemplate,
      collection,
    );

  const collectionDeleteSql = (collection: CollectionInfo) =>
    collectionDeleteQueryTemplateForCapabilities(
      activeCapabilities,
      collectionNamespaceForTemplate,
      collection,
    );

  const collectionCreateSql = (name: string) =>
    collectionCreateQueryTemplateForCapabilities(
      activeCapabilities,
      collectionNamespaceForTemplate,
      name,
    );

  const refreshCollectionObjects = async () => {
    if (!activeConnectionId || !canBrowseCollections) return;
    await loadCollections(activeConnectionId, collectionNamespace, true);
    bumpMetadataVersion();
  };

  const runCollectionMutation = async (tabId: string, sql: string) => {
    if (!activeConnectionId) return;

    await runTabQuery(tabId, activeConnectionId, sql);
    const tab = useTabStore.getState().tabs.find((item) => item.id === tabId);
    if (!tab?.error) {
      await refreshCollectionObjects();
    }
  };

  const handleCollectionDoubleClick = (collection: CollectionInfo) => {
    if (!activeConnectionId) return;

    const previewCommand = collectionPreviewSql(collection);
    const tabId = findOrCreateObjectDataTab(
      activeConnectionId,
      collectionNamespace,
      collection.name,
      collection.type,
      previewCommand,
      collectionPreviewTabTitleForCapabilities(
        activeCapabilities,
        collection,
        collectionNamespaceForTemplate,
      ),
    );
    if (activeCapabilities.dataModel === "search") {
      void loadDocumentPage(tabId, 0);
    } else {
      void runTabQuery(tabId, activeConnectionId, previewCommand);
    }
  };

  return {
    handleCollectionSelect,
    collectionPreviewSql,
    collectionDeleteSql,
    collectionCreateSql,
    refreshCollectionObjects,
    runCollectionMutation,
    handleCollectionDoubleClick,
  };
}
