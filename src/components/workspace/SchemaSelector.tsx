import { useSchemaStore } from "@/store/useSchemaStore";
import { useConnectionStore } from "@/store/useConnectionStore";
import { Database, ChevronDown, Search } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";

interface SchemaSelectorProps {
  currentSchema: string | null;
  onSchemaChange: (schema: string) => void;
}

export function SchemaSelector({
  currentSchema,
  onSchemaChange,
}: SchemaSelectorProps) {
  const { schemas } = useSchemaStore();
  const { activeConnectionId } = useConnectionStore();
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setSearchQuery("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Filter schemas based on search
  const filteredSchemas = schemas.filter((schema) =>
    schema.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSchemaSelect = (schema: string) => {
    onSchemaChange(schema);
    setIsOpen(false);
    setSearchQuery("");
  };

  if (!activeConnectionId || schemas.length === 0) {
    return (
      <div className="flex items-center px-3 py-1.5 text-xs text-muted-foreground/50">
        <Database size={14} className="mr-2" />
        <span>No schemas available</span>
      </div>
    );
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 text-sm transition-colors rounded-md",
          "hover:bg-background-elevated border border-transparent hover:border-border",
          isOpen && "bg-background-elevated border-border"
        )}
      >
        <Database size={14} className="text-primary shrink-0" />
        <span className="text-foreground font-medium truncate max-w-[200px]">
          {currentSchema || "Select schema"}
        </span>
        <ChevronDown
          size={14}
          className={cn(
            "text-muted-foreground/60 transition-transform shrink-0",
            isOpen && "rotate-180"
          )}
        />
      </button>

      {/* Dropdown Menu - Opens Upward */}
      {isOpen && (
        <div className="absolute bottom-full left-0 mb-1 w-64 bg-background-elevated border border-border rounded-lg shadow-xl overflow-hidden z-50 animate-in fade-in slide-in-from-bottom-2">
          {/* Search Input (if many schemas) */}
          {schemas.length > 10 && (
            <div className="p-2 border-b border-border">
              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/50"
                />
                <input
                  type="text"
                  placeholder="Search schemas..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 bg-background-tertiary border border-border rounded text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary"
                  autoFocus
                />
              </div>
            </div>
          )}

          {/* Schema List */}
          <div className="max-h-64 overflow-y-auto">
            {filteredSchemas.length === 0 ? (
              <div className="px-4 py-3 text-xs text-muted-foreground/50 text-center">
                No schemas found
              </div>
            ) : (
              filteredSchemas.map((schema) => (
                <button
                  key={schema}
                  onClick={() => handleSchemaSelect(schema)}
                  className={cn(
                    "w-full px-4 py-2 text-left text-sm transition-colors flex items-center gap-2",
                    "hover:bg-background-tertiary",
                    currentSchema === schema
                      ? "bg-background-secondary text-primary font-medium"
                      : "text-muted-foreground"
                  )}
                >
                  <Database size={12} className="shrink-0 opacity-50" />
                  <span className="truncate">{schema}</span>
                  {currentSchema === schema && (
                    <span className="ml-auto text-xs text-primary">✓</span>
                  )}
                </button>
              ))
            )}
          </div>

          {/* Footer Info */}
          {schemas.length > 0 && (
            <div className="px-3 py-1.5 border-t border-border text-[10px] text-muted-foreground/40 text-right">
              {filteredSchemas.length} of {schemas.length} schema
              {schemas.length !== 1 ? "s" : ""}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
