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
      className="h-12 bg-[#1a1a1a] border-b border-[#333] flex items-center shrink-0"
    >
      {/* Left: Space for macOS traffic lights + Title - DRAGGABLE */}
      <div
        data-tauri-drag-region
        className="flex-1 pl-20 pr-4 flex items-center gap-3 min-w-0"
      >
        <span
          data-tauri-drag-region
          className="text-sm text-gray-300 font-medium"
        >
          OxideStudio
        </span>
      </div>

      {/* Right: Panel Toggles - NOT draggable */}
      <div className="flex items-center gap-2 pr-3 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-gray-500 hover:text-gray-300 hover:bg-[#2a2a2a]"
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
          className="h-8 w-8 text-gray-500 hover:text-gray-300 hover:bg-[#2a2a2a]"
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
