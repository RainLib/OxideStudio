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
  connectionId?: string | null;
  currentSchema: string | null;
  onSchemaChange: (schema: string) => void;
  databases?: string[];
  currentDatabase?: string | null;
  onDatabaseChange?: (database: string) => void;
  isDatabaseRefreshing?: boolean;
  databaseSelectionDisabled?: boolean;
}

export function filterAndSortNamespaceOptions(
  options: string[],
  searchQuery: string
) {
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  return [...new Set(options)]
    .filter((option) => option.toLocaleLowerCase().includes(normalizedSearch))
    .sort((left, right) =>
      left.localeCompare(right, undefined, {
        sensitivity: "base",
        numeric: true,
      })
    );
}

export function SchemaSelector({
  connectionId,
  currentSchema,
  onSchemaChange,
  databases = [],
  currentDatabase = null,
  onDatabaseChange,
  isDatabaseRefreshing = false,
  databaseSelectionDisabled = false,
}: SchemaSelectorProps) {
  const schemas = useSchemaStore((state) => state.schemas);
  const { activeConnectionId, connections } = useConnectionStore();
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const effectiveConnectionId = connectionId || activeConnectionId;
  const activeConnection = connections.find(
    (item) => item.id === effectiveConnectionId
  );
  const capabilities = defaultDatabaseCapabilities(
    activeConnection?.driver || DEFAULT_DATABASE_DRIVER
  );
  const selectsPostgresDatabase =
    activeConnection?.driver === "postgres" && Boolean(onDatabaseChange);
  const namespaceLabel = selectsPostgresDatabase
    ? "database"
    : capabilities.namespaceLabel || "schema";
  const namespaceLabelPlural = pluralizeNamespaceLabel(namespaceLabel);
  const options = selectsPostgresDatabase ? databases : schemas;
  const selectedValue = selectsPostgresDatabase ? currentDatabase : currentSchema;
  const filteredOptions = useMemo(() => {
    return filterAndSortNamespaceOptions(options, searchQuery);
  }, [options, searchQuery]);

  if (!effectiveConnectionId || options.length === 0) {
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
          disabled={selectsPostgresDatabase && databaseSelectionDisabled}
          className="wb-schema-selector wb-text-button h-6 max-w-[220px] gap-1.5 px-1.5 text-[11px] font-medium text-[hsl(var(--wb-text))] disabled:cursor-not-allowed disabled:opacity-50"
          title={
            selectsPostgresDatabase && databaseSelectionDisabled
              ? "Finish the active transaction before changing database"
              : `Target ${namespaceLabel}`
          }
        >
          <Database size={12} className="shrink-0" />
          <span className="wb-schema-selector-label truncate">
            {selectedValue || `Select ${namespaceLabel}`}
          </span>
          <ChevronDown size={11} className="shrink-0 wb-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={4}
        className="w-64 rounded-[5px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-1 text-[12px] text-[hsl(var(--wb-text))] shadow-[0_16px_40px_rgba(0,0,0,0.42)]"
      >
        <div className="relative mb-1 flex h-7 items-center">
          <Search size={12} className="pointer-events-none absolute left-2 wb-muted" />
          <input
            autoFocus
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={`Filter ${namespaceLabelPlural}`}
            aria-label={`Filter ${namespaceLabelPlural}`}
            className="h-7 w-full rounded-[3px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] pl-7 pr-2 text-[11px] outline-none focus:border-[hsl(var(--wb-accent))]"
          />
        </div>
        <div className="flex h-5 items-center justify-between px-2 text-[10px] wb-muted">
          <span>{filteredOptions.length} {namespaceLabelPlural}</span>
          {selectsPostgresDatabase && isDatabaseRefreshing && (
            <span role="status">Refreshing…</span>
          )}
        </div>
        <div className="max-h-72 overflow-y-auto custom-scrollbar">
          {filteredOptions.map((option) => (
            <button
              type="button"
              key={option}
              className={cn(
                "flex h-7 w-full items-center gap-2 rounded-[3px] px-2 text-left text-[12px] hover:bg-[hsl(var(--wb-hover))]",
                option === selectedValue && "bg-[hsl(var(--wb-active))]"
              )}
              onClick={() => {
                if (selectsPostgresDatabase) {
                  onDatabaseChange?.(option);
                } else {
                  onSchemaChange(option);
                }
                setIsOpen(false);
              }}
            >
              <Database size={12} className="shrink-0 text-[hsl(var(--wb-accent))]" />
              <span className="min-w-0 flex-1 truncate">{option}</span>
              {option === selectedValue && <Check size={12} />}
            </button>
          ))}
          {filteredOptions.length === 0 && (
            <div className="px-2 py-3 text-center text-[11px] wb-muted">
              No matching {namespaceLabelPlural}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
