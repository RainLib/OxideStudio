import type { GridCell, GridMouseEventArgs } from "@glideapps/glide-data-grid";
import { createPortal } from "react-dom";
import { PopupPresence } from "@/components/ui/PopupPresence";
import { popupVariants } from "@/styles/variants/popup";
import { cn } from "@/lib/utils";

export interface DataGridHoverTooltipState {
  key: string;
  x: number;
  y: number;
  columnName: string;
  columnType?: string;
  columnComment?: string;
  content: string;
}

function printableGridValue(value: unknown): string {
  if (value === null) return "NULL";
  if (value === undefined) return "";
  if (Array.isArray(value)) return value.map(printableGridValue).join(", ");
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function gridCellTooltipText(cell: GridCell): string {
  if ("displayData" in cell && cell.displayData !== undefined) {
    const displayData = printableGridValue(cell.displayData);
    if (displayData) return displayData;
  }
  if ("data" in cell) return printableGridValue(cell.data);
  return "";
}

interface DataGridHoverTooltipProps {
  tooltip: DataGridHoverTooltipState | null;
}

type HoverableGridMouseEvent = Extract<
  GridMouseEventArgs,
  { kind: "cell" | "header" }
>;

/**
 * Glide's cell bounds are already in viewport coordinates. Its localEvent
 * coordinates are relative to that cell, so adding them gives the pointer's
 * viewport position for the portaled, fixed-position tooltip.
 */
export function gridHoverTooltipPosition(
  event: HoverableGridMouseEvent,
) {
  return {
    x: event.bounds.x + event.localEventX,
    y: event.bounds.y + event.localEventY,
  };
}

/** Displays source column metadata and the complete cell value on hover. */
export function DataGridHoverTooltip({
  tooltip,
}: DataGridHoverTooltipProps) {
  return <PopupPresence open={Boolean(tooltip)}><GridTooltipContent tooltip={tooltip}/></PopupPresence>;
}

function GridTooltipContent({ tooltip, "data-state": popupState = "open" }: DataGridHoverTooltipProps & { "data-state"?: "open" | "closed" }) {
  if (!tooltip || typeof document === "undefined") return null;

  const left = Math.max(8, Math.min(tooltip.x + 12, window.innerWidth - 340));
  const top = Math.max(8, Math.min(tooltip.y + 14, window.innerHeight - 180));

  return createPortal(
    <div
      key={tooltip.key}
      role="tooltip"
      data-state={popupState}
      className={cn(popupVariants({ kind: "tooltip" }), "pointer-events-none fixed z-[70] max-h-40 w-max max-w-[min(320px,calc(100vw-16px))] overflow-hidden px-2.5 py-2 text-[11px]")}
      style={{ left, top }}
    >
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="truncate font-medium">{tooltip.columnName}</span>
        {tooltip.columnType && (
          <span className="shrink-0 text-[10px] text-[hsl(var(--wb-text-muted))]">
            {tooltip.columnType}
          </span>
        )}
      </div>
      {tooltip.columnComment && (
        <p className="mt-1 max-h-10 overflow-hidden whitespace-pre-wrap break-words text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
          {tooltip.columnComment}
        </p>
      )}
      {tooltip.content && (
        <pre className="mt-1 max-h-28 whitespace-pre-wrap break-all font-mono text-[10px] leading-4 text-[hsl(var(--wb-text-secondary))]">
          {tooltip.content}
        </pre>
      )}
    </div>,
    document.body,
  );
}
