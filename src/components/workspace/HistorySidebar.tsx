import { Button } from "@/components/ui/button";
import { useHistoryStore } from "@/store/useHistoryStore";
import { format } from "date-fns";
import { Clock, Trash2, Play } from "lucide-react";
import { useTabStore } from "@/store/useTabStore";
import { useConnectionStore } from "@/store/useConnectionStore";

export function HistorySidebar() {
  const { history, clearHistory } = useHistoryStore();
  const { createTab, runTabQuery } = useTabStore();
  const { activeConnectionId } = useConnectionStore();

  const handleRun = (sql: string) => {
    const tabId = createTab("query", "History Check", sql);
    if (activeConnectionId) {
      runTabQuery(tabId, activeConnectionId);
    }
  };

  return (
    <div className="flex flex-col h-full border-r border-border bg-background-tertiary">
      {/* Header */}
      <div className="p-2 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock size={16} className="text-muted-foreground" />
          <span className="font-semibold text-sm">History</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-destructive hover:bg-destructive/10"
          onClick={clearHistory}
          title="Clear History"
        >
          <Trash2 size={12} />
        </Button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto">
        {history.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted-foreground">
            No query history yet. Run some queries!
          </div>
        ) : (
          <div className="flex flex-col divide-y">
            {history.map((item) => (
              <div
                key={item.id}
                className="p-3 hover:bg-accent group flex flex-col gap-1 cursor-default"
              >
                <div className="font-mono text-xs text-muted-foreground line-clamp-3 leading-relaxed break-all">
                  {item.sql}
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] text-muted-foreground opacity-70">
                    {format(item.timestamp, "MMM d, HH:mm")}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 text-[10px] px-1.5 opacity-0 group-hover:opacity-100"
                    onClick={() => handleRun(item.sql)}
                  >
                    <Play size={10} className="mr-1" /> Run
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
