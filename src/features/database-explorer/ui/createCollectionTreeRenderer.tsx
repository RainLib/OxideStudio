import type { useConnectionStore } from "@/store/useConnectionStore";
import type { useDatabaseExplorerStore } from "@/store/useDatabaseExplorerStore";
import type { useTabStore } from "@/store/useTabStore";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  explorerActivationLabel,
  shouldActivateExplorerObject,
} from "@/features/database-explorer/model/explorerActivation";
import { explorerObjectIconClass } from "@/features/database-explorer/model/explorerObjectPresentation";
import {
  nacosLocationFromCollection,
  tableTreeKey,
} from "@/features/database-explorer/model/explorerSidebarPresentation";
import { explorerNodeId } from "@/features/database-explorer/model/explorerTreeNode";
import { ExplorerSharedContextMenu } from "@/features/database-explorer/ui/ExplorerContextMenuHost";
import {
  EXPLORER_MENU_CONTENT_CLASS as menuContentClass,
  EXPLORER_MENU_ITEM_CLASS as menuItemClass,
  EXPLORER_MENU_SEPARATOR_CLASS as menuSeparatorClass,
  EXPLORER_SIDEBAR_MENU_SUB_CLASS as menuSubClass,
} from "@/features/database-explorer/ui/explorerStyles";
import { moveExplorerTreeFocus } from "@/features/database-explorer/ui/explorerTreeDom";
import { TableObjectTree } from "@/features/database-explorer/ui/TableObjectTree";
import { normalizeDatabaseDriverName } from "@/lib/databaseDialect";
import { databaseObjectNavigationKey } from "@/lib/databaseNavigation";
import { collectionDisplayLabelForCapabilities } from "@/lib/databaseObjectPreview";
import { cn } from "@/lib/utils";
import type { CollectionInfo } from "@/services/tauri/types";
import {
  ArrowRightLeft,
  Boxes,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Code2,
  Eye,
  EyeOff,
  KeyRound,
  ListOrdered,
  SearchCode,
  TableProperties,
  Trash2,
  X,
} from "lucide-react";

type ConnectionState = ReturnType<typeof useConnectionStore.getState>;

type DatabaseExplorerState = ReturnType<
  typeof useDatabaseExplorerStore.getState
>;

type TabState = ReturnType<typeof useTabStore.getState>;

interface CreateCollectionTreeRendererContext {
  collectionDeleteSql: (
    collection: import("@/services/tauri/types").CollectionInfo,
  ) => string | null;
  driver: string | null | undefined;
  activeDriver: import("@/services/tauri/types").DatabaseDriver;
  activeCapabilities: import("@/services/tauri/types").DatabaseCapabilities;
  isCurrentSchema: boolean;
  selectedTable: string | null;
  connectionId: string;
  navigationDatabaseName: string | undefined;
  schema: string;
  expandedTableKeys: string[];
  selectedExplorerNodeIds: string[];
  schemaObjects: {
    tables: import("@/services/tauri/types").TableInfo[];
    collections: import("@/services/tauri/types").CollectionInfo[];
    functions: import("@/services/tauri/types").FunctionInfo[];
    pinnedTables: string[];
    hasSnapshot: boolean;
  };
  selectExplorerNode: (
    nodeId: string,
    event?:
      | {
          currentTarget: HTMLElement;
          ctrlKey: boolean;
          metaKey: boolean;
          shiftKey: boolean;
        }
      | undefined,
  ) => void;
  explorerActivationMode: import("@/lib/appSettings").ExplorerActivationMode;
  runForSchema: (
    targetSchema: string,
    action: () => void | Promise<void>,
  ) => Promise<void>;
  handleCollectionDoubleClick: (
    collection: import("@/services/tauri/types").CollectionInfo,
  ) => void;
  handleCollectionSelect: (collectionName: string) => void;
  showExplorerHoverTooltips: boolean;
  setExpandedTableKeys: React.Dispatch<React.SetStateAction<string[]>>;
  highlightMatch: (text: string, filter: string) => import("react").JSX.Element;
  filterText: string;

  collectionPreviewSql: (
    collection: import("@/services/tauri/types").CollectionInfo,
  ) => string;
  createTab: TabState["createTab"];
  objectConnection:
    | import("@/store/useConnectionStore").ConnectionConfig
    | undefined;

  copyText: (value: string) => Promise<void>;
  handleCopyCollectionPreview: (
    collection: import("@/services/tauri/types").CollectionInfo,
  ) => Promise<void>;

  hideExplorerNodes: DatabaseExplorerState["hideNodes"];
  explorerStateScope: string;
  objectVisibilityParentId: string;
  showOnlyExplorerNodes: DatabaseExplorerState["showOnlyNodes"];
  objectVisibilityFilter:
    | import("@/features/database-explorer/model/explorerVisibilityFilter").ExplorerVisibilityFilter
    | undefined;
  clearExplorerVisibilityFilter: DatabaseExplorerState["clearVisibilityFilter"];
  openExplorerVisibilityFilter: (parentNodeId: string, label: string) => void;
  setElasticsearchMetadataTarget: React.Dispatch<
    React.SetStateAction<{
      connectionId: string;
      driver: string;
      index: string;
      kind: import("@/services/tauri/types").SearchIndexMetadataKind;
    } | null>
  >;
  setNacosConfigTransferRequest: React.Dispatch<
    React.SetStateAction<
      | import("@/features/database-explorer/model/explorerSidebarTypes").ExplorerNacosConfigTransferRequest
      | null
    >
  >;
  connections: ConnectionState["connections"];
  setMongoCollectionTransferRequest: React.Dispatch<
    React.SetStateAction<
      | import("@/features/database-explorer/model/explorerSidebarTypes").ExplorerMongoCollectionTransferRequest
      | null
    >
  >;
  setElasticsearchClearTarget: React.Dispatch<
    React.SetStateAction<{
      connectionId: string;
      driver: string;
      schema: string;
      index: string;
    } | null>
  >;
  handleDeleteCollectionClick: (
    collection: import("@/services/tauri/types").CollectionInfo,
  ) => void;
  collectionLabel: string;
  activeProjectId: string;
}

export function createCollectionTreeRenderer({
  collectionDeleteSql,
  driver,
  activeDriver,
  activeCapabilities,
  isCurrentSchema,
  selectedTable,
  connectionId,
  navigationDatabaseName,
  schema,
  expandedTableKeys,
  selectedExplorerNodeIds,
  schemaObjects,
  selectExplorerNode,
  explorerActivationMode,
  runForSchema,
  handleCollectionDoubleClick,
  handleCollectionSelect,
  showExplorerHoverTooltips,
  setExpandedTableKeys,
  highlightMatch,
  filterText,

  collectionPreviewSql,
  createTab,
  objectConnection,

  copyText,
  handleCopyCollectionPreview,

  hideExplorerNodes,
  explorerStateScope,
  objectVisibilityParentId,
  showOnlyExplorerNodes,
  objectVisibilityFilter,
  clearExplorerVisibilityFilter,
  openExplorerVisibilityFilter,
  setElasticsearchMetadataTarget,
  setNacosConfigTransferRequest,
  connections,
  setMongoCollectionTransferRequest,
  setElasticsearchClearTarget,
  handleDeleteCollectionClick,
  collectionLabel,
  activeProjectId,
}: CreateCollectionTreeRendererContext) {
  const renderCollectionItem = (
    collection: CollectionInfo,
    label: string | undefined = undefined,
    depth = 0,
  ) => {
    const canDeleteCollection = Boolean(collectionDeleteSql(collection));
    const collectionDriver = driver || activeDriver;
    const displayLabel =
      label ??
      collectionDisplayLabelForCapabilities(activeCapabilities, collection);
    const isElasticsearchIndex =
      normalizeDatabaseDriverName(collectionDriver) === "elasticsearch" &&
      collection.type === "index";
    const isMongoCollection =
      normalizeDatabaseDriverName(collectionDriver) === "mongodb" &&
      activeCapabilities.dataModel === "document";
    const nacosLocation =
      normalizeDatabaseDriverName(collectionDriver) === "nacos"
        ? nacosLocationFromCollection(collection)
        : null;
    const isSelectedCollection =
      isCurrentSchema && selectedTable === collection.name;
    const canExpandCollectionMetadata =
      activeCapabilities.dataModel === "document" ||
      activeCapabilities.dataModel === "search";
    const collectionTreeKey = tableTreeKey(
      connectionId,
      driver,
      navigationDatabaseName,
      schema,
      collection.name,
    );
    const isCollectionExpanded = expandedTableKeys.includes(collectionTreeKey);
    const collectionExplorerKind = isElasticsearchIndex
      ? "search-index"
      : isMongoCollection
        ? "collection"
        : "key";
    const collectionExplorerNodeId = explorerNodeId(
      collectionExplorerKind,
      connectionId,
      navigationDatabaseName,
      schema,
      collection.name,
    );
    const isExplorerCollectionSelected = selectedExplorerNodeIds.includes(
      collectionExplorerNodeId,
    );
    const collectionNodeIdsForAction = isExplorerCollectionSelected
      ? schemaObjects.collections
          .map((candidate) =>
            explorerNodeId(
              collectionExplorerKind,
              connectionId,
              navigationDatabaseName,
              schema,
              candidate.name,
            ),
          )
          .filter((nodeId) => selectedExplorerNodeIds.includes(nodeId))
      : [collectionExplorerNodeId];

    return (
      <div key={`${schema}:${collection.name}`}>
        <ExplorerSharedContextMenu nodeId={collectionExplorerNodeId}>
          <ContextMenuTrigger>
            <div
              role="treeitem"
              data-explorer-node-id={collectionExplorerNodeId}
              data-database-object-key={databaseObjectNavigationKey({
                connectionId,
                databaseName: navigationDatabaseName,
                schemaName: schema,
                objectName: collection.name,
              })}
              tabIndex={isExplorerCollectionSelected ? 0 : -1}
              aria-selected={isExplorerCollectionSelected}
              aria-expanded={
                canExpandCollectionMetadata ? isCollectionExpanded : undefined
              }
              className={cn(
                "group flex h-7 cursor-pointer select-none items-center gap-2 rounded-[3px] pr-2 text-[11px] transition-colors",
                isSelectedCollection || isExplorerCollectionSelected
                  ? "wb-tree-row-selected"
                  : "text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-active-strong)/0.55)] hover:text-[hsl(var(--wb-text))]",
              )}
              style={{ paddingLeft: `${8 + depth * 14}px` }}
              onClick={(event) => {
                selectExplorerNode(collectionExplorerNodeId, event);
                if (
                  shouldActivateExplorerObject(
                    explorerActivationMode,
                    "click",
                    event.detail,
                  )
                ) {
                  void runForSchema(schema, () =>
                    handleCollectionDoubleClick(collection),
                  );
                  return;
                }
                void runForSchema(schema, () =>
                  handleCollectionSelect(collection.name),
                );
              }}
              onContextMenu={() => selectExplorerNode(collectionExplorerNodeId)}
              onDoubleClick={() => {
                if (
                  shouldActivateExplorerObject(
                    explorerActivationMode,
                    "double-click",
                  )
                ) {
                  void runForSchema(schema, () =>
                    handleCollectionDoubleClick(collection),
                  );
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  moveExplorerTreeFocus(
                    event.currentTarget,
                    event.key === "ArrowDown" ? 1 : -1,
                  );
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  void runForSchema(schema, () =>
                    handleCollectionDoubleClick(collection),
                  );
                }
              }}
              title={
                showExplorerHoverTooltips
                  ? displayLabel === collection.name
                    ? collection.name
                    : `${displayLabel}\n${collection.name}`
                  : undefined
              }
              aria-label={`${displayLabel}. ${explorerActivationLabel(explorerActivationMode)} to open data.`}
            >
              {canExpandCollectionMetadata && (
                <button
                  type="button"
                  className="-mr-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] wb-muted hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]"
                  aria-label={`${isCollectionExpanded ? "Collapse" : "Expand"} ${collection.name} metadata`}
                  aria-expanded={isCollectionExpanded}
                  onClick={(event) => {
                    event.stopPropagation();
                    setExpandedTableKeys((current) =>
                      current.includes(collectionTreeKey)
                        ? current.filter((key) => key !== collectionTreeKey)
                        : [...current, collectionTreeKey],
                    );
                  }}
                  onDoubleClick={(event) => event.stopPropagation()}
                >
                  {isCollectionExpanded ? (
                    <ChevronDown size={10} />
                  ) : (
                    <ChevronRight size={10} />
                  )}
                </button>
              )}
              {isElasticsearchIndex ? (
                <SearchCode
                  size={12}
                  className={cn(
                    "shrink-0",
                    explorerObjectIconClass("search-index"),
                  )}
                />
              ) : isMongoCollection ? (
                <Boxes
                  size={12}
                  className={cn(
                    "shrink-0",
                    explorerObjectIconClass("collection"),
                  )}
                />
              ) : (
                <KeyRound
                  size={12}
                  className={cn(
                    "shrink-0",
                    explorerObjectIconClass("key"),
                    isSelectedCollection && "opacity-100",
                  )}
                />
              )}
              <span className="min-w-0 flex-1 truncate">
                {highlightMatch(displayLabel || "(empty)", filterText)}
              </span>
              {collection.documentCount != null && (
                <span
                  className="shrink-0 text-[9px] tabular-nums opacity-55"
                  title={`${collection.documentCount.toLocaleString()} documents`}
                >
                  {collection.documentCount.toLocaleString()}
                </span>
              )}
              {collection.type && (
                <span className="shrink-0 text-[9px] uppercase opacity-50">
                  {collection.type}
                </span>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className={menuContentClass}>
            <ContextMenuItem
              className={menuItemClass}
              onClick={() =>
                void runForSchema(schema, () =>
                  handleCollectionDoubleClick(collection),
                )
              }
            >
              <TableProperties className="mr-2 h-3.5 w-3.5" />
              Open Data
            </ContextMenuItem>
            <ContextMenuItem
              className={menuItemClass}
              onClick={() => {
                const previewCommand = collectionPreviewSql(collection);
                createTab(
                  "query",
                  `${collection.name} [${objectConnection?.name || "query"}]`,
                  previewCommand,
                  {
                    connectionId,
                    databaseName: navigationDatabaseName,
                    schemaName: schema,
                    tableName: collection.name,
                    objectType: collection.type || null,
                  },
                );
              }}
            >
              <Code2 className="mr-2 h-3.5 w-3.5" />
              Open in Query Console
            </ContextMenuItem>
            {isMongoCollection && (
              <ContextMenuItem
                className={menuItemClass}
                onClick={() =>
                  setExpandedTableKeys((current) =>
                    current.includes(collectionTreeKey)
                      ? current
                      : [...current, collectionTreeKey],
                  )
                }
              >
                <ListOrdered className="mr-2 h-3.5 w-3.5" />
                Browse Indexes
              </ContextMenuItem>
            )}
            <ContextMenuSeparator className={menuSeparatorClass} />
            <ContextMenuItem
              className={menuItemClass}
              onClick={() => void copyText(collection.name)}
            >
              <Clipboard className="mr-2 h-3.5 w-3.5" />
              Copy Name
            </ContextMenuItem>
            <ContextMenuItem
              className={menuItemClass}
              onClick={() =>
                void runForSchema(schema, () =>
                  handleCopyCollectionPreview(collection),
                )
              }
            >
              Copy Preview Query
            </ContextMenuItem>
            <ContextMenuSub>
              <ContextMenuSubTrigger className={menuSubClass}>
                <EyeOff className="mr-2 h-3.5 w-3.5" />
                Filter
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className={menuContentClass}>
                <ContextMenuItem
                  className={menuItemClass}
                  onClick={() =>
                    hideExplorerNodes(
                      explorerStateScope,
                      objectVisibilityParentId,
                      collectionNodeIdsForAction,
                    )
                  }
                >
                  <EyeOff className="mr-2 h-3.5 w-3.5" />
                  Hide selected object
                </ContextMenuItem>
                <ContextMenuItem
                  className={menuItemClass}
                  onClick={() =>
                    showOnlyExplorerNodes(
                      explorerStateScope,
                      objectVisibilityParentId,
                      collectionNodeIdsForAction,
                    )
                  }
                >
                  <Eye className="mr-2 h-3.5 w-3.5" />
                  Show only selected object
                </ContextMenuItem>
                <ContextMenuSeparator className={menuSeparatorClass} />
                <ContextMenuItem
                  className={menuItemClass}
                  disabled={!objectVisibilityFilter}
                  onClick={() =>
                    clearExplorerVisibilityFilter(
                      explorerStateScope,
                      objectVisibilityParentId,
                    )
                  }
                >
                  <X className="mr-2 h-3.5 w-3.5" />
                  Clear object filter
                </ContextMenuItem>
                <ContextMenuItem
                  className={menuItemClass}
                  onClick={() =>
                    openExplorerVisibilityFilter(
                      objectVisibilityParentId,
                      `Objects in ${schema || "current namespace"}`,
                    )
                  }
                >
                  <SearchCode className="mr-2 h-3.5 w-3.5" />
                  Configure filter…
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
            {isElasticsearchIndex && (
              <>
                <ContextMenuSeparator className={menuSeparatorClass} />
                <ContextMenuSub>
                  <ContextMenuSubTrigger className={menuSubClass}>
                    <Code2 className="mr-2 h-3.5 w-3.5" />
                    Index Metadata
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent className={menuContentClass}>
                    {(
                      [
                        ["mapping", "View Mapping"],
                        ["settings", "View Settings"],
                        ["stats", "View Statistics"],
                      ] as const
                    ).map(([kind, metadataLabel]) => (
                      <ContextMenuItem
                        key={kind}
                        className={menuItemClass}
                        onClick={() =>
                          setElasticsearchMetadataTarget({
                            connectionId,
                            driver: collectionDriver,
                            index: collection.name,
                            kind,
                          })
                        }
                      >
                        {metadataLabel}
                      </ContextMenuItem>
                    ))}
                  </ContextMenuSubContent>
                </ContextMenuSub>
              </>
            )}
            {nacosLocation && (
              <ContextMenuItem
                className={menuItemClass}
                onClick={() =>
                  setNacosConfigTransferRequest({
                    sourceConnectionId: connectionId,
                    sourceConnectionName:
                      connections.find(
                        (candidate) => candidate.id === connectionId,
                      )?.name || "Nacos connection",
                    source: nacosLocation,
                  })
                }
              >
                <ArrowRightLeft className="mr-2 h-3.5 w-3.5" />
                Transfer Configuration…
              </ContextMenuItem>
            )}
            {isMongoCollection && (
              <ContextMenuItem
                className={menuItemClass}
                onClick={() =>
                  setMongoCollectionTransferRequest({
                    sourceConnectionId: connectionId,
                    sourceConnectionName:
                      connections.find(
                        (candidate) => candidate.id === connectionId,
                      )?.name || "MongoDB connection",
                    sourceDatabase: navigationDatabaseName || schema,
                    sourceCollection: collection.name,
                  })
                }
              >
                <ArrowRightLeft className="mr-2 h-3.5 w-3.5" />
                Transfer Collection…
              </ContextMenuItem>
            )}
            {(isElasticsearchIndex || canDeleteCollection) && (
              <ContextMenuSeparator className={menuSeparatorClass} />
            )}
            {isElasticsearchIndex && (
              <ContextMenuItem
                onClick={() =>
                  setElasticsearchClearTarget({
                    connectionId,
                    driver: collectionDriver,
                    schema,
                    index: collection.name,
                  })
                }
                className={cn(menuItemClass, "text-destructive")}
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                Clear Documents…
              </ContextMenuItem>
            )}
            {canDeleteCollection && (
              <ContextMenuItem
                onClick={() =>
                  void runForSchema(schema, () =>
                    handleDeleteCollectionClick(collection),
                  )
                }
                className={cn(menuItemClass, "text-destructive")}
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                Delete {collectionLabel}…
              </ContextMenuItem>
            )}
          </ContextMenuContent>
        </ExplorerSharedContextMenu>
        {canExpandCollectionMetadata && isCollectionExpanded && (
          <TableObjectTree
            identity={{
              projectId: activeProjectId,
              connectionId,
              driver: driver || activeDriver,
              databaseName: navigationDatabaseName || undefined,
              schema,
              table: collection.name,
            }}
            includeIndexes={activeCapabilities.supportsTableIndexes}
            includeConstraints={false}
          />
        )}
      </div>
    );
  };

  return { renderCollectionItem };
}
