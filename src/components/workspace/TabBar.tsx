import { useTabStore } from "@/store/useTabStore";
import { cn } from "@/lib/utils";
import { X, Plus, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab, createTab } = useTabStore();

  return (
    <div className="flex items-center border-b bg-muted/40 h-9 w-full overflow-hidden">
        <div className="flex flex-1 overflow-x-auto no-scrollbar">
            {tabs.map(tab => (
                <div
                    key={tab.id}
                    className={cn(
                        "flex items-center gap-2 px-3 min-w-[120px] max-w-[200px] h-9 border-r text-xs cursor-pointer select-none group border-b-2 border-b-transparent",
                        activeTabId === tab.id ? "bg-background border-b-primary font-medium" : "hover:bg-accent/50 text-muted-foreground"
                    )}
                    onClick={() => setActiveTab(tab.id)}
                >
                    <Activity size={12} className={cn("shrink-0", tab.isExecuting ? "text-blue-500 animate-pulse" : "text-muted-foreground")} />
                    <span className="truncate flex-1">{tab.title}</span>
                    <div
                        className="opacity-0 group-hover:opacity-100 hover:bg-muted-foreground/20 rounded p-0.5 cursor-pointer"
                        onClick={(e) => {
                            e.stopPropagation();
                            closeTab(tab.id);
                        }}
                    >
                        <X size={12} />
                    </div>
                </div>
            ))}
        </div>
        <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-none border-l hover:bg-accent"
            onClick={() => createTab()}
        >
            <Plus size={16} />
        </Button>
    </div>
  );
}
