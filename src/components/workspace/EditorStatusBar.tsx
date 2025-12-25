import { Download, Clock, AlignJustify } from "lucide-react";

interface EditorStatusBarProps {
  rowCount?: number;
  executionTime?: number; // in ms
}

export function EditorStatusBar({
  rowCount,
  executionTime,
}: EditorStatusBarProps) {
  return (
    <div className="h-[28px] px-3 bg-[#e67e22] flex items-center gap-4 text-[11px] text-[#1a1a1a] font-bold select-none shrink-0 shadow-[0_-1px_2px_rgba(0,0,0,0.1)] z-50">
      {/* Execution Info */}
      <div className="flex items-center gap-2 opacity-80">
        <Clock size={12} strokeWidth={2.5} />
        <span>{executionTime ? `${executionTime}ms` : "Ready"}</span>
      </div>

      <div className="h-3 w-[1px] bg-[#1a1a1a]/20" />

      {/* Row Count */}
      <div className="flex items-center gap-2 opacity-80">
        <AlignJustify size={12} strokeWidth={2.5} />
        <span>
          {rowCount !== undefined ? `${rowCount} rows` : "No results"}
        </span>
      </div>

      {/* Right Actions */}
      <div className="ml-auto flex items-center gap-3 opacity-70">
        <div className="flex items-center gap-1 cursor-pointer hover:opacity-100 transition-opacity">
          <Download size={12} />
          <span className="text-[10px]">Download CSV</span>
        </div>
      </div>
    </div>
  );
}
