import React from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  ContextMenuShortcut,
} from "@/components/ui/context-menu";

interface ColumnHeaderMenuProps {
  column: string;
  onSetNull: () => void;
  onCopy: () => void;
  onCopyColumnName: () => void;
  onCopyAsTSV: () => void;
  onCopyAsJSON: () => void;
  onCopyAsMarkdown: () => void;
  onCopyAsSQL: () => void;
  onCopyForIN: () => void;
  onSortAsc: () => void;
  onSortDesc: () => void;
  onResizeToMatch: () => void;
  onResizeToFit: () => void;
  onResizeToFixed: () => void;
  onHideColumn: () => void;
  onResetLayout: () => void;
  onOpenFilter: () => void;
  children: React.ReactNode;
}

export function ColumnHeaderMenu({
  column,
  onSetNull,
  onCopy,
  onCopyColumnName,
  onCopyAsTSV,
  onCopyAsJSON,
  onCopyAsMarkdown,
  onCopyAsSQL,
  onCopyForIN,
  onSortAsc,
  onSortDesc,
  onResizeToMatch,
  onResizeToFit,
  onResizeToFixed,
  onHideColumn,
  onResetLayout,
  onOpenFilter,
  children,
}: ColumnHeaderMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56 bg-[#1a1a1a] border-[#333]">
        <ContextMenuItem onClick={onSetNull} className="text-gray-300">
          Set as NULL
        </ContextMenuItem>

        <ContextMenuSeparator className="bg-[#333]" />

        <ContextMenuItem onClick={onCopy} className="text-gray-300">
          Copy
          <ContextMenuShortcut>⌘C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={onCopyColumnName} className="text-gray-300">
          Copy Column Name
        </ContextMenuItem>
        <ContextMenuItem onClick={onCopyAsTSV} className="text-gray-300">
          Copy as TSV for Excel
        </ContextMenuItem>
        <ContextMenuItem onClick={onCopyAsJSON} className="text-gray-300">
          Copy as JSON
        </ContextMenuItem>
        <ContextMenuItem onClick={onCopyAsMarkdown} className="text-gray-300">
          Copy as Markdown
        </ContextMenuItem>
        <ContextMenuItem onClick={onCopyAsSQL} className="text-gray-300">
          Copy as SQL
        </ContextMenuItem>
        <ContextMenuItem onClick={onCopyForIN} className="text-gray-300">
          Copy for IN statement
        </ContextMenuItem>

        <ContextMenuSeparator className="bg-[#333]" />

        <ContextMenuItem onClick={onSortAsc} className="text-gray-300">
          Sort ascending
        </ContextMenuItem>
        <ContextMenuItem onClick={onSortDesc} className="text-gray-300">
          Sort descending
        </ContextMenuItem>

        <ContextMenuSeparator className="bg-[#333]" />

        <ContextMenuSub>
          <ContextMenuSubTrigger className="text-gray-300">
            Resize columns
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="bg-[#1a1a1a] border-[#333]">
            <ContextMenuItem
              onClick={onResizeToMatch}
              className="text-gray-300"
            >
              Resize all columns to match
            </ContextMenuItem>
            <ContextMenuItem onClick={onResizeToFit} className="text-gray-300">
              Resize all columns to fit content
            </ContextMenuItem>
            <ContextMenuItem
              onClick={onResizeToFixed}
              className="text-gray-300"
            >
              Resize all columns to fixed width
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuItem onClick={onHideColumn} className="text-gray-300">
          Hide question
        </ContextMenuItem>
        <ContextMenuItem onClick={onResetLayout} className="text-gray-300">
          Reset layout
        </ContextMenuItem>

        <ContextMenuSeparator className="bg-[#333]" />

        <ContextMenuItem onClick={onOpenFilter} className="text-gray-300">
          Open Column Filter
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
