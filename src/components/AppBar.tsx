import { ReactNode } from "react";
import { WindowControls } from "./WindowControls";

interface AppBarProps {
  /**
   * Optional content to display in the center area
   */
  center?: ReactNode;

  /**
   * Optional content to display on the right side
   */
  right?: ReactNode;

  /**
   * Optional title to display on the left (after traffic lights spacing)
   */
  title?: string;
}

export function AppBar({ center, right, title }: AppBarProps) {
  // Detect if we're on macOS
  const isMacOS =
    typeof window !== "undefined" &&
    navigator.platform.toUpperCase().indexOf("MAC") >= 0;

  return (
    <div
      data-tauri-drag-region
      className="h-12 bg-muted border-b border-border flex items-center shrink-0"
    >
      {/* Left: Space for macOS traffic lights + Optional Title */}
      <div
        data-tauri-drag-region
        className={`pr-4 flex items-center gap-3 shrink-0 ${
          isMacOS ? "pl-20" : "pl-4"
        }`}
      >
        {title && (
          <span
            data-tauri-drag-region
            className="text-sm text-foreground font-medium whitespace-nowrap"
          >
            {title}
          </span>
        )}
      </div>

      {/* Center: Custom content or draggable spacer */}
      {center ? (
        <div
          data-tauri-drag-region
          className="flex-1 min-w-0 flex items-center justify-center px-4"
        >
          {center}
        </div>
      ) : (
        <div data-tauri-drag-region className="flex-1 min-w-0" />
      )}

      {/* Right: Custom content + Window controls on Windows */}
      <div data-tauri-drag-region className="flex items-center gap-2 shrink-0">
        {right && (
          <div data-tauri-drag-region className="pr-3">
            {right}
          </div>
        )}
        {!isMacOS && <WindowControls />}
      </div>
    </div>
  );
}
