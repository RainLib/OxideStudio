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
      className="h-12 bg-muted border-b border-border flex items-center shrink-0 relative"
    >
      {/* Left: Space for macOS traffic lights (or empty space on Windows for symmetry) */}
      <div
        data-tauri-drag-region
        className={`flex items-center shrink-0 ${isMacOS ? "w-20" : "w-4"}`}
      />

      {/* Center: Title (absolute positioned for true centering) or custom content */}
      {title ? (
        <div
          data-tauri-drag-region
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        >
          <span
            data-tauri-drag-region
            className="text-sm text-foreground font-medium whitespace-nowrap"
          >
            {title}
          </span>
        </div>
      ) : center ? (
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
      <div
        data-tauri-drag-region
        className="h-full flex items-center gap-2 shrink-0 ml-auto"
      >
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
