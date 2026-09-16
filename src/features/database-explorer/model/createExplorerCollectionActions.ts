import type { ConnectionConfig } from "@/features/connections/model/types";
import { searchIndexClearTouched } from "@/features/database-explorer/model/elasticsearchIndexActions";
import type { TabData, TabType } from "@/features/workspace-tabs/model/types";
import { queryService } from "@/services/tauri";
import type { SearchIndexClearResult } from "@/services/tauri/types";
import type { DatabaseCapabilities } from "@/services/tauri/types/database";
import type { CollectionInfo } from "@/services/tauri/types/schemaCatalog";
import { useTabStore } from "@/store/useTabStore";

interface CreateExplorerCollectionActionsContext {
  collectionPreviewSql: (collection: CollectionInfo) => string;
  elasticsearchClearTarget: {
    connectionId: string;
    driver: string;
    schema: string;
    index: string;
  } | null;
  loadCollections: (
    connectionId: string,
    namespace: string,
    force?: boolean | undefined,
    filter?: string | undefined,
    revalidateCached?: boolean | undefined,
  ) => Promise<void>;
  bumpMetadataVersion: () => void;
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
  activeConnectionId: string | null;
  collectionDeleteSql: (collection: CollectionInfo) => string | null;
  activeCapabilities: DatabaseCapabilities;
  collectionLabel: string;
  createTab: (
    type?: TabType | undefined,
    title?: string | undefined,
    initialSql?: string | undefined,
    metadata?:
      | Partial<
          Pick<
            TabData,
            | "connectionId"
            | "databaseName"
            | "tableName"
            | "schemaName"
            | "objectType"
            | "queryLanguage"
            | "elasticsearchVariables"
            | "filters"
            | "fileProjectId"
            | "savedSqlProjectId"
            | "savedSqlFileId"
            | "fileRootPath"
            | "fileRelativePath"
            | "fileRevision"
            | "filePreview"
            | "isDirty"
            | "targetSchema"
            | "agentFileDiffPreview"
            | "gitFileDiffPreview"
          >
        >
      | undefined,
  ) => string;
  collectionNamespace: string;
  runCollectionMutation: (tabId: string, sql: string) => Promise<void>;
  activeConnection: ConnectionConfig | undefined;
  setIsCreateRedisKeyOpen: React.Dispatch<React.SetStateAction<boolean>>;
  collectionCreateSql: (name: string) => string | null;
  refreshCollectionObjects: () => Promise<void>;
  selectTable: (table: string | null) => void;
}

export function createExplorerCollectionActions({
  collectionPreviewSql,
  elasticsearchClearTarget,
  loadCollections,
  bumpMetadataVersion,
  loadDocumentPage,
  activeConnectionId,
  collectionDeleteSql,
  activeCapabilities,
  collectionLabel,
  createTab,
  collectionNamespace,
  runCollectionMutation,
  activeConnection,
  setIsCreateRedisKeyOpen,
  collectionCreateSql,
  refreshCollectionObjects,
  selectTable,
}: CreateExplorerCollectionActionsContext) {
  const handleCopyCollectionPreview = async (collection: CollectionInfo) => {
    try {
      await navigator.clipboard.writeText(collectionPreviewSql(collection));
    } catch (err: any) {
      window.alert(`Failed to copy preview request: ${err?.message || err}`);
    }
  };

  const handleElasticsearchIndexCleared = async (
    _result: SearchIndexClearResult,
    clearedIndex: string,
  ) => {
    const target = elasticsearchClearTarget;
    if (!target) return;
    await loadCollections(target.connectionId, target.schema, true);
    bumpMetadataVersion();
    const tabs = useTabStore
      .getState()
      .tabs.filter(
        (tab) =>
          tab.connectionId === target.connectionId &&
          Boolean(tab.tableName) &&
          searchIndexClearTouched(clearedIndex, tab.tableName || ""),
      );
    await Promise.allSettled(tabs.map((tab) => loadDocumentPage(tab.id, 0)));
  };

  const handleDeleteCollectionClick = (collection: CollectionInfo) => {
    if (!activeConnectionId) return;

    const sql = collectionDeleteSql(collection);
    if (!sql) {
      window.alert(
        `${activeCapabilities.displayName} ${collectionLabel.toLowerCase()} deletion is not supported.`,
      );
      return;
    }

    const confirmed = window.confirm(
      `Delete ${collectionLabel.toLowerCase()} "${collection.name}"? This cannot be undone.`,
    );
    if (!confirmed) return;

    const tabId = createTab("query", `Delete ${collection.name}`, sql, {
      connectionId: activeConnectionId,
      schemaName: collectionNamespace || undefined,
      tableName: collection.name,
      objectType: collection.type || null,
    });
    void runCollectionMutation(tabId, sql);
  };

  const handleCreateCollectionClick = () => {
    if (!activeConnectionId) return;

    if (
      activeCapabilities.dataModel === "keyValue" &&
      activeConnection?.driver === "redis"
    ) {
      setIsCreateRedisKeyOpen(true);
      return;
    }

    const rawName = window.prompt(`New ${collectionLabel.toLowerCase()} name:`);
    if (rawName === null) return;

    const name = rawName.trim();
    if (!name) return;

    const sql = collectionCreateSql(name);
    if (!sql) {
      window.alert(
        `${activeCapabilities.displayName} ${collectionLabel.toLowerCase()} creation is not supported.`,
      );
      return;
    }

    const tabId = createTab(
      "query",
      `Create ${collectionLabel}: ${name}`,
      sql,
      {
        connectionId: activeConnectionId,
        schemaName: collectionNamespace || undefined,
        tableName: name,
        objectType: collectionLabel.toLowerCase(),
      },
    );
    void runCollectionMutation(tabId, sql);
  };

  const handleCreateRedisKey = async (name: string, command: string) => {
    if (!activeConnectionId) throw new Error("No active Redis connection.");
    const normalizedName = name.trim();
    const existing = await queryService.executeQuery(
      activeConnectionId,
      `EXISTS ${JSON.stringify(normalizedName)}`,
      collectionNamespace || undefined,
    );
    if (Number(existing[0]?.rows?.[0]?.[1] ?? 0) > 0) {
      throw new Error(`Key "${normalizedName}" already exists.`);
    }
    await queryService.executeQuery(
      activeConnectionId,
      command,
      collectionNamespace || undefined,
    );
    await refreshCollectionObjects();
    selectTable(normalizedName);
  };

  // Highlight matching text

  return {
    handleCopyCollectionPreview,
    handleElasticsearchIndexCleared,
    handleDeleteCollectionClick,
    handleCreateCollectionClick,
    handleCreateRedisKey,
  };
}
