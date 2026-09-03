import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  ExplorerContextMenuHost,
  ExplorerSharedContextMenu,
} from "./ExplorerContextMenuHost";
import { cn } from "@/lib/utils";
import type { ExplorerConnectionGroup } from "@/store/useDatabaseExplorerStore";
import { explorerActionsForNode } from "../model/explorerActionRegistry";
import { explorerNodeId } from "../model/explorerTreeNode";
import { ExplorerActionMenuItems } from "./ExplorerActionMenuItems";
import { EXPLORER_MENU_CONTENT_CLASS } from "./explorerStyles";
import { moveExplorerTreeFocus } from "./explorerTreeDom";
import type { ExplorerGroupDropPlacement } from "../model/explorerGroupOrder";
import { useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

export const EXPLORER_CONNECTION_DRAG_TYPE =
  "application/x-oxide-database-explorer-connections";
export const EXPLORER_GROUP_DRAG_TYPE =
  "application/x-oxide-database-explorer-group";

export function readExplorerDraggedConnectionIds(dataTransfer: DataTransfer) {
  try {
    const parsed = JSON.parse(
      dataTransfer.getData(EXPLORER_CONNECTION_DRAG_TYPE),
    );
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

export function explorerConnectionGroupDepth(
  group: ExplorerConnectionGroup,
  groups: ReadonlyMap<string, ExplorerConnectionGroup>,
) {
  let depth = 0;
  let parentId = group.parentId;
  const visited = new Set([group.id]);
  while (parentId && !visited.has(parentId) && depth < 6) {
    visited.add(parentId);
    depth += 1;
    parentId = groups.get(parentId)?.parentId ?? null;
  }
  return depth;
}

export function explorerConnectionGroupAncestorsExpanded(
  group: ExplorerConnectionGroup,
  groups: ReadonlyMap<string, ExplorerConnectionGroup>,
  expandedGroupIds: readonly string[],
) {
  let parentId = group.parentId;
  const visited = new Set([group.id]);
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    if (!expandedGroupIds.includes(parentId)) return false;
    parentId = groups.get(parentId)?.parentId ?? null;
  }
  return true;
}

interface ExplorerConnectionGroupRowProps {
  group: ExplorerConnectionGroup;
  depth: number;
  count: number;
  expanded: boolean;
  selected: boolean;
  onToggle: () => void;
  onSelect: (event?: ReactMouseEvent<HTMLDivElement>) => void;
  onRename: () => void;
  onDelete: () => void;
  onNewSubgroup: () => void;
  onNewConnection: () => void;
  onDropConnections: (connectionIds: readonly string[]) => void;
  onDropGroup: (
    groupId: string,
    placement: ExplorerGroupDropPlacement,
  ) => void;
}

export function ExplorerConnectionGroupRow({
  group,
  depth,
  count,
  expanded,
  selected,
  onToggle,
  onSelect,
  onRename,
  onDelete,
  onNewSubgroup,
  onNewConnection,
  onDropConnections,
  onDropGroup,
}: ExplorerConnectionGroupRowProps) {
  const [dropPlacement, setDropPlacement] =
    useState<ExplorerGroupDropPlacement | null>(null);
  const actions = explorerActionsForNode(
    {
      id: explorerNodeId("folder", group.id),
      kind: "folder",
      label: group.name,
    },
    {},
  );
  return (
    <ExplorerContextMenuHost>
      <ExplorerSharedContextMenu
        nodeId={explorerNodeId("folder", group.id)}
      >
      <ContextMenuTrigger asChild>
        <div
          role="treeitem"
          data-explorer-node-id={explorerNodeId("folder", group.id)}
          aria-expanded={expanded}
          aria-selected={selected}
          tabIndex={selected ? 0 : -1}
          className={cn(
            "wb-tree-row w-full gap-1 px-1 text-[11px] hover:bg-[hsl(var(--wb-hover))]",
            selected && "wb-tree-row-selected",
            dropPlacement === "inside" &&
              "bg-[hsl(var(--wb-hover-strong))] ring-1 ring-inset ring-[hsl(var(--wb-accent))]/60",
            dropPlacement === "before" &&
              "border-t border-[hsl(var(--wb-accent))]",
            dropPlacement === "after" &&
              "border-b border-[hsl(var(--wb-accent))]",
          )}
          style={{ paddingLeft: `${Math.min(depth, 6) * 12 + 4}px` }}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData(EXPLORER_GROUP_DRAG_TYPE, group.id);
          }}
          onDragOver={(event) => {
            if (
              event.dataTransfer.types.includes(
                EXPLORER_CONNECTION_DRAG_TYPE,
              ) ||
              event.dataTransfer.types.includes(EXPLORER_GROUP_DRAG_TYPE)
            ) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              const bounds = event.currentTarget.getBoundingClientRect();
              const ratio =
                bounds.height > 0
                  ? (event.clientY - bounds.top) / bounds.height
                  : 0.5;
              setDropPlacement(
                ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "inside",
              );
            }
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setDropPlacement(null);
            }
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const connectionIds = readExplorerDraggedConnectionIds(
              event.dataTransfer,
            );
            if (connectionIds.length > 0) {
              onDropConnections(connectionIds);
              setDropPlacement(null);
              return;
            }
            const groupId = event.dataTransfer.getData(
              EXPLORER_GROUP_DRAG_TYPE,
            );
            if (groupId) onDropGroup(groupId, dropPlacement ?? "inside");
            setDropPlacement(null);
          }}
          onClick={(event) => onSelect(event)}
          onContextMenu={(event) => onSelect(event)}
          onDoubleClick={onToggle}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSelect();
            } else if (event.key === " ") {
              event.preventDefault();
              onToggle();
            } else if (event.key === "ArrowRight" && !expanded) {
              event.preventDefault();
              onToggle();
            } else if (event.key === "ArrowLeft" && expanded) {
              event.preventDefault();
              onToggle();
            } else if (
              event.key === "ArrowDown" ||
              event.key === "ArrowUp"
            ) {
              event.preventDefault();
              moveExplorerTreeFocus(
                event.currentTarget,
                event.key === "ArrowDown" ? 1 : -1,
              );
            }
          }}
        >
          <button
            type="button"
            tabIndex={-1}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${group.name}`}
            className="inline-flex h-5 w-4 shrink-0 items-center justify-center rounded-[3px] wb-muted hover:bg-[hsl(var(--wb-hover-strong))]"
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          {expanded ? (
            <FolderOpen size={12} className="shrink-0 text-amber-400/85" />
          ) : (
            <Folder size={12} className="shrink-0 text-amber-400/85" />
          )}
          <span className="min-w-0 flex-1 truncate font-medium">
            {group.name}
          </span>
          <span className="shrink-0 text-[9px] tabular-nums wb-muted">
            {count}
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className={EXPLORER_MENU_CONTENT_CLASS}>
        <ExplorerActionMenuItems
          items={actions}
          onAction={(action) => {
            if (action === "group.new-connection") onNewConnection();
            else if (action === "group.new-subgroup") onNewSubgroup();
            else if (action === "group.rename") onRename();
            else if (action === "group.delete") onDelete();
          }}
          renderIcon={(action) => {
            const className = "mr-2 h-3.5 w-3.5";
            if (action === "group.new-connection") {
              return <Plus className={className} />;
            }
            if (action === "group.new-subgroup") {
              return <FolderPlus className={className} />;
            }
            if (action === "group.rename") {
              return <Pencil className={className} />;
            }
            if (action === "group.delete") {
              return <Trash2 className={className} />;
            }
            return null;
          }}
        />
      </ContextMenuContent>
      </ExplorerSharedContextMenu>
    </ExplorerContextMenuHost>
  );
}
