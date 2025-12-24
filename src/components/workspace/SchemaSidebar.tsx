import { useEffect } from "react";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useConnectionStore } from "@/store/useConnectionStore";
import { useTabStore } from "@/store/useTabStore";
import { cn } from "@/lib/utils";
import { Table, Search, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SchemaSidebar() {
  const { activeConnectionId } = useConnectionStore();
  const { schemas, tables, currentSchema, isLoading, loadSchemas, loadTables, setCurrentSchema, selectedTable, selectTable } = useSchemaStore();
  const { createTab } = useTabStore();

  useEffect(() => {
    if (activeConnectionId) {
      loadSchemas(activeConnectionId);
    }
  }, [activeConnectionId, loadSchemas]);

  useEffect(() => {
      if (activeConnectionId && currentSchema) {
          loadTables(activeConnectionId, currentSchema);
      }
  }, [activeConnectionId, currentSchema, loadTables]);

  return (
    <div className="w-64 border-r bg-muted/30 flex flex-col h-full bg-sidebar">
      <div className="p-2 border-b flex gap-2">
         <select
            className="w-full h-8 rounded-md border border-input bg-background px-2 text-sm"
            value={currentSchema || ""}
            onChange={(e) => setCurrentSchema(e.target.value)}
         >
             {schemas.map(s => <option key={s} value={s}>{s}</option>)}
         </select>
         <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => activeConnectionId && currentSchema && loadTables(activeConnectionId, currentSchema)}>
             <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
         </Button>
      </div>

      <div className="p-2">
        <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <input placeholder="Filter..." className="w-full h-9 pl-8 rounded-md border border-input bg-background text-sm" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
          {isLoading && tables.length === 0 && <div className="p-4 text-center text-xs text-muted-foreground">Loading tables...</div>}
          <div className="flex flex-col">
              {tables.map(table => (
                  <div
                    key={table.name}
                    className={cn("flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent cursor-pointer group", selectedTable === table.name && "bg-accent text-accent-foreground")}
                    onClick={() => selectTable(table.name)}
                    onDoubleClick={() => {
                        const sql = `SELECT * FROM ${currentSchema}.${table.name} LIMIT 100`;
                        createTab("query", table.name, sql);
                    }}
                  >
                      <Table size={14} className="text-muted-foreground group-hover:text-primary" />
                      <span className="truncate">{table.name}</span>
                  </div>
              ))}
          </div>
      </div>

      <div className="p-2 border-t mt-auto">
        <Button
            variant="destructive"
            className="w-full h-8 text-xs"
            onClick={() => useConnectionStore.getState().disconnect()}
        >
            Disconnect
        </Button>
      </div>
    </div>
  );
}
