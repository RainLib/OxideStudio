import { useTabStore, TabType } from "@/store/useTabStore";
import { cn } from "@/lib/utils";
import { X, Plus, Terminal, Table as TableIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

const TabIcon = ({ type }: { type: TabType }) => {
  if (type === "table")
    return <TableIcon size={12} className="text-orange-500" />;
  return <Terminal size={12} className="text-blue-500" />;
};

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab, createTab } =
    useTabStore();

  return (
    <div className="flex items-center bg-[#1e1e1e] h-9 w-full overflow-hidden border-b border-[#111]">
      <div className="flex-1 flex overflow-x-auto no-scrollbar h-full items-end">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={cn(
              "flex items-center gap-2 px-4 h-8 min-w-[120px] max-w-[200px] text-[11px] cursor-pointer select-none group border-t border-x border-transparent transition-all",
              activeTabId === tab.id
                ? "bg-[#252525] text-gray-100 font-semibold border-[#333] border-b-transparent rounded-t-sm"
                : "bg-[#161616] text-gray-500 hover:bg-[#1e1e1e] hover:text-gray-300 border-transparent"
            )}
            onClick={() => setActiveTab(tab.id)}
          >
            <TabIcon type={tab.type} />
            <span className="truncate flex-1">{tab.title}</span>
            <div
              className="opacity-0 group-hover:opacity-100 hover:bg-[#333] rounded p-0.5 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
            >
              <X size={10} />
            </div>
          </div>
        ))}
      </div>
      <div className="px-2 h-full flex items-center border-l border-[#222]">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-gray-500 hover:text-white hover:bg-[#2a2a2a]"
          onClick={() =>
            createTab(
              "query",
              `Query #${tabs.filter((t) => t.type === "query").length + 1}`
            )
          }
        >
          <Plus size={14} />
        </Button>
      </div>
    </div>
  );
}
