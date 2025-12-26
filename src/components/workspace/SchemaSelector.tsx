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
      <div className="flex items-center px-3 py-1.5 text-xs text-gray-500">
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
          "hover:bg-[#2a2a2a] border border-transparent hover:border-[#444]",
          isOpen && "bg-[#2a2a2a] border-[#444]"
        )}
      >
        <Database size={14} className="text-orange-500 shrink-0" />
        <span className="text-gray-200 font-medium truncate max-w-[200px]">
          {currentSchema || "Select schema"}
        </span>
        <ChevronDown
          size={14}
          className={cn(
            "text-gray-400 transition-transform shrink-0",
            isOpen && "rotate-180"
          )}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-[#252525] border border-[#333] rounded-lg shadow-xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-2">
          {/* Search Input (if many schemas) */}
          {schemas.length > 10 && (
            <div className="p-2 border-b border-[#333]">
              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500"
                />
                <input
                  type="text"
                  placeholder="Search schemas..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 bg-[#1a1a1a] border border-[#444] rounded text-sm text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-orange-500"
                  autoFocus
                />
              </div>
            </div>
          )}

          {/* Schema List */}
          <div className="max-h-64 overflow-y-auto">
            {filteredSchemas.length === 0 ? (
              <div className="px-4 py-3 text-xs text-gray-500 text-center">
                No schemas found
              </div>
            ) : (
              filteredSchemas.map((schema) => (
                <button
                  key={schema}
                  onClick={() => handleSchemaSelect(schema)}
                  className={cn(
                    "w-full px-4 py-2 text-left text-sm transition-colors flex items-center gap-2",
                    "hover:bg-[#333]",
                    currentSchema === schema
                      ? "bg-[#2a2a2a] text-orange-400 font-medium"
                      : "text-gray-300"
                  )}
                >
                  <Database size={12} className="shrink-0 opacity-50" />
                  <span className="truncate">{schema}</span>
                  {currentSchema === schema && (
                    <span className="ml-auto text-xs text-orange-500">✓</span>
                  )}
                </button>
              ))
            )}
          </div>

          {/* Footer Info */}
          {schemas.length > 0 && (
            <div className="px-3 py-1.5 border-t border-[#333] text-[10px] text-gray-600 text-right">
              {filteredSchemas.length} of {schemas.length} schema
              {schemas.length !== 1 ? "s" : ""}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
