import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import { iconButtonVariants } from "@/styles/variants";
import { cn } from "@/styles/utils";

export function WindowControls() {
  const appWindow = getCurrentWindow();

  const handleMinimize = () => {
    appWindow.minimize();
  };

  const handleMaximize = () => {
    appWindow.toggleMaximize();
  };

  const handleClose = () => {
    appWindow.close();
  };

  return (
    <div className="flex items-center h-full">
      <button
        onClick={handleMinimize}
        className={cn(
          iconButtonVariants({ size: "md", variant: "ghost" }),
          "h-full px-4 rounded-none"
        )}
        aria-label="Minimize"
      >
        <Minus size={14} />
      </button>
      <button
        onClick={handleMaximize}
        className={cn(
          iconButtonVariants({ size: "md", variant: "ghost" }),
          "h-full px-4 rounded-none"
        )}
        aria-label="Maximize"
      >
        <Square size={12} />
      </button>
      <button
        onClick={handleClose}
        className={cn(
          iconButtonVariants({ size: "md", variant: "danger" }),
          "h-full px-4 rounded-none"
        )}
        aria-label="Close"
      >
        <X size={16} />
      </button>
    </div>
  );
}
