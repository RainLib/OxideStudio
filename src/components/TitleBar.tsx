import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button } from "./ui/button";
import {
  Minimize,
  Maximize,
  X,
  PanelLeft,
  PanelRight,
  PanelLeftClose,
  PanelRightClose,
} from "lucide-react";
import { useState, useEffect } from "react";
import {
  panelVariants,
  iconButtonVariants,
  dividerVariants,
} from "@/styles/variants";
import { cn } from "@/styles/utils";

interface TitleBarProps {
  isLeftPanelOpen: boolean;
  isRightPanelOpen: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
}

export function TitleBar({
  isLeftPanelOpen,
  isRightPanelOpen,
  onToggleLeft,
  onToggleRight,
}: TitleBarProps) {
  const handleMinimize = () => getCurrentWindow().minimize();
  const handleMaximize = () => getCurrentWindow().toggleMaximize();
  const handleClose = () => getCurrentWindow().close();

  return (
    <div
      className={cn(
        panelVariants({
          side: "top",
          background: "secondary",
          size: "titleBar",
        }),
        "flex items-center select-none"
      )}
    >
      {/* Left: App Title (Draggable) */}
      <div
        data-tauri-drag-region
        className="pl-3 text-xs text-gray-400 font-medium"
      >
        OxideStudio
      </div>

      {/* Center: Draggable Area (Flex-grow to fill space) */}
      <div data-tauri-drag-region className="flex-1 min-w-0" />

      {/* Right: Panel Toggles + Window Controls (Non-draggable) */}
      <div className="flex items-center gap-1 pr-2 shrink-0">
        {/* Panel Toggle Buttons */}
        <Button
          variant="ghost"
          size="icon"
          className={iconButtonVariants({ size: "sm", variant: "ghost" })}
          onClick={onToggleLeft}
          title="Toggle Left Panel"
        >
          {isLeftPanelOpen ? (
            <PanelLeftClose size={14} />
          ) : (
            <PanelLeft size={14} />
          )}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className={iconButtonVariants({ size: "sm", variant: "ghost" })}
          onClick={onToggleRight}
          title="Toggle Right Panel"
        >
          {isRightPanelOpen ? (
            <PanelRightClose size={14} />
          ) : (
            <PanelRight size={14} />
          )}
        </Button>

        <div
          className={dividerVariants({
            orientation: "vertical",
            color: "divider",
            spacing: "xs",
          })}
        />

        {/* Window Controls */}
        <Button
          variant="ghost"
          size="icon"
          className={iconButtonVariants({ size: "sm", variant: "ghost" })}
          onClick={handleMinimize}
          title="Minimize"
        >
          <Minimize size={12} />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className={iconButtonVariants({ size: "sm", variant: "ghost" })}
          onClick={handleMaximize}
          title="Maximize"
        >
          <Maximize size={12} />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className={iconButtonVariants({ size: "sm", variant: "danger" })}
          onClick={handleClose}
          title="Close"
        >
          <X size={14} />
        </Button>
      </div>
    </div>
  );
}
