import { ChevronDown, RefreshCw } from "lucide-react";
import { useSchemaStore } from "@/store/useSchemaStore";
import { useConnectionStore } from "@/store/useConnectionStore";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function DatabaseSelector() {
  const { activeConnectionId } = useConnectionStore();
  const { schemas, currentSchema, setDefaultSchema, loadSchemas, isLoading } =
    useSchemaStore();

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
            "w-full text-[12px] h-7 pl-2 pr-6 border border-[#444] rounded bg-[#131313] text-gray-200 font-medium",
            "appearance-none outline-none transition-all shadow-sm",
            "focus:ring-1 focus:ring-[#f39c12] focus:border-[#f39c12]",
            "hover:border-gray-500",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
          value={currentSchema || ""}
          onChange={handleSchemaChange}
          disabled={isLoading || schemas.length === 0}
        >
          {schemas.length === 0 ? (
            <option value="">No databases</option>
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
        className="h-7 w-7 text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-colors"
        onClick={handleRefresh}
        disabled={isLoading}
        title="Refresh databases"
      >
        <RefreshCw size={13} className={cn(isLoading && "animate-spin")} />
      </Button>
    </div>
  );
}
