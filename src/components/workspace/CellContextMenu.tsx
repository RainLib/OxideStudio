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
      <ContextMenuContent className="w-56 bg-[#1a1a1a] border-[#333]">
        <ContextMenuItem onClick={onEditModal} className="text-gray-300">
          Edit in modal
          <ContextMenuShortcut>⌅Enter</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={onSetNull} className="text-gray-300">
          Set as NULL
        </ContextMenuItem>
        <ContextMenuItem onClick={onQuickFilter} className="text-gray-300">
          Quick Filter
          <ContextMenuShortcut>⌥⌘</ContextMenuShortcut>
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

        <ContextMenuItem onClick={onPaste} className="text-gray-300">
          Paste
          <ContextMenuShortcut>⌘V</ContextMenuShortcut>
        </ContextMenuItem>

        <ContextMenuSeparator className="bg-[#333]" />

        <ContextMenuItem onClick={onCloneRow} className="text-gray-300">
          Clone row
          <ContextMenuShortcut>⌘D</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          onClick={onDeleteRow}
          className="text-gray-300 text-red-400"
        >
          Delete row
          <ContextMenuShortcut>Delete</ContextMenuShortcut>
        </ContextMenuItem>

        <ContextMenuSeparator className="bg-[#333]" />

        <ContextMenuItem onClick={onSeeDetails} className="text-gray-300">
          See details
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
