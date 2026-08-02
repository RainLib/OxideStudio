import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { DatabaseDriver } from "@/services/tauri";
import type { ConnectionConfig } from "@/store/useConnectionStore";
import { Check, Download, Plus, Search } from "lucide-react";
import {
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ConnectionGlyph } from "@/components/icons/ConnectionGlyph";
import { DatabaseBrandIcon } from "@/components/icons/DatabaseBrandIcon";
import {
  filterDataSourceDriverChoices,
  type DataSourceDriverChoice,
} from "@/features/database-drivers";

interface DataSourceListProps {
  dataSources: ConnectionConfig[];
  selectedConnectionId: string | null;
  driverChoices: DataSourceDriverChoice[];
  onSelect: (connectionId: string) => void;
  onCreate: (driver: DatabaseDriver) => void;
}

export function DataSourceList({
  dataSources,
  selectedConnectionId,
  driverChoices,
  onSelect,
  onCreate,
}: DataSourceListProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [query, setQuery] = useState("");
  const clearQueryTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleChoices = useMemo(
    () => filterDataSourceDriverChoices(driverChoices, query),
    [driverChoices, query],
  );

  const chooseDriver = (driver: DatabaseDriver) => {
    onCreate(driver);
    setPickerOpen(false);
    setQuery("");
  };

  useEffect(
    () => () => {
      if (clearQueryTimeout.current) clearTimeout(clearQueryTimeout.current);
    },
    [],
  );

  const updateTypeahead = (event: KeyboardEvent<HTMLDivElement>) => {
    const { key } = event;
    if (key === "Escape") {
      if (query) event.preventDefault();
      setQuery("");
      return;
    }
    if (key === "Enter" && visibleChoices[0]) {
      event.preventDefault();
      chooseDriver(visibleChoices[0].driver);
      return;
    }
    if (key === "Backspace") {
      setQuery((value) => value.slice(0, -1));
      return;
    }
    if (key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return;
    setQuery((value) => `${value}${key}`);
    if (clearQueryTimeout.current) clearTimeout(clearQueryTimeout.current);
    clearQueryTimeout.current = setTimeout(() => setQuery(""), 900);
  };

  return (
    <aside className="flex w-[238px] shrink-0 flex-col border-r border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))]">
      <div className="flex h-9 items-center justify-between px-3 text-[12px] font-semibold">
        <span>Data Sources</span>
        <span className="text-[10px] font-normal wb-muted">{dataSources.length}</span>
      </div>
      <div className="flex h-8 items-center border-y border-[hsl(var(--wb-border-subtle))] px-1.5">
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="wb-icon-button"
              title="New Data Source"
              aria-label="New Data Source"
            >
              <Plus size={14} />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            side="right"
            sideOffset={6}
            onKeyDownCapture={updateTypeahead}
            className="flex h-[min(440px,calc(100dvh-126px))] w-[288px] flex-col overflow-hidden rounded-[5px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] p-0 text-[hsl(var(--wb-text))] shadow-[0_16px_40px_rgba(0,0,0,0.42)]"
          >
            <div className="flex h-8 items-center gap-2 border-b border-[hsl(var(--wb-border-subtle))] px-2 text-[11px]">
              <Search size={12} className="shrink-0 wb-muted" />
              <span className="min-w-0 flex-1 truncate">
                {query ? `Search: ${query}` : "Type to search databases"}
              </span>
              <span className="shrink-0 text-[9px] wb-muted">
                {visibleChoices.length}/{driverChoices.length}
              </span>
            </div>
            <div
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y p-1 custom-scrollbar"
              onWheel={(event) => event.stopPropagation()}
            >
              {visibleChoices.length === 0 ? (
                <div className="px-2 py-5 text-center text-[11px] wb-muted">
                  No database products match “{query}”.
                </div>
              ) : (
                visibleChoices.map((choice) => {
                  const isAvailable = choice.availability === "available";
                  const status =
                    choice.availability === "activationRequired"
                      ? "Activate driver"
                      : choice.availability === "installationRequired"
                        ? "Install driver"
                        : "Ready";
                  return (
                    <button
                      type="button"
                      key={choice.driver}
                      className="flex min-h-8 w-full items-center gap-2 rounded-[3px] px-2 py-1 text-left hover:bg-[hsl(var(--wb-active-strong))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))]"
                      onClick={() => chooseDriver(choice.driver)}
                    >
                      <DatabaseBrandIcon
                        driver={choice.driver}
                        size={14}
                        className="shrink-0"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] text-[hsl(var(--wb-text))]">
                          {choice.label}
                        </span>
                        <span className="block truncate font-mono text-[9px] wb-muted">
                          {choice.driver} · {choice.dataModel}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "flex shrink-0 items-center gap-1 text-[9px]",
                          isAvailable
                            ? "text-[hsl(var(--wb-accent))]"
                            : "text-amber-400",
                        )}
                      >
                        {isAvailable ? <Check size={10} /> : <Download size={10} />}
                        {status}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            <div className="flex h-7 items-center border-t border-[hsl(var(--wb-border-subtle))] px-2 text-[9px] wb-muted">
              Enter selects · Esc clears search
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1 custom-scrollbar">
        {dataSources.map((connection) => {
          const isSelected = connection.id === selectedConnectionId;

          return (
            <button
              type="button"
              key={connection.id}
              className={cn(
                "flex h-7 w-full items-center gap-2 rounded-[3px] px-2 text-left text-[12px]",
                isSelected
                  ? "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-text))]"
                  : "text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))]"
              )}
              onClick={() => onSelect(connection.id)}
            >
              <ConnectionGlyph
                driver={connection.driver}
                icon={connection.icon}
                size={13}
                className="shrink-0"
                style={{ color: connection.color || undefined }}
              />
              <span className="min-w-0 flex-1 truncate">{connection.name}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
