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
    <div className="flex h-9 shrink-0 items-center justify-between border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-3">
      {/* Left: App/View Info */}
      <div className="text-xs font-medium text-[hsl(var(--wb-text-muted))]">Database Manager</div>

      {/* Right: Panel Toggles */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]"
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
          className="h-7 w-7 text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]"
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
