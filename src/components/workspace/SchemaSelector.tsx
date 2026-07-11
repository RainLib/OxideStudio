import { useSchemaStore } from "@/store/useSchemaStore";
import { useConnectionStore } from "@/store/useConnectionStore";
import { Check, ChevronDown, Database, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  DEFAULT_DATABASE_DRIVER,
  defaultDatabaseCapabilities,
  pluralizeNamespaceLabel,
} from "@/lib/databaseDialect";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface SchemaSelectorProps {
  currentSchema: string | null;
  onSchemaChange: (schema: string) => void;
}

export function SchemaSelector({
  currentSchema,
  onSchemaChange,
}: SchemaSelectorProps) {
  const schemas = useSchemaStore((state) => state.schemas);
  const { activeConnectionId, connections } = useConnectionStore();
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const activeConnection = connections.find((item) => item.id === activeConnectionId);
  const capabilities = defaultDatabaseCapabilities(
    activeConnection?.driver || DEFAULT_DATABASE_DRIVER
  );
  const namespaceLabel = capabilities.namespaceLabel || "schema";
  const namespaceLabelPlural = pluralizeNamespaceLabel(namespaceLabel);
  const filteredSchemas = useMemo(
    () =>
      schemas.filter((schema) =>
        schema.toLowerCase().includes(searchQuery.trim().toLowerCase())
      ),
    [schemas, searchQuery]
  );

  if (!activeConnectionId || schemas.length === 0) {
    return (
      <span className="flex h-6 items-center gap-1.5 px-1.5 text-[11px] wb-muted">
        <Database size={12} />
        No {namespaceLabelPlural}
      </span>
    );
  }

  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (!open) setSearchQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="wb-schema-selector wb-text-button h-6 max-w-[220px] gap-1.5 px-1.5 text-[11px] font-medium text-[hsl(var(--wb-text))]"
          title={`Target ${namespaceLabel}`}
        >
          <Database size={12} className="shrink-0" />
          <span className="wb-schema-selector-label truncate">
            {currentSchema || `Select ${namespaceLabel}`}
          </span>
          <ChevronDown size={11} className="shrink-0 wb-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={4}
        className="w-64 rounded-[5px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-1 text-[12px] text-[hsl(var(--wb-text))] shadow-[0_16px_40px_rgba(0,0,0,0.42)]"
      >
        {schemas.length > 8 && (
          <div className="relative mb-1 flex h-7 items-center">
            <Search size={12} className="pointer-events-none absolute left-2 wb-muted" />
            <input
              autoFocus
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={`Search ${namespaceLabelPlural}`}
              className="h-7 w-full rounded-[3px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] pl-7 pr-2 text-[11px] outline-none focus:border-[hsl(var(--wb-accent))]"
            />
          </div>
        )}
        <div className="max-h-72 overflow-y-auto custom-scrollbar">
          {filteredSchemas.map((schema) => (
            <button
              type="button"
              key={schema}
              className={cn(
                "flex h-7 w-full items-center gap-2 rounded-[3px] px-2 text-left text-[12px] hover:bg-[hsl(var(--wb-hover))]",
                schema === currentSchema && "bg-[hsl(var(--wb-active))]"
              )}
              onClick={() => {
                onSchemaChange(schema);
                setIsOpen(false);
              }}
            >
              <Database size={12} className="shrink-0 text-[hsl(var(--wb-accent))]" />
              <span className="min-w-0 flex-1 truncate">{schema}</span>
              {schema === currentSchema && <Check size={12} />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
