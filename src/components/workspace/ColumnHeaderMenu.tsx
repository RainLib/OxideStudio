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
      <ContextMenuContent className="w-56">
        <ContextMenuItem onClick={onSetNull} className="text-[hsl(var(--wb-text))]">
          Set as NULL
        </ContextMenuItem>

        <ContextMenuSeparator className="bg-[hsl(var(--wb-border-subtle))]" />

        <ContextMenuItem onClick={onCopy} className="text-[hsl(var(--wb-text))]">
          Copy
          <ContextMenuShortcut>⌘C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={onCopyColumnName} className="text-[hsl(var(--wb-text))]">
          Copy Column Name
        </ContextMenuItem>
        <ContextMenuItem onClick={onCopyAsTSV} className="text-[hsl(var(--wb-text))]">
          Copy as TSV for Excel
        </ContextMenuItem>
        <ContextMenuItem onClick={onCopyAsJSON} className="text-[hsl(var(--wb-text))]">
          Copy as JSON
        </ContextMenuItem>
        <ContextMenuItem onClick={onCopyAsMarkdown} className="text-[hsl(var(--wb-text))]">
          Copy as Markdown
        </ContextMenuItem>
        <ContextMenuItem onClick={onCopyAsSQL} className="text-[hsl(var(--wb-text))]">
          Copy as SQL
        </ContextMenuItem>
        <ContextMenuItem onClick={onCopyForIN} className="text-[hsl(var(--wb-text))]">
          Copy for IN statement
        </ContextMenuItem>

        <ContextMenuSeparator className="bg-[hsl(var(--wb-border-subtle))]" />

        <ContextMenuItem onClick={onSortAsc} className="text-[hsl(var(--wb-text))]">
          Sort ascending
        </ContextMenuItem>
        <ContextMenuItem onClick={onSortDesc} className="text-[hsl(var(--wb-text))]">
          Sort descending
        </ContextMenuItem>

        <ContextMenuSeparator className="bg-[hsl(var(--wb-border-subtle))]" />

        <ContextMenuSub>
          <ContextMenuSubTrigger className="text-[hsl(var(--wb-text))]">
            Resize columns
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="">
            <ContextMenuItem
              onClick={onResizeToMatch}
              className="text-[hsl(var(--wb-text))]"
            >
              Resize all columns to match
            </ContextMenuItem>
            <ContextMenuItem onClick={onResizeToFit} className="text-[hsl(var(--wb-text))]">
              Resize all columns to fit content
            </ContextMenuItem>
            <ContextMenuItem
              onClick={onResizeToFixed}
              className="text-[hsl(var(--wb-text))]"
            >
              Resize all columns to fixed width
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuItem onClick={onHideColumn} className="text-[hsl(var(--wb-text))]">
          Hide question
        </ContextMenuItem>
        <ContextMenuItem onClick={onResetLayout} className="text-[hsl(var(--wb-text))]">
          Reset layout
        </ContextMenuItem>

        <ContextMenuSeparator className="bg-[hsl(var(--wb-border-subtle))]" />

        <ContextMenuItem onClick={onOpenFilter} className="text-[hsl(var(--wb-text))]">
          Open Column Filter
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
