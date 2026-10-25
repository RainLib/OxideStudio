import { cn } from "@/lib/utils";
import { popupVariants } from "@/styles/variants/popup";
import { PopupPresence } from "@/components/ui/PopupPresence";
import { registerPopupFocusOrigin } from "@/lib/popupFocus";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  "data-state"?: "open" | "closed";
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
  "data-state": popupState = "open",
}: DataGridContextMenuProps) {
  const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null);
  const [submenuPosition, setSubmenuPosition] = useState({ left: 0, top: 0 });
  const keyboardSubmenu = useRef(false);
  const menuRoot = useRef<HTMLDivElement>(null);
  const trigger = useRef(typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useLayoutEffect(() => { menuRoot.current?.querySelector<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')?.focus(); }, []);
  useLayoutEffect(() => {
    if (!openSubmenuId || !keyboardSubmenu.current) return;
    keyboardSubmenu.current = false;
    const submenu = Array.from(document.querySelectorAll<HTMLElement>("[data-grid-submenu]")).find((element) => element.dataset.gridSubmenu === openSubmenuId);
    submenu?.querySelector<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')?.focus();
  }, [openSubmenuId]);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onClose(); trigger.current?.focus({ preventScroll: true }); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  const left = Math.max(4, Math.min(x, window.innerWidth - 228));
  const estimatedHeight = Math.min(320, items.length * 28 + 8);
  const top = Math.max(4, Math.min(y, window.innerHeight - estimatedHeight - 4));
  const placeSubmenu = (item: DataGridContextMenuItem, element: HTMLElement) => {
    const bounds = element.getBoundingClientRect();
    const height = Math.min(320, (item.children?.length ?? 0) * 28 + 8);
    setSubmenuPosition({
      left: Math.max(4, bounds.right + 228 > window.innerWidth ? bounds.left - 228 : bounds.right + 4),
      top: Math.max(4, Math.min(bounds.top, window.innerHeight - height - 4)),
    });
  };

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
          onPointerEnter={(event) => {
            if (hasChildren) { placeSubmenu(item, event.currentTarget); setOpenSubmenuId(item.id); }
            else if (!nested) setOpenSubmenuId(null);
          }}
        >
          {item.separatorBefore && (
            <div className="my-1 h-px bg-[hsl(var(--wb-border-subtle))]" />
          )}
          <button
            type="button"
            role="menuitem"
            data-grid-menu-item={item.id}
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
            onClick={(event) => {
              if (hasChildren) {
                placeSubmenu(item, event.currentTarget);
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
                keyboardSubmenu.current = true;
                placeSubmenu(item, event.currentTarget);
                setOpenSubmenuId(item.id);
              }
              if (nested && event.key === "ArrowLeft") {
                event.preventDefault();
                const parent = menuRoot.current?.querySelector<HTMLElement>('[aria-expanded="true"]');
                setOpenSubmenuId(null);
                parent?.focus();
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
          {createPortal(<PopupPresence open={popupState === "open" && hasChildren && submenuOpen}>
            <div
              role="menu"
              aria-label={item.label}
              data-grid-submenu={item.id}
              ref={(element) => registerPopupFocusOrigin(element, trigger.current)}
              className={cn(
                popupVariants({ kind: "menu" }),
                "fixed z-[60] max-h-[min(320px,calc(100dvh-8px))] w-[min(224px,calc(100vw-8px))] overflow-y-auto p-1",
              )}
              style={submenuPosition}
            >
              {renderItems(item.children ?? [], true)}
            </div>
          </PopupPresence>, document.body)}
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
        ref={(element) => { menuRoot.current = element; registerPopupFocusOrigin(element, trigger.current); }}
        data-state={popupState}
        className={cn(popupVariants({ kind: "menu" }), "fixed z-50 max-h-[320px] w-[224px] overflow-y-auto p-1")}
        style={{ left, top }}
      >
        {renderItems(items)}
      </div>
    </>,
    document.body,
  );
}
