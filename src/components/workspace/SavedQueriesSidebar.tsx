import { Button } from "@/components/ui/button";
import { useSavedQueryStore } from "@/store/useSavedQueryStore";
import { format } from "date-fns";
import { Star, Trash2, Play, Edit2 } from "lucide-react";
import { useTabStore } from "@/store/useTabStore";
import { useConnectionStore } from "@/store/useConnectionStore";
import { cn } from "@/lib/utils";

export function SavedQueriesSidebar() {
  const { savedQueries, deleteQuery } = useSavedQueryStore();
  const { createTab, runTabQuery } = useTabStore();
  const { activeConnectionId } = useConnectionStore();

  const handleRun = (sql: string, name: string) => {
    const tabId = createTab("query", name, sql);
    if (activeConnectionId) {
      runTabQuery(tabId, activeConnectionId);
    }
  };

  return (
    <div className="flex flex-col h-full border-r bg-muted/10">
      {/* Header */}
      <div className="p-2 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Star size={16} className="text-muted-foreground" />
          <span className="font-semibold text-sm">Saved Queries</span>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto">
        {savedQueries.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted-foreground">
            No saved queries found. Save often used queries from the editor!
          </div>
        ) : (
          <div className="flex flex-col divide-y">
            {savedQueries.map((item) => (
              <div
                key={item.id}
                className="p-3 hover:bg-accent group flex flex-col gap-1 cursor-default"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-xs">{item.name}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 text-destructive opacity-0 group-hover:opacity-100"
                    onClick={() => deleteQuery(item.id)}
                  >
                    <Trash2 size={10} />
                  </Button>
                </div>
                <div className="font-mono text-xs text-muted-foreground line-clamp-2 break-all opacity-80">
                  {item.sql}
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] text-muted-foreground opacity-50">
                    {format(item.timestamp, "MMM d, HH:mm")}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 text-[10px] px-1.5 opacity-0 group-hover:opacity-100 bg-background/50"
                    onClick={() => handleRun(item.sql, item.name)}
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
