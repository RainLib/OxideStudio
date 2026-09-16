import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  explorerDirectoryNodeKind,
  type ExplorerDirectoryGroupKind,
} from "@/features/database-explorer/model/explorerDirectory";
import { explorerNodeId } from "@/features/database-explorer/model/explorerTreeNode";
import type { ObjectMemberLoadState } from "@/features/database-explorer/model/remoteCatalogTypes";
import { moveExplorerTreeFocus } from "@/features/database-explorer/runtime/explorerTreeDom";
import { copyText } from "@/features/database-explorer/runtime/remoteCatalogClipboard";
import { ExplorerSharedContextMenu } from "@/features/database-explorer/ui/ExplorerContextMenuHost";
import {
  directoryIcon,
  menuContentClass,
  menuItemClass,
} from "@/features/database-explorer/ui/remoteCatalogPresentation";
import { cn } from "@/lib/utils";
import type { SchemaObjectInfo } from "@/services/tauri/types/schemaCatalog";
import {
  ChevronDown,
  ChevronRight,
  Clipboard,
  SquareFunction,
} from "lucide-react";

interface CreateRemoteObjectRendererContext {
  schema: string;
  expandedObjectKeys: Set<string>;
  objectMemberLoads: Record<string, ObjectMemberLoadState>;
  connectionId: string;
  database: string;
  selectedNodeIds: string[];
  selectNode: (
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
  toggleObjectMembers: (schema: string, object: SchemaObjectInfo) => void;
}

export function createRemoteObjectRenderer({
  schema,
  expandedObjectKeys,
  objectMemberLoads,
  connectionId,
  database,
  selectedNodeIds,
  selectNode,
  toggleObjectMembers,
}: CreateRemoteObjectRendererContext) {
  const renderRemoteObject = (
    kind: ExplorerDirectoryGroupKind,
    object: SchemaObjectInfo,
  ) => {
    const memberKey = `${schema}:${object.objectType}:${object.name}`;
    const membersExpanded = expandedObjectKeys.has(memberKey);
    const memberLoad = objectMemberLoads[memberKey];
    const objectNodeId = explorerNodeId(
      explorerDirectoryNodeKind(kind),
      connectionId,
      database,
      schema,
      object.name,
      object.objectType,
      object.parentName,
    );
    const isObjectSelected = selectedNodeIds.includes(objectNodeId);
    return (
      <div
        key={`${object.objectType}:${object.name}:${object.parentName || ""}`}
      >
        <ExplorerSharedContextMenu nodeId={objectNodeId}>
          <ContextMenuTrigger asChild>
            <div
              role="treeitem"
              data-explorer-node-id={objectNodeId}
              aria-selected={isObjectSelected}
              aria-expanded={
                object.membersExpandable ? membersExpanded : undefined
              }
              tabIndex={isObjectSelected ? 0 : -1}
              className={cn(
                "ml-4 flex h-7 min-w-0 items-center gap-1.5 rounded-[3px] px-2 text-[11px] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]",
                isObjectSelected && "wb-tree-row-selected",
              )}
              onClick={(event) => selectNode(objectNodeId, event)}
              onContextMenu={() => selectNode(objectNodeId)}
              onDoubleClick={() =>
                object.membersExpandable && toggleObjectMembers(schema, object)
              }
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const nextId = moveExplorerTreeFocus(
                    event.currentTarget,
                    event.key === "ArrowDown" ? 1 : -1,
                  );
                  if (nextId) {
                    selectNode(nextId);
                  }
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  if (object.membersExpandable) {
                    toggleObjectMembers(schema, object);
                  }
                }
              }}
              title={[object.objectType, object.parentName, object.comment]
                .filter(Boolean)
                .join(" · ")}
            >
              {object.membersExpandable && (
                <button
                  type="button"
                  className="-ml-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-[2px] wb-muted hover:bg-[hsl(var(--wb-hover))]"
                  aria-label={`${membersExpanded ? "Collapse" : "Expand"} ${object.name} members`}
                  aria-expanded={membersExpanded}
                  onClick={() => toggleObjectMembers(schema, object)}
                >
                  {membersExpanded ? (
                    <ChevronDown size={10} />
                  ) : (
                    <ChevronRight size={10} />
                  )}
                </button>
              )}
              {directoryIcon(kind)}
              <span className="min-w-0 flex-1 truncate">{object.name}</span>
              {object.parentName && (
                <span className="max-w-[35%] truncate text-[9px] opacity-60">
                  {object.parentName}
                </span>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className={menuContentClass}>
            <ContextMenuItem
              className={menuItemClass}
              onClick={() => void copyText(object.name)}
            >
              <Clipboard className="mr-2 h-3.5 w-3.5" />
              Copy Name
            </ContextMenuItem>
            <ContextMenuItem
              className={menuItemClass}
              onClick={() =>
                void copyText(`${database}.${schema}.${object.name}`)
              }
            >
              Copy Qualified Name
            </ContextMenuItem>
          </ContextMenuContent>
        </ExplorerSharedContextMenu>
        {membersExpanded && (
          <div className="ml-7 border-l border-[hsl(var(--wb-border-subtle))] pl-2">
            {memberLoad?.status === "loading" ? (
              <div className="h-5 py-0.5 text-[10px] italic wb-muted">
                Loading members...
              </div>
            ) : memberLoad?.status === "error" ? (
              <button
                type="button"
                className="h-5 text-[10px] text-destructive"
                onClick={() => toggleObjectMembers(schema, object)}
              >
                Unable to load members; retry
              </button>
            ) : memberLoad?.members.length ? (
              memberLoad.members.map((member) => (
                <div
                  key={`${member.objectType}:${member.name}`}
                  className="flex h-5 min-w-0 items-center gap-1.5 text-[10px] wb-muted"
                >
                  <SquareFunction size={9} className="shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{member.name}</span>
                  <span className="shrink-0 uppercase opacity-55">
                    {member.objectType}
                  </span>
                </div>
              ))
            ) : (
              <div className="h-5 py-0.5 text-[10px] italic wb-muted">
                No members found
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return { renderRemoteObject };
}
