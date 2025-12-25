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
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const appWindow = getCurrentWindow();

    const checkMaximized = async () => {
      const maximized = await appWindow.isMaximized();
      setIsMaximized(maximized);
    };
    checkMaximized();

    const unlisten = appWindow.onResized(() => {
      checkMaximized();
    });

    return () => {
      unlisten.then((fn: () => void) => fn());
    };
  }, []);

  const handleMinimize = () => getCurrentWindow().minimize();
  const handleMaximize = () => getCurrentWindow().toggleMaximize();
  const handleClose = () => getCurrentWindow().close();

  return (
    <div className="h-8 bg-[#1a1a1a] border-b border-[#333] flex items-center select-none shrink-0">
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
          className="h-6 w-6 text-gray-500 hover:text-gray-300 hover:bg-[#2a2a2a]"
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
          className="h-6 w-6 text-gray-500 hover:text-gray-300 hover:bg-[#2a2a2a]"
          onClick={onToggleRight}
          title="Toggle Right Panel"
        >
          {isRightPanelOpen ? (
            <PanelRightClose size={14} />
          ) : (
            <PanelRight size={14} />
          )}
        </Button>

        <div className="w-px h-4 bg-[#444] mx-1" />

        {/* Window Controls */}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-gray-500 hover:text-gray-300 hover:bg-[#2a2a2a]"
          onClick={handleMinimize}
          title="Minimize"
        >
          <Minimize size={12} />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-gray-500 hover:text-gray-300 hover:bg-[#2a2a2a]"
          onClick={handleMaximize}
          title="Maximize"
        >
          <Maximize size={12} />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-gray-500 hover:text-red-500 hover:bg-red-500/10"
          onClick={handleClose}
          title="Close"
        >
          <X size={14} />
        </Button>
      </div>
    </div>
  );
}
