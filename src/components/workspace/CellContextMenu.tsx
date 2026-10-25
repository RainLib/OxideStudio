import React from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  ContextMenuShortcut,
} from "@/components/ui/context-menu";

interface CellContextMenuProps {
  onEditModal: () => void;
  onSetNull: () => void;
  onQuickFilter: () => void;
  onCopy: () => void;
  onCopyColumnName: () => void;
  onCopyAsTSV: () => void;
  onCopyAsJSON: () => void;
  onCopyAsMarkdown: () => void;
  onCopyAsSQL: () => void;
  onCopyForIN: () => void;
  onPaste: () => void;
  onCloneRow: () => void;
  onDeleteRow: () => void;
  onSeeDetails: () => void;
  children: React.ReactNode;
}

export function CellContextMenu({
  onEditModal,
  onSetNull,
  onQuickFilter,
  onCopy,
  onCopyColumnName,
  onCopyAsTSV,
  onCopyAsJSON,
  onCopyAsMarkdown,
  onCopyAsSQL,
  onCopyForIN,
  onPaste,
  onCloneRow,
  onDeleteRow,
  onSeeDetails,
  children,
}: CellContextMenuProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onClick={onEditModal} className="text-[hsl(var(--wb-text))]">
          Edit in modal
          <ContextMenuShortcut>⌅Enter</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={onSetNull} className="text-[hsl(var(--wb-text))]">
          Set as NULL
        </ContextMenuItem>
        <ContextMenuItem onClick={onQuickFilter} className="text-[hsl(var(--wb-text))]">
          Quick Filter
          <ContextMenuShortcut>⌥⌘</ContextMenuShortcut>
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

        <ContextMenuItem onClick={onPaste} className="text-[hsl(var(--wb-text))]">
          Paste
          <ContextMenuShortcut>⌘V</ContextMenuShortcut>
        </ContextMenuItem>

        <ContextMenuSeparator className="bg-[hsl(var(--wb-border-subtle))]" />

        <ContextMenuItem onClick={onCloneRow} className="text-[hsl(var(--wb-text))]">
          Clone row
          <ContextMenuShortcut>⌘D</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          onClick={onDeleteRow}
          className="text-[hsl(var(--destructive))] focus:text-[hsl(var(--destructive))]"
        >
          Delete row
          <ContextMenuShortcut>Delete</ContextMenuShortcut>
        </ContextMenuItem>

        <ContextMenuSeparator className="bg-[hsl(var(--wb-border-subtle))]" />

        <ContextMenuItem onClick={onSeeDetails} className="text-[hsl(var(--wb-text))]">
          See details
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
