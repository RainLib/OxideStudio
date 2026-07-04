import { ChevronDown, RefreshCw } from "lucide-react";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useConnectionStore } from "@/store/useConnectionStore";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DEFAULT_DATABASE_DRIVER,
  defaultDatabaseCapabilities,
  pluralizeNamespaceLabel,
} from "@/lib/databaseDialect";

export function DatabaseSelector() {
  const { activeConnectionId, connections } = useConnectionStore();
  const { schemas, currentSchema, setDefaultSchema, loadSchemas, isLoading } =
    useSchemaStore();
  const activeConnection = connections.find((c) => c.id === activeConnectionId);
  const capabilities = defaultDatabaseCapabilities(
    activeConnection?.driver || DEFAULT_DATABASE_DRIVER
  );
  const namespaceLabel = capabilities.namespaceLabel || "database";
  const namespaceLabelPlural = pluralizeNamespaceLabel(namespaceLabel);

  const handleSchemaChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newSchema = e.target.value;
    console.log("DatabaseSelector: Schema changed to:", newSchema);
    setDefaultSchema(newSchema);
  };

  const handleRefresh = () => {
    if (activeConnectionId) {
      loadSchemas(activeConnectionId);
    }
  };

  if (!activeConnectionId) {
    return null;
  }

  return (
    <div className="flex items-center gap-1">
      <div className="relative flex-1">
        <select
          className={cn(
            "w-full text-[12px] h-7 pl-2 pr-6 border border-border rounded bg-background-primary text-foreground font-medium",
            "appearance-none outline-none transition-all shadow-sm",
            "focus:ring-1 focus:ring-primary focus:border-primary",
            "hover:border-border-divider",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
          value={currentSchema || ""}
          onChange={handleSchemaChange}
          disabled={isLoading || schemas.length === 0}
        >
          {schemas.length === 0 ? (
            <option value="">No {namespaceLabelPlural}</option>
          ) : (
            schemas.map((s, idx) => (
              <option key={`${s}-${idx}`} value={s}>
                {s}
              </option>
            ))
          )}
        </select>
        <ChevronDown
          className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400"
          size={12}
        />
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-background-elevated transition-colors"
        onClick={handleRefresh}
        disabled={isLoading}
        title={`Refresh ${namespaceLabelPlural}`}
      >
        <RefreshCw size={13} className={cn(isLoading && "animate-spin")} />
      </Button>
    </div>
  );
}
