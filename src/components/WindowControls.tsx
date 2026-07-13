import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { Minus, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function WindowControls() {
  const handleMinimize = () => {
    void getCurrentWindow().minimize();
  };

  const handleMaximize = () => {
    void getCurrentWindow().toggleMaximize();
  };

  const handleClose = async () => {
    try {
      await invoke("close_current_window");
    } catch (error) {
      console.warn("Native close command failed; falling back to window API", error);
      await getCurrentWindow().close();
    }
  };

  const baseButtonClass =
    "h-full flex items-center justify-center px-4 transition-colors duration-200";

  return (
    <div
      className="flex items-center h-full"
      onPointerDown={(event) => event.stopPropagation()}
    >
      {/* Minimize Button */}
      <button
        type="button"
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
        type="button"
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
        type="button"
        onClick={() => void handleClose()}
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
