import type { ReactNode } from "react";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import type { ExplorerMenuItemInput } from "../model/explorerMenuDescriptors";
import {
  EXPLORER_MENU_CONTENT_CLASS,
  EXPLORER_MENU_ITEM_CLASS,
  EXPLORER_MENU_SEPARATOR_CLASS,
  EXPLORER_MENU_SUB_TRIGGER_CLASS,
} from "./explorerStyles";

interface ExplorerActionMenuItemsProps {
  items: readonly ExplorerMenuItemInput[];
  onAction: (action: string) => void;
  renderIcon?: (action: string) => ReactNode;
}

/** Renders capability-filtered registry entries without owning menu state. */
export function ExplorerActionMenuItems({
  items,
  onAction,
  renderIcon,
}: ExplorerActionMenuItemsProps) {
  return items.map((item, index) => {
    const key = `${item.action}:${index}`;
    if (item.separator) {
      return (
        <ContextMenuSeparator
          key={key}
          className={EXPLORER_MENU_SEPARATOR_CLASS}
        />
      );
    }
    if (item.children?.length) {
      return (
        <ContextMenuSub key={key}>
          <ContextMenuSubTrigger
            className={EXPLORER_MENU_SUB_TRIGGER_CLASS}
            disabled={item.disabled}
          >
            {renderIcon?.(item.action)}
            {item.label}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className={EXPLORER_MENU_CONTENT_CLASS}>
            <ExplorerActionMenuItems
              items={item.children}
              onAction={onAction}
              renderIcon={renderIcon}
            />
          </ContextMenuSubContent>
        </ContextMenuSub>
      );
    }
    return (
      <ContextMenuItem
        key={key}
        className={cn(
          EXPLORER_MENU_ITEM_CLASS,
          item.destructive && "text-destructive",
        )}
        disabled={item.disabled}
        onSelect={() => onAction(item.action)}
      >
        {renderIcon?.(item.action)}
        {item.label}
        {item.shortcut && (
          <ContextMenuShortcut>{item.shortcut}</ContextMenuShortcut>
        )}
      </ContextMenuItem>
    );
  });
}
