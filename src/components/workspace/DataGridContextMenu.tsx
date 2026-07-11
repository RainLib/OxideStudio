import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { createPortal } from "react-dom";

export interface DataGridContextMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  onSelect: () => void;
}

interface DataGridContextMenuProps {
  x: number;
  y: number;
  items: DataGridContextMenuItem[];
  onClose: () => void;
}

export function DataGridContextMenu({
  x,
  y,
  items,
  onClose,
}: DataGridContextMenuProps) {
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
        className="fixed z-50 w-[224px] overflow-hidden rounded-[6px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-1 shadow-[0_8px_18px_rgba(0,0,0,0.35)]"
        style={{ left, top }}
      >
        {items.map((item) => (
          <div key={item.id}>
            {item.separatorBefore && (
              <div className="my-1 h-px bg-[hsl(var(--wb-border-subtle))]" />
            )}
            <button
              type="button"
              role="menuitem"
              className={cn(
                "flex h-7 w-full items-center gap-2 rounded-[3px] px-2 text-left text-[11px] text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-active-strong))] focus-visible:bg-[hsl(var(--wb-active-strong))] focus-visible:outline-none disabled:pointer-events-none disabled:opacity-45",
                item.danger && "text-[hsl(var(--destructive))]"
              )}
              disabled={item.disabled}
              onClick={() => {
                item.onSelect();
                onClose();
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
            </button>
          </div>
        ))}
      </div>
    </>,
    document.body
  );
}
