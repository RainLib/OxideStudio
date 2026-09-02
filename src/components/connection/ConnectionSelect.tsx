import { Check, ChevronDown, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { ConnectionGlyph } from "@/components/icons/ConnectionGlyph";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { ConnectionConfig } from "@/store/useConnectionStore";

export function filterConnectionOptions(
  connections: readonly ConnectionConfig[],
  query: string,
) {
  const needle = query.trim().toLocaleLowerCase();
  return [...connections]
    .filter((connection) =>
      !needle ||
      [connection.name, connection.driver, ...(connection.tags || [])]
        .join("\n")
        .toLocaleLowerCase()
        .includes(needle),
    )
    .sort((left, right) =>
      left.name.localeCompare(right.name, undefined, {
        sensitivity: "base",
        numeric: true,
      }),
    );
}

interface ConnectionSelectProps {
  connections: readonly ConnectionConfig[];
  value: string;
  onValueChange: (connectionId: string) => void;
  placeholder?: string;
  className?: string;
}

/** A searchable connection picker for target/source workflows.
 * It deliberately reflects the flat Oxide connection model instead of
 * inventing DBX-style groups that the saved connection schema does not have. */
export function ConnectionSelect({
  connections,
  value,
  onValueChange,
  placeholder = "Choose connection",
  className,
}: ConnectionSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = connections.find((connection) => connection.id === value);
  const visible = useMemo(
    () => filterConnectionOptions(connections, query),
    [connections, query],
  );

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-8 w-full items-center gap-2 rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] px-2 text-left text-[11px] outline-none focus-visible:border-[hsl(var(--wb-accent))] focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent)/0.45)]",
            className,
          )}
          aria-label={placeholder}
        >
          {selected ? (
            <ConnectionGlyph
              driver={selected.driver}
              icon={selected.icon}
              size={12}
              className="shrink-0"
              style={{ color: selected.color || undefined }}
            />
          ) : (
            <Search size={12} className="shrink-0 wb-muted" />
          )}
          <span className={cn("min-w-0 flex-1 truncate", !selected && "wb-muted")}>
            {selected?.name || placeholder}
          </span>
          <ChevronDown size={12} className="shrink-0 wb-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[240px] rounded-[5px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-1 text-[hsl(var(--wb-text))] shadow-[0_16px_40px_rgba(0,0,0,0.42)]"
      >
        <div className="relative mb-1 flex h-7 items-center">
          <Search size={12} className="pointer-events-none absolute left-2 wb-muted" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search connections"
            aria-label="Search connections"
            className="h-7 w-full rounded-[3px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] pl-7 pr-2 text-[11px] outline-none focus:border-[hsl(var(--wb-accent))]"
          />
        </div>
        <div className="max-h-64 overflow-y-auto custom-scrollbar">
          {visible.map((connection) => (
            <button
              type="button"
              key={connection.id}
              data-picker-connection={connection.id}
              className={cn(
                "flex min-h-8 w-full items-center gap-2 rounded-[3px] px-2 py-1 text-left hover:bg-[hsl(var(--wb-hover))]",
                connection.id === value && "bg-[hsl(var(--wb-active))]",
              )}
              onClick={() => {
                onValueChange(connection.id);
                setOpen(false);
                setQuery("");
              }}
            >
              <ConnectionGlyph driver={connection.driver} icon={connection.icon} size={13} className="shrink-0" style={{ color: connection.color || undefined }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px]">{connection.name}</span>
                <span className="block truncate font-mono text-[9px] wb-muted">{connection.driver}</span>
              </span>
              {connection.id === value && <Check size={12} className="shrink-0 text-[hsl(var(--wb-accent))]" />}
            </button>
          ))}
          {visible.length === 0 && <div className="px-2 py-3 text-center text-[11px] wb-muted">No matching connections</div>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
