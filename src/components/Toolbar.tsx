import { Button } from "./ui/button";
import {
  PanelLeft,
  PanelRight,
  PanelLeftClose,
  PanelRightClose,
} from "lucide-react";

interface ToolbarProps {
  isLeftPanelOpen: boolean;
  isRightPanelOpen: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
}

export function Toolbar({
  isLeftPanelOpen,
  isRightPanelOpen,
  onToggleLeft,
  onToggleRight,
}: ToolbarProps) {
  return (
    <div className="h-9 bg-[#1a1a1a] border-b border-[#333] flex items-center justify-between px-3 shrink-0">
      {/* Left: App/View Info */}
      <div className="text-xs text-gray-400 font-medium">Database Manager</div>

      {/* Right: Panel Toggles */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-gray-500 hover:text-gray-300 hover:bg-[#2a2a2a]"
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
          className="h-7 w-7 text-gray-500 hover:text-gray-300 hover:bg-[#2a2a2a]"
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
