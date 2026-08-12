import { Button } from "./ui/button";
import {
  PanelLeft,
  PanelRight,
  PanelLeftClose,
  PanelRightClose,
} from "lucide-react";

interface IntegratedToolbarProps {
  isLeftPanelOpen: boolean;
  isRightPanelOpen: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
}

export function IntegratedToolbar({
  isLeftPanelOpen,
  isRightPanelOpen,
  onToggleLeft,
  onToggleRight,
}: IntegratedToolbarProps) {
  return (
    <div
      data-tauri-drag-region
      className="flex h-12 shrink-0 items-center border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))]"
    >
      {/* Left: Space for macOS traffic lights + Title - DRAGGABLE */}
      <div
        data-tauri-drag-region
        className="flex-1 pl-20 pr-4 flex items-center gap-3 min-w-0"
      >
        <span
          data-tauri-drag-region
          className="text-sm font-medium text-[hsl(var(--wb-text))]"
        >
          OxideStudio
        </span>
      </div>

      {/* Right: Panel Toggles - NOT draggable */}
      <div className="flex items-center gap-2 pr-3 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]"
          onClick={onToggleLeft}
          title="Toggle Left Panel"
        >
          {isLeftPanelOpen ? (
            <PanelLeftClose size={16} />
          ) : (
            <PanelLeft size={16} />
          )}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]"
          onClick={onToggleRight}
          title="Toggle Right Panel"
        >
          {isRightPanelOpen ? (
            <PanelRightClose size={16} />
          ) : (
            <PanelRight size={16} />
          )}
        </Button>
      </div>
    </div>
  );
}
