import type { useDatabaseExplorerStore } from "@/store/useDatabaseExplorerStore";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
  EXPLORER_DIRECTORY_GROUPS,
  explorerDirectoryDefinition,
  explorerDirectoryNodeKind,
  groupSchemaObjectDescriptors,
  type ExplorerDirectoryGroupKind,
} from "@/features/database-explorer/model/explorerDirectory";
import { explorerObjectIconClass } from "@/features/database-explorer/model/explorerObjectPresentation";
import { objectGroupKey } from "@/features/database-explorer/model/explorerSidebarPresentation";
import { explorerNodeId } from "@/features/database-explorer/model/explorerTreeNode";
import {
  ExplorerContextMenuHost,
  ExplorerContextMenuRow,
} from "@/features/database-explorer/ui/ExplorerContextMenuHost";
import { ExplorerDirectoryRow as ExplorerDirectoryGroupRow } from "@/features/database-explorer/ui/ExplorerDirectoryRow";
import {
  EXPLORER_MENU_CONTENT_CLASS as menuContentClass,
  EXPLORER_MENU_ITEM_CLASS as menuItemClass,
  EXPLORER_MENU_SEPARATOR_CLASS as menuSeparatorClass,
  EXPLORER_SIDEBAR_MENU_SUB_CLASS as menuSubClass,
} from "@/features/database-explorer/ui/explorerStyles";
import { moveExplorerTreeFocus } from "@/features/database-explorer/ui/explorerTreeDom";
import { ExplorerSegmentedVirtualList } from "@/features/database-explorer/ui/ExplorerVirtualList";
import { cn } from "@/lib/utils";
import { schemaService } from "@/services/tauri";
import type { SchemaObjectInfo } from "@/services/tauri/types";
import {
  Braces,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Clock3,
  Eye,
  EyeOff,
  Folder,
  Link2,
  ListOrdered,
  Package,
  RefreshCw,
  SearchCode,
  X,
  Zap,
} from "lucide-react";

type DatabaseExplorerState = ReturnType<
  typeof useDatabaseExplorerStore.getState
>;

interface CreateSchemaDescriptorRendererContext {
  isCurrentSchema: boolean;
  activeCapabilities: import("@/services/tauri/types").DatabaseCapabilities;
  descriptorObjects: import("@/services/tauri/types").SchemaObjectInfo[];
  setIsSchemaObjectDescriptorsLoading: React.Dispatch<
    React.SetStateAction<boolean>
  >;
  connectionId: string;
  schema: string;
  setSchemaObjectDescriptors: React.Dispatch<
    React.SetStateAction<import("@/services/tauri/types").SchemaObjectInfo[]>
  >;
  setSchemaObjectDescriptorScope: React.Dispatch<
    React.SetStateAction<string | null>
  >;
  setNamespaceError: React.Dispatch<React.SetStateAction<string | null>>;
  driver: string | null | undefined;
  expandedObjectGroupKeys: string[];
  toggleObjectGroup: (key: string) => void;
  explorerTreeRowHeight: 22 | 28;
  expandedSchemaObjectMemberKeys: string[];
  navigationDatabaseName: string | undefined;
  selectedExplorerNodeIds: string[];
  schemaObjectMemberStates: Record<
    string,
    {
      loading: boolean;
      error: boolean;
      members: import("@/services/tauri/types").SchemaObjectInfo[];
    }
  >;
  setExpandedSchemaObjectMemberKeys: React.Dispatch<
    React.SetStateAction<string[]>
  >;
  setSchemaObjectMemberStates: React.Dispatch<
    React.SetStateAction<
      Record<
        string,
        {
          loading: boolean;
          error: boolean;
          members: import("@/services/tauri/types").SchemaObjectInfo[];
        }
      >
    >
  >;

  viewSchemaObjectSource: (
    object: import("@/services/tauri/types").SchemaObjectInfo,
  ) => void;

  copyText: (value: string) => Promise<void>;

  hideExplorerNodes: DatabaseExplorerState["hideNodes"];
  explorerStateScope: string;
  objectVisibilityParentId: string;
  showOnlyExplorerNodes: DatabaseExplorerState["showOnlyNodes"];
  objectVisibilityFilter:
    | import("@/features/database-explorer/model/explorerVisibilityFilter").ExplorerVisibilityFilter
    | undefined;
  clearExplorerVisibilityFilter: DatabaseExplorerState["clearVisibilityFilter"];
  openExplorerVisibilityFilter: (parentNodeId: string, label: string) => void;
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
  showExplorerHoverTooltips: boolean;
  highlightMatch: (text: string, filter: string) => import("react").JSX.Element;
  filterText: string;
  isSchemaObjectDescriptorsLoading: boolean;
}

export function createSchemaDescriptorRenderer({
  isCurrentSchema,
  activeCapabilities,
  descriptorObjects,
  setIsSchemaObjectDescriptorsLoading,
  connectionId,
  schema,
  setSchemaObjectDescriptors,
  setSchemaObjectDescriptorScope,
  setNamespaceError,
  driver,
  expandedObjectGroupKeys,
  toggleObjectGroup,
  explorerTreeRowHeight,
  expandedSchemaObjectMemberKeys,
  navigationDatabaseName,
  selectedExplorerNodeIds,
  schemaObjectMemberStates,
  setExpandedSchemaObjectMemberKeys,
  setSchemaObjectMemberStates,

  viewSchemaObjectSource,

  copyText,

  hideExplorerNodes,
  explorerStateScope,
  objectVisibilityParentId,
  showOnlyExplorerNodes,
  objectVisibilityFilter,
  clearExplorerVisibilityFilter,
  openExplorerVisibilityFilter,
  selectExplorerNode,
  showExplorerHoverTooltips,
  highlightMatch,
  filterText,
  isSchemaObjectDescriptorsLoading,
}: CreateSchemaDescriptorRendererContext) {
  const renderSchemaObjectDescriptors = () => {
    if (!isCurrentSchema || activeCapabilities.dataModel !== "relational") {
      return null;
    }
    const descriptorGroups = groupSchemaObjectDescriptors(descriptorObjects);
    const descriptorGroupDefinitions = EXPLORER_DIRECTORY_GROUPS.filter(
      (definition) =>
        [
          "triggers",
          "events",
          "sequences",
          "synonyms",
          "jobs",
          "packages",
          "types",
        ].includes(definition.kind) &&
        (descriptorGroups.get(definition.kind)?.length || 0) > 0,
    );
    const directoryIcon = (kind: ExplorerDirectoryGroupKind) => {
      const definition = explorerDirectoryDefinition(kind);
      const className = cn(
        "shrink-0",
        explorerObjectIconClass(definition.iconKind),
      );
      if (kind === "triggers") return <Zap size={12} className={className} />;
      if (kind === "events" || kind === "jobs") {
        return <Clock3 size={12} className={className} />;
      }
      if (kind === "sequences") {
        return <ListOrdered size={12} className={className} />;
      }
      if (kind === "synonyms") {
        return <Link2 size={12} className={className} />;
      }
      if (kind === "packages") {
        return <Package size={12} className={className} />;
      }
      return <Braces size={12} className={className} />;
    };
    const refreshDescriptorObjects = () => {
      setIsSchemaObjectDescriptorsLoading(true);
      void schemaService
        .getSchemaObjects(connectionId, schema)
        .then((objects) => {
          setSchemaObjectDescriptors(objects);
          setSchemaObjectDescriptorScope(`${connectionId}:${schema}`);
        })
        .catch((error) =>
          setNamespaceError(
            `Unable to refresh schema objects: ${error instanceof Error ? error.message : String(error)}`,
          ),
        )
        .finally(() => setIsSchemaObjectDescriptorsLoading(false));
    };

    const renderDescriptorGroup = (
      kind: ExplorerDirectoryGroupKind,
      objects: SchemaObjectInfo[],
    ) => {
      const definition = explorerDirectoryDefinition(kind);
      const key = objectGroupKey(connectionId, driver, schema, kind);
      const isExpanded = expandedObjectGroupKeys.includes(key);
      return (
        <div key={kind}>
          <ExplorerDirectoryGroupRow
            expanded={isExpanded}
            label={definition.label}
            count={objects.length}
            icon={directoryIcon(kind)}
            onToggle={() => toggleObjectGroup(key)}
            onRefresh={refreshDescriptorObjects}
          />
          {isExpanded && (
            <ExplorerContextMenuHost>
              <ExplorerSegmentedVirtualList
                items={objects}
                rowHeight={explorerTreeRowHeight}
                getKey={(object) =>
                  `${object.objectType}:${object.name}:${object.parentName || ""}`
                }
                isExpanded={(object) =>
                  expandedSchemaObjectMemberKeys.includes(
                    [
                      connectionId,
                      navigationDatabaseName || "",
                      schema,
                      object.objectType,
                      object.name,
                    ].join("\u0000"),
                  )
                }
                renderItem={(object) => {
                  const objectType = object.objectType.toLowerCase();
                  const descriptorExplorerNodeId = explorerNodeId(
                    explorerDirectoryNodeKind(kind),
                    connectionId,
                    navigationDatabaseName,
                    schema,
                    object.name,
                    object.objectType,
                    object.parentName,
                  );
                  const isDescriptorSelected = selectedExplorerNodeIds.includes(
                    descriptorExplorerNodeId,
                  );
                  const parentSuffix = object.parentName
                    ? ` on ${object.parentName}`
                    : "";
                  const qualifiedName = schema
                    ? `${schema}.${object.name}`
                    : object.name;
                  const memberKey = [
                    connectionId,
                    navigationDatabaseName || "",
                    schema,
                    object.objectType,
                    object.name,
                  ].join("\u0000");
                  const membersState = schemaObjectMemberStates[memberKey];
                  const membersExpanded =
                    expandedSchemaObjectMemberKeys.includes(memberKey);
                  const toggleMembers = () => {
                    if (!object.membersExpandable) return;
                    // Retry keeps a failed node expanded so the operation does
                    // not look like a collapse. A successful cached response
                    // toggles without another round trip.
                    if (membersExpanded && !membersState?.error) {
                      setExpandedSchemaObjectMemberKeys((current) =>
                        current.filter((key) => key !== memberKey),
                      );
                      return;
                    }
                    if (!membersExpanded) {
                      setExpandedSchemaObjectMemberKeys((current) => [
                        ...current,
                        memberKey,
                      ]);
                    }
                    if (membersState && !membersState.error) return;
                    setSchemaObjectMemberStates((current) => ({
                      ...current,
                      [memberKey]: { loading: true, error: false, members: [] },
                    }));
                    void schemaService
                      .getSchemaObjectMembers(
                        connectionId,
                        schema,
                        object.name,
                        object.objectType,
                      )
                      .then((members) => {
                        setSchemaObjectMemberStates((current) => ({
                          ...current,
                          [memberKey]: {
                            loading: false,
                            error: false,
                            members,
                          },
                        }));
                      })
                      .catch(() => {
                        setSchemaObjectMemberStates((current) => ({
                          ...current,
                          [memberKey]: {
                            loading: false,
                            error: true,
                            members: [],
                          },
                        }));
                      });
                  };
                  return (
                    <div
                      key={`${objectType}:${object.name}:${object.parentName || ""}`}
                    >
                      <ExplorerContextMenuRow
                        nodeId={descriptorExplorerNodeId}
                        menu={
                          <>
                            <ContextMenuItem
                              className={menuItemClass}
                              onClick={() => viewSchemaObjectSource(object)}
                            >
                              <Eye className="mr-2 h-3.5 w-3.5" />
                              View Source
                            </ContextMenuItem>
                            <ContextMenuSeparator
                              className={menuSeparatorClass}
                            />
                            <ContextMenuItem
                              className={menuItemClass}
                              onClick={() => void copyText(object.name)}
                            >
                              <Clipboard className="mr-2 h-3.5 w-3.5" />
                              Copy Name
                            </ContextMenuItem>
                            <ContextMenuItem
                              className={menuItemClass}
                              onClick={() => void copyText(qualifiedName)}
                            >
                              Copy Qualified Name
                            </ContextMenuItem>
                            <ContextMenuSub>
                              <ContextMenuSubTrigger className={menuSubClass}>
                                <EyeOff className="mr-2 h-3.5 w-3.5" />
                                Filter
                              </ContextMenuSubTrigger>
                              <ContextMenuSubContent
                                className={menuContentClass}
                              >
                                <ContextMenuItem
                                  className={menuItemClass}
                                  onClick={() =>
                                    hideExplorerNodes(
                                      explorerStateScope,
                                      objectVisibilityParentId,
                                      [descriptorExplorerNodeId],
                                    )
                                  }
                                >
                                  <EyeOff className="mr-2 h-3.5 w-3.5" />
                                  Hide this object
                                </ContextMenuItem>
                                <ContextMenuItem
                                  className={menuItemClass}
                                  onClick={() =>
                                    showOnlyExplorerNodes(
                                      explorerStateScope,
                                      objectVisibilityParentId,
                                      [descriptorExplorerNodeId],
                                    )
                                  }
                                >
                                  <Eye className="mr-2 h-3.5 w-3.5" />
                                  Show only this object
                                </ContextMenuItem>
                                <ContextMenuSeparator
                                  className={menuSeparatorClass}
                                />
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
                          </>
                        }
                      >
                        <div
                          role="treeitem"
                          data-explorer-node-id={descriptorExplorerNodeId}
                          aria-selected={isDescriptorSelected}
                          aria-expanded={
                            object.membersExpandable
                              ? membersExpanded
                              : undefined
                          }
                          tabIndex={isDescriptorSelected ? 0 : -1}
                          className={cn(
                            "group ml-4 flex h-7 items-center gap-2 rounded-[3px] px-2 text-[11px] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]",
                            isDescriptorSelected && "wb-tree-row-selected",
                          )}
                          onClick={(event) =>
                            selectExplorerNode(descriptorExplorerNodeId, event)
                          }
                          onContextMenu={() =>
                            selectExplorerNode(descriptorExplorerNodeId)
                          }
                          onDoubleClick={() => viewSchemaObjectSource(object)}
                          onKeyDown={(event) => {
                            if (
                              event.key === "ArrowDown" ||
                              event.key === "ArrowUp"
                            ) {
                              event.preventDefault();
                              moveExplorerTreeFocus(
                                event.currentTarget,
                                event.key === "ArrowDown" ? 1 : -1,
                              );
                            } else if (event.key === "Enter") {
                              event.preventDefault();
                              viewSchemaObjectSource(object);
                            }
                          }}
                          title={
                            showExplorerHoverTooltips
                              ? `${object.objectType}${parentSuffix}${object.comment ? `\n${object.comment}` : ""}`
                              : undefined
                          }
                        >
                          {object.membersExpandable ? (
                            <button
                              type="button"
                              className="-ml-1 -mr-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] wb-muted hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]"
                              aria-label={`${membersExpanded ? "Collapse" : "Expand"} ${object.name} members`}
                              aria-expanded={membersExpanded}
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleMembers();
                              }}
                              onDoubleClick={(event) => event.stopPropagation()}
                            >
                              {membersExpanded ? (
                                <ChevronDown size={10} />
                              ) : (
                                <ChevronRight size={10} />
                              )}
                            </button>
                          ) : null}
                          {directoryIcon(kind)}
                          <span className="min-w-0 flex-1 truncate">
                            {highlightMatch(object.name, filterText)}
                          </span>
                          {object.comment?.trim() && (
                            <span className="max-w-[30%] shrink truncate text-[9px] opacity-60">
                              {object.comment.trim()}
                            </span>
                          )}
                          <span className="shrink-0 text-[9px] uppercase opacity-50">
                            {object.objectType}
                            {parentSuffix}
                          </span>
                        </div>
                      </ExplorerContextMenuRow>
                      {object.membersExpandable && membersExpanded && (
                        <div className="ml-10 border-l border-[hsl(var(--wb-border-subtle))] pl-2">
                          {membersState?.loading ? (
                            <div className="py-1 text-[10px] italic wb-muted">
                              Loading members...
                            </div>
                          ) : membersState?.error ? (
                            <button
                              type="button"
                              className="wb-text-button h-5 px-1 text-[10px] text-[hsl(var(--wb-danger))]"
                              onClick={toggleMembers}
                            >
                              Unable to load members; retry
                            </button>
                          ) : membersState?.members.length ? (
                            membersState.members.map((member) => (
                              <div
                                key={`${member.objectType}:${member.name}`}
                                className="flex min-w-0 items-center gap-1 py-0.5 text-[10px] text-[hsl(var(--wb-text-muted))]"
                                title={member.comment || member.objectType}
                              >
                                <Folder
                                  size={10}
                                  className="shrink-0 text-violet-400/70"
                                />
                                <span className="truncate">{member.name}</span>
                                <span className="ml-auto shrink-0 uppercase opacity-50">
                                  {member.objectType}
                                </span>
                              </div>
                            ))
                          ) : (
                            <div className="py-1 text-[10px] italic wb-muted">
                              No members found
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                }}
              />
            </ExplorerContextMenuHost>
          )}
        </div>
      );
    };

    if (
      isSchemaObjectDescriptorsLoading &&
      descriptorGroupDefinitions.length === 0
    ) {
      return (
        <div className="flex h-6 items-center gap-1.5 pl-6 text-[11px] italic wb-muted">
          <RefreshCw size={11} className="animate-spin" />
          Loading database object directories...
        </div>
      );
    }

    return (
      <>
        {descriptorGroupDefinitions.map((definition) =>
          renderDescriptorGroup(
            definition.kind,
            descriptorGroups.get(definition.kind) || [],
          ),
        )}
      </>
    );
  };

  return { renderSchemaObjectDescriptors };
}
