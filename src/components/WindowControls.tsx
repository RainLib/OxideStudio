import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";

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
        className="h-full px-4 hover:bg-white/10 transition-colors"
        aria-label="Minimize"
      >
        <Minus size={14} className="text-gray-400" />
      </button>
      <button
        onClick={handleMaximize}
        className="h-full px-4 hover:bg-white/10 transition-colors"
        aria-label="Maximize"
      >
        <Square size={12} className="text-gray-400" />
      </button>
      <button
        onClick={handleClose}
        className="h-full px-4 hover:bg-red-600 transition-colors"
        aria-label="Close"
      >
        <X size={16} className="text-gray-400 hover:text-white" />
      </button>
    </div>
  );
}
