import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, Clipboard, RefreshCw } from "lucide-react";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  ExplorerContextMenuHost,
  ExplorerSharedContextMenu,
} from "./ExplorerContextMenuHost";
import { cn } from "@/lib/utils";
import {
  EXPLORER_MENU_CONTENT_CLASS,
  EXPLORER_MENU_ITEM_CLASS,
  EXPLORER_MENU_SEPARATOR_CLASS,
} from "./explorerStyles";

export interface ExplorerDirectoryRowProps {
  expanded: boolean;
  label: string;
  count?: number;
  icon: ReactNode;
  onToggle: () => void;
  onRefresh?: () => void;
  menuActions?: ReactNode;
  inset?: boolean;
  className?: string;
  contextMenuNodeId?: string;
}

export function ExplorerDirectoryRow({
  expanded,
  label,
  count,
  icon,
  onToggle,
  onRefresh,
  menuActions,
  inset = false,
  className,
  contextMenuNodeId,
}: ExplorerDirectoryRowProps) {
  return (
    <ExplorerContextMenuHost>
      <ExplorerSharedContextMenu
        nodeId={contextMenuNodeId ?? `directory:${label}`}
      >
      <ContextMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "wb-tree-row w-full gap-1.5 hover:bg-[hsl(var(--wb-hover))]",
            inset ? "px-1.5" : "px-0.5",
            className,
          )}
          onClick={onToggle}
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown size={12} className="shrink-0 wb-muted" />
          ) : (
            <ChevronRight size={12} className="shrink-0 wb-muted" />
          )}
          {icon}
          <span className="min-w-0 flex-1 truncate text-left text-[11px] font-normal [font-variation-settings:'wght'_430] text-[hsl(var(--wb-text))]">
            {label}
          </span>
          {count !== undefined && (
            <span className="shrink-0 text-[10px] tabular-nums wb-muted">
              {count}
            </span>
          )}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className={EXPLORER_MENU_CONTENT_CLASS}>
        {menuActions}
        {menuActions && (
          <ContextMenuSeparator className={EXPLORER_MENU_SEPARATOR_CLASS} />
        )}
        <ContextMenuItem
          className={EXPLORER_MENU_ITEM_CLASS}
          onClick={onToggle}
        >
          {expanded ? "Collapse" : "Expand"}
        </ContextMenuItem>
        <ContextMenuItem
          className={EXPLORER_MENU_ITEM_CLASS}
          onClick={() => void navigator.clipboard.writeText(label)}
        >
          <Clipboard className="mr-2 h-3.5 w-3.5" />
          Copy Name
        </ContextMenuItem>
        {onRefresh && (
          <>
            <ContextMenuSeparator className={EXPLORER_MENU_SEPARATOR_CLASS} />
            <ContextMenuItem
              className={EXPLORER_MENU_ITEM_CLASS}
              onClick={onRefresh}
            >
              <RefreshCw className="mr-2 h-3.5 w-3.5" />
              Load All / Refresh
              <ContextMenuShortcut>F5</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
      </ExplorerSharedContextMenu>
    </ExplorerContextMenuHost>
  );
}
