import type { WorkbenchSide } from "@/lib/appSettings";
import { cn } from "@/lib/utils";
import type { MouseEvent, ReactNode } from "react";

interface SideToolWindowProps {
  side: WorkbenchSide;
  isOpen: boolean;
  width: number;
  isActive?: boolean;
  onFocus?: () => void;
  onDragStart: (event: MouseEvent) => void;
  children: ReactNode;
}

export function SideToolWindow({
  side,
  isOpen,
  width,
  isActive = false,
  onFocus,
  onDragStart,
  children,
}: SideToolWindowProps) {
  return (
    <div
      className={cn(
        "relative flex h-full shrink-0 flex-col overflow-hidden transition-[width] duration-150 ease-out",
        isOpen
          ? "wb-tool-window rounded-[6px]"
          : "border-0",
        isActive && "wb-panel-active"
      )}
      style={{ width: `${isOpen ? width : 0}px` }}
      onFocus={onFocus}
      data-tool-window-side={side}
      tabIndex={isOpen ? -1 : undefined}
    >
      <div
        className={cn(
          "min-h-0 flex-1",
          !isOpen && "invisible pointer-events-none"
        )}
        aria-hidden={!isOpen}
      >
        {children}
      </div>
      {isOpen && (
        <>
          <div
            className={cn(
              "wb-resizer-x absolute bottom-0 top-0 z-50",
              side === "left" ? "right-0" : "left-0"
            )}
            onMouseDown={onDragStart}
          />
        </>
      )}
    </div>
  );
}
