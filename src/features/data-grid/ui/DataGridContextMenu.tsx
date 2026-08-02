import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export interface DataGridContextMenuItem {
  id: string;
  label: string;
  /** Short hover/focus hint; keeps the menu itself compact. */
  description?: string;
  icon?: ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  children?: DataGridContextMenuItem[];
  onSelect?: () => void;
}

export function dataGridMenuItemHint(item: DataGridContextMenuItem): string {
  return [
    item.description,
    item.shortcut ? `Shortcut: ${item.shortcut}` : undefined,
  ]
    .filter(Boolean)
    .join(" ");
}

export function focusRelativeDataGridMenuItem(
  menu: HTMLElement,
  current: HTMLElement,
  direction: "next" | "previous" | "first" | "last",
) {
  const items = Array.from(
    menu.querySelectorAll<HTMLButtonElement>(
      ':scope > div > button[role="menuitem"]:not(:disabled)',
    ),
  );
  if (items.length === 0) return;
  const currentIndex = items.indexOf(current as HTMLButtonElement);
  const targetIndex =
    direction === "first"
      ? 0
      : direction === "last"
        ? items.length - 1
        : currentIndex < 0
          ? 0
          : direction === "next"
            ? (currentIndex + 1) % items.length
            : (currentIndex - 1 + items.length) % items.length;
  items[targetIndex]?.focus();
}

interface DataGridContextMenuProps {
  x: number;
  y: number;
  items: DataGridContextMenuItem[];
  onClose: () => void;
}

/** Keyboard-accessible context menu for table and result cells. */
export function DataGridContextMenu({
  x,
  y,
  items,
  onClose,
}: DataGridContextMenuProps) {
  const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  const left = Math.max(4, Math.min(x, window.innerWidth - 228));
  const estimatedHeight = Math.min(320, items.length * 28 + 8);
  const top = Math.max(4, Math.min(y, window.innerHeight - estimatedHeight - 4));
  const submenuOpensLeft = left + 452 > window.innerWidth;

  const renderItems = (
    menuItems: DataGridContextMenuItem[],
    nested = false,
  ): ReactNode[] =>
    menuItems.map((item) => {
      const hasChildren = Boolean(item.children?.length);
      const submenuOpen = openSubmenuId === item.id;
      const actionHint = dataGridMenuItemHint(item);
      return (
        <div
          key={item.id}
          className="relative"
          onPointerEnter={() => {
            if (hasChildren) setOpenSubmenuId(item.id);
            else if (!nested) setOpenSubmenuId(null);
          }}
        >
          {item.separatorBefore && (
            <div className="my-1 h-px bg-[hsl(var(--wb-border-subtle))]" />
          )}
          <button
            type="button"
            role="menuitem"
            aria-label={
              item.description ? `${item.label}. ${item.description}` : undefined
            }
            aria-haspopup={hasChildren ? "menu" : undefined}
            aria-expanded={hasChildren ? submenuOpen : undefined}
            title={actionHint || undefined}
            className={cn(
              "flex h-7 w-full items-center gap-2 rounded-[3px] px-2 text-left text-[11px] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-active-strong))] focus-visible:bg-[hsl(var(--wb-active-strong))] focus-visible:outline-none disabled:pointer-events-none disabled:opacity-45",
              item.danger && "text-[hsl(var(--destructive))]",
              submenuOpen && "bg-[hsl(var(--wb-active-strong))]",
            )}
            disabled={item.disabled}
            onClick={() => {
              if (hasChildren) {
                setOpenSubmenuId((current) =>
                  current === item.id ? null : item.id,
                );
                return;
              }
              item.onSelect?.();
              onClose();
            }}
            onKeyDown={(event) => {
              const menu = event.currentTarget.closest<HTMLElement>(
                '[role="menu"]',
              );
              if (menu && event.key === "ArrowDown") {
                event.preventDefault();
                focusRelativeDataGridMenuItem(menu, event.currentTarget, "next");
                return;
              }
              if (menu && event.key === "ArrowUp") {
                event.preventDefault();
                focusRelativeDataGridMenuItem(
                  menu,
                  event.currentTarget,
                  "previous",
                );
                return;
              }
              if (menu && event.key === "Home") {
                event.preventDefault();
                focusRelativeDataGridMenuItem(menu, event.currentTarget, "first");
                return;
              }
              if (menu && event.key === "End") {
                event.preventDefault();
                focusRelativeDataGridMenuItem(menu, event.currentTarget, "last");
                return;
              }
              if (hasChildren && event.key === "ArrowRight") {
                event.preventDefault();
                setOpenSubmenuId(item.id);
              }
              if (nested && event.key === "ArrowLeft") {
                event.preventDefault();
                setOpenSubmenuId(null);
              }
            }}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[hsl(var(--wb-text-muted))]">
              {item.icon}
            </span>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.shortcut && (
              <span className="shrink-0 text-[10px] text-[hsl(var(--wb-text-muted))]">
                {item.shortcut}
              </span>
            )}
            {hasChildren && (
              <ChevronRight
                size={12}
                className="shrink-0 text-[hsl(var(--wb-text-muted))]"
                aria-hidden="true"
              />
            )}
          </button>
          {hasChildren && submenuOpen && (
            <div
              role="menu"
              className={cn(
                "absolute top-0 z-10 max-h-[320px] w-[224px] overflow-y-auto rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-1 shadow-[0_3px_8px_rgba(0,0,0,0.28)]",
                submenuOpensLeft ? "right-full mr-1" : "left-full ml-1",
              )}
            >
              {renderItems(item.children ?? [], true)}
            </div>
          )}
        </div>
      );
    });

  return createPortal(
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 cursor-default bg-transparent"
        aria-label="Close data grid menu"
        onClick={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div
        role="menu"
        className="fixed z-50 max-h-[320px] w-[224px] overflow-y-auto rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-1 shadow-[0_3px_8px_rgba(0,0,0,0.28)]"
        style={{ left, top }}
      >
        {renderItems(items)}
      </div>
    </>,
    document.body,
  );
}
