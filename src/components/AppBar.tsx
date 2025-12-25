import { ReactNode } from "react";

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
  return (
    <div
      data-tauri-drag-region
      className="h-12 bg-[#1a1a1a] border-b border-[#333] flex items-center shrink-0"
    >
      {/* Left: Space for macOS traffic lights + Optional Title */}
      <div
        data-tauri-drag-region
        className="pl-20 pr-4 flex items-center gap-3 shrink-0"
      >
        {title && (
          <span
            data-tauri-drag-region
            className="text-sm text-gray-300 font-medium whitespace-nowrap"
          >
            {title}
          </span>
        )}
      </div>

      {/* Center: Custom content or draggable spacer */}
      {center ? (
        <div className="flex-1 min-w-0 flex items-center justify-center px-4">
          {center}
        </div>
      ) : (
        <div data-tauri-drag-region className="flex-1 min-w-0" />
      )}

      {/* Right: Custom content (not draggable) */}
      {right && (
        <div className="flex items-center gap-2 pr-3 shrink-0">{right}</div>
      )}
    </div>
  );
}
