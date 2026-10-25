import { showMessage } from "@/lib/appDialogs";
import type { useDatabaseExplorerStore } from "@/store/useDatabaseExplorerStore";
import type { useConnectionStore } from "@/store/useConnectionStore";
import type { useTabStore } from "@/store/useTabStore";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { explorerDirectoryDefinition } from "@/features/database-explorer/model/explorerDirectory";
import { explorerObjectIconClass } from "@/features/database-explorer/model/explorerObjectPresentation";
import { objectGroupKey } from "@/features/database-explorer/model/explorerSidebarPresentation";
import { explorerNodeId } from "@/features/database-explorer/model/explorerTreeNode";
import {
  routineCallTemplate,
  routineKind,
  routineKindLabel,
  routineSignature,
} from "@/features/database-explorer/model/routinePresentation";
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
import { ExplorerVirtualList } from "@/features/database-explorer/ui/ExplorerVirtualList";
import { cn } from "@/lib/utils";
import { loadPostgresRoutineDefinitions } from "@/services/routineSourceCache";
import { schemaService } from "@/services/tauri";
import type { FunctionInfo } from "@/services/tauri/types";
import {
  Braces,
  Clipboard,
  Code2,
  Eye,
  EyeOff,
  ScrollText,
  SearchCode,
  X,
} from "lucide-react";

type DatabaseExplorerState = ReturnType<
  typeof useDatabaseExplorerStore.getState
>;

type ConnectionState = ReturnType<typeof useConnectionStore.getState>;

type TabState = ReturnType<typeof useTabStore.getState>;

interface CreateRoutineTreeRendererContext {
  activeCapabilities: import("@/services/tauri/types").DatabaseCapabilities;
  connectionId: string;
  navigationDatabaseName: string | undefined;
  schema: string;
  selectedExplorerNodeIds: string[];
  createTab: TabState["createTab"];
  objectConnection:
    | import("@/store/useConnectionStore").ConnectionConfig
    | undefined;
  setActiveTable: React.Dispatch<React.SetStateAction<string>>;
  setDdlContent: React.Dispatch<React.SetStateAction<string>>;
  setDdlViewerOpen: React.Dispatch<React.SetStateAction<boolean>>;

  copyText: (value: string) => Promise<void>;
  activeConnectionId: ConnectionState["activeConnectionId"];
  activeDriver: import("@/services/tauri/types").DatabaseDriver;
  activeProjectId: string;
  activeConnection:
    | import("@/store/useConnectionStore").ConnectionConfig
    | undefined;

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
  driver: string | null | undefined;
  expandedObjectGroupKeys: string[];
  isFunctionsLoading: boolean;
  toggleObjectGroup: (key: string) => void;
  loadFunctions: (
    connectionId: string,
    schema: string,
    force?: boolean | undefined,
  ) => Promise<void>;
  isCurrentSchema: boolean;
  explorerTreeRowHeight: 22 | 28;
  schemaObjects: {
    tables: import("@/services/tauri/types").TableInfo[];
    collections: import("@/services/tauri/types").CollectionInfo[];
    functions: import("@/services/tauri/types").FunctionInfo[];
    pinnedTables: string[];
    hasSnapshot: boolean;
  };
}

export function createRoutineTreeRenderer({
  activeCapabilities,
  connectionId,
  navigationDatabaseName,
  schema,
  selectedExplorerNodeIds,
  createTab,
  objectConnection,
  setActiveTable,
  setDdlContent,
  setDdlViewerOpen,

  copyText,
  activeConnectionId,
  activeDriver,
  activeProjectId,
  activeConnection,

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
  driver,
  expandedObjectGroupKeys,
  isFunctionsLoading,
  toggleObjectGroup,
  loadFunctions,
  isCurrentSchema,
  explorerTreeRowHeight,
  schemaObjects,
}: CreateRoutineTreeRendererContext) {
  const renderRoutines = () => {
    if (!activeCapabilities.supportsFunctions) return null;
    const renderRoutineRow = (routine: FunctionInfo, index: number) => {
      const signature = routineSignature(routine);
      const returnType = routine.return_type || "unknown";
      const kind = routineKind(routine);
      const routineExplorerNodeId = explorerNodeId(
        kind,
        connectionId,
        navigationDatabaseName,
        schema,
        routine.name,
        signature,
      );
      const isRoutineSelected = selectedExplorerNodeIds.includes(
        routineExplorerNodeId,
      );
      const qualifiedName = schema ? `${schema}.${routine.name}` : routine.name;
      const callTemplate = routineCallTemplate(schema, routine);
      const openRoutineConsole = () => {
        const tabId = createTab(
          "query",
          `${routine.name} [${objectConnection?.name || "query"}]`,
          callTemplate,
          {
            connectionId,
            databaseName: navigationDatabaseName,
            schemaName: schema,
          },
        );
        return tabId;
      };
      const viewRoutineSource = () => {
        void schemaService
          .getSchemaObjectSource(connectionId, schema, routine.name, kind)
          .then((definitions) => {
            const definition = definitions.find(
              (value) => value.trim().length > 0,
            );
            if (!definition) {
              throw new Error(
                "This driver does not provide a source definition for this routine.",
              );
            }
            setActiveTable(routine.name);
            setDdlContent(definition);
            setDdlViewerOpen(true);
          })
          .catch((error) =>
            showMessage(
              `Unable to load ${kind} definition: ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
      };

      return (
        <ExplorerContextMenuRow
          key={`${routine.name}:${signature}:${index}`}
          nodeId={routineExplorerNodeId}
          menu={
            <>
              <ContextMenuItem
                className={menuItemClass}
                onClick={openRoutineConsole}
              >
                <Code2 className="mr-2 h-3.5 w-3.5" />
                Open Call in Query Console
              </ContextMenuItem>
              <ContextMenuItem
                className={menuItemClass}
                onClick={viewRoutineSource}
              >
                <Eye className="mr-2 h-3.5 w-3.5" />
                View Source
              </ContextMenuItem>
              <ContextMenuSeparator className={menuSeparatorClass} />
              <ContextMenuItem
                className={menuItemClass}
                onClick={() => void copyText(routine.name)}
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
              <ContextMenuItem
                className={menuItemClass}
                onClick={() => void copyText(callTemplate)}
              >
                Copy Call Template
              </ContextMenuItem>
              {activeConnectionId &&
                ["postgres", "postgresql", "pgsql"].includes(
                  activeDriver.toLowerCase(),
                ) && (
                  <ContextMenuItem
                    className={menuItemClass}
                    onClick={() =>
                      void loadPostgresRoutineDefinitions({
                        projectId: activeProjectId || "local",
                        connectionId: activeConnectionId,
                        driver: activeDriver,
                        driverPackageVersion:
                          activeConnection?.driverPackageVersion,
                        connectionDatabaseName: activeConnection?.database,
                        schema,
                        routine: routine.name,
                      })
                        .then((definitions) =>
                          copyText(definitions.join("\n\n")),
                        )
                        .catch((error) =>
                          showMessage(
                            `Failed to load routine definition: ${error instanceof Error ? error.message : String(error)}`,
                          ),
                        )
                    }
                  >
                    Copy Source Definition
                  </ContextMenuItem>
                )}
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
                        [routineExplorerNodeId],
                      )
                    }
                  >
                    <EyeOff className="mr-2 h-3.5 w-3.5" />
                    Hide this routine
                  </ContextMenuItem>
                  <ContextMenuItem
                    className={menuItemClass}
                    onClick={() =>
                      showOnlyExplorerNodes(
                        explorerStateScope,
                        objectVisibilityParentId,
                        [routineExplorerNodeId],
                      )
                    }
                  >
                    <Eye className="mr-2 h-3.5 w-3.5" />
                    Show only this routine
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
            </>
          }
        >
          <div
            role="treeitem"
            data-explorer-node-id={routineExplorerNodeId}
            aria-selected={isRoutineSelected}
            tabIndex={isRoutineSelected ? 0 : -1}
            className={cn(
              "group ml-4 flex h-7 items-center gap-2 rounded-[3px] px-2 text-[11px] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]",
              isRoutineSelected && "wb-tree-row-selected",
            )}
            onClick={(event) =>
              selectExplorerNode(routineExplorerNodeId, event)
            }
            onContextMenu={() => selectExplorerNode(routineExplorerNodeId)}
            onDoubleClick={openRoutineConsole}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                moveExplorerTreeFocus(
                  event.currentTarget,
                  event.key === "ArrowDown" ? 1 : -1,
                );
              } else if (event.key === "Enter") {
                event.preventDefault();
                openRoutineConsole();
              }
            }}
            title={
              showExplorerHoverTooltips
                ? `${signature} -> ${returnType}`
                : undefined
            }
          >
            {kind === "procedure" ? (
              <ScrollText
                size={12}
                className={cn("shrink-0", explorerObjectIconClass("procedure"))}
              />
            ) : (
              <Braces
                size={12}
                className={cn("shrink-0", explorerObjectIconClass("function"))}
              />
            )}
            <span className="min-w-0 flex-1 truncate">
              {highlightMatch(routine.name, filterText)}
            </span>
            <span className="shrink-0 text-[9px] uppercase opacity-50">
              {routineKindLabel(routine)}
            </span>
          </div>
        </ExplorerContextMenuRow>
      );
    };

    const renderRoutineGroup = (
      kind: "procedures" | "functions",
      routines: FunctionInfo[],
    ) => {
      const definition = explorerDirectoryDefinition(kind);
      const key = objectGroupKey(connectionId, driver, schema, kind);
      const isExpanded = expandedObjectGroupKeys.includes(key);
      return (
        <div>
          <ExplorerDirectoryGroupRow
            expanded={isExpanded}
            label={definition.label}
            count={isFunctionsLoading ? undefined : routines.length}
            icon={
              kind === "procedures" ? (
                <ScrollText
                  size={12}
                  className={cn(
                    "shrink-0",
                    explorerObjectIconClass("procedure"),
                  )}
                />
              ) : (
                <Braces
                  size={12}
                  className={cn(
                    "shrink-0",
                    explorerObjectIconClass("function"),
                  )}
                />
              )
            }
            onToggle={() => toggleObjectGroup(key)}
            onRefresh={() => void loadFunctions(connectionId, schema, true)}
          />
          {isExpanded &&
            (isCurrentSchema && isFunctionsLoading && routines.length === 0 ? (
              <div className="pl-7 text-[11px] italic wb-muted">
                Loading {definition.label.toLowerCase()}...
              </div>
            ) : routines.length === 0 ? (
              <div className="pl-7 text-[11px] italic wb-muted">
                {filterText
                  ? `No ${definition.label.toLowerCase()} match "${filterText}"`
                  : `No ${definition.label.toLowerCase()} found`}
              </div>
            ) : (
              <ExplorerContextMenuHost>
                <ExplorerVirtualList
                  items={routines}
                  rowHeight={explorerTreeRowHeight}
                  getKey={(routine, index) =>
                    `${routine.name}:${routineSignature(routine)}:${index}`
                  }
                  renderItem={renderRoutineRow}
                />
              </ExplorerContextMenuHost>
            ))}
        </div>
      );
    };

    const procedures = schemaObjects.functions.filter(
      (routine) => routineKind(routine) === "procedure",
    );
    const functions = schemaObjects.functions.filter(
      (routine) => routineKind(routine) === "function",
    );

    return (
      <>
        {renderRoutineGroup("procedures", procedures)}
        {renderRoutineGroup("functions", functions)}
      </>
    );
  };

  return { renderRoutines };
}
