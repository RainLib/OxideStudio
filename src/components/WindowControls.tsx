import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function WindowControls() {
  const handleMinimize = () => {
    getCurrentWindow().minimize();
  };

  const handleMaximize = () => {
    getCurrentWindow().toggleMaximize();
  };

  const handleClose = () => {
    getCurrentWindow().close();
  };

  const baseButtonClass =
    "h-full flex items-center justify-center px-4 transition-colors duration-200";

  return (
    <div className="flex items-center h-full">
      {/* Minimize Button */}
      <button
        onClick={handleMinimize}
        className={cn(
          baseButtonClass,
          "text-muted-foreground hover:text-foreground",
          "hover:bg-muted-foreground/10 dark:hover:bg-muted-foreground/20"
        )}
        aria-label="Minimize"
      >
        <Minus size={14} strokeWidth={2} />
      </button>

      {/* Maximize Button */}
      <button
        onClick={handleMaximize}
        className={cn(
          baseButtonClass,
          "text-muted-foreground hover:text-foreground",
          "hover:bg-muted-foreground/10 dark:hover:bg-muted-foreground/20"
        )}
        aria-label="Maximize"
      >
        <Square size={12} strokeWidth={2} />
      </button>

      {/* Close Button - Red hover */}
      <button
        onClick={handleClose}
        className={cn(
          baseButtonClass,
          "text-muted-foreground hover:text-white",
          "hover:bg-red-600 dark:hover:bg-red-600"
        )}
        aria-label="Close"
      >
        <X size={16} strokeWidth={2} />
      </button>
    </div>
  );
}
