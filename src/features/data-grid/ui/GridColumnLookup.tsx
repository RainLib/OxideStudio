import type { DataGridColumnLookupItem } from "@/features/data-grid/model/columnLookup";
import { popupVariants } from "@/styles/variants/popup";
import { cn } from "@/lib/utils";

interface GridColumnLookupProps {
  "data-state"?: "open" | "closed";
  columnLookupInputRef: React.RefObject<HTMLInputElement | null>;
  columnLookupQuery: string;
  setColumnLookupQuery: React.Dispatch<React.SetStateAction<string>>;
  onColumnLookupKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  filteredColumnLookupItems: DataGridColumnLookupItem[];
  columnLookupSelectedIndex: number;
  setColumnLookupSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  selectColumnLookupItem: (item: DataGridColumnLookupItem | undefined) => void;
}

export function GridColumnLookup({
  columnLookupInputRef,
  columnLookupQuery,
  setColumnLookupQuery,
  onColumnLookupKeyDown,
  filteredColumnLookupItems,
  columnLookupSelectedIndex,
  setColumnLookupSelectedIndex,
  selectColumnLookupItem,
  "data-state": popupState = "open",
}: GridColumnLookupProps) {
  return (
    <div
      data-state={popupState}
      className={cn(popupVariants({ kind: "menu" }), "absolute right-3 top-3 z-20 w-72 overflow-hidden")}
      role="dialog"
      aria-label="Go to column"
    >
      <div className="border-b border-[hsl(var(--wb-border-subtle))] px-2 py-1.5">
        <input
          ref={columnLookupInputRef}
          value={columnLookupQuery}
          onChange={(event) => setColumnLookupQuery(event.target.value)}
          onKeyDown={onColumnLookupKeyDown}
          placeholder="Go to column…"
          aria-label="Search columns"
          className="h-7 w-full rounded border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-surface))] px-2 text-xs outline-none placeholder:text-[hsl(var(--wb-text-muted))] focus:border-[hsl(var(--wb-accent))]"
        />
      </div>
      <div
        className="max-h-56 overflow-y-auto p-1"
        role="listbox"
        aria-label="Matching columns"
      >
        {filteredColumnLookupItems.length === 0 ? (
          <p className="px-2 py-3 text-center text-xs text-[hsl(var(--wb-text-muted))]">
            No matching column
          </p>
        ) : (
          filteredColumnLookupItems.map((item, index) => (
            <button
              key={`${item.index}:${item.name}`}
              id={`grid-column-lookup-${item.index}`}
              type="button"
              role="option"
              aria-selected={index === columnLookupSelectedIndex}
              onMouseMove={() => setColumnLookupSelectedIndex(index)}
              onClick={() => selectColumnLookupItem(item)}
              className={`grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-2 rounded px-2 py-1.5 text-left text-xs transition-colors ${
                index === columnLookupSelectedIndex
                  ? "bg-[hsl(var(--wb-accent)/0.18)] text-[hsl(var(--wb-text))]"
                  : "text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-surface-hover))] hover:text-[hsl(var(--wb-text))]"
              }`}
            >
              <span className="min-w-0 truncate font-medium">{item.name}</span>
              <span className="font-mono text-[10px] text-[hsl(var(--wb-text-muted))]">
                #{item.index + 1}
              </span>
              {item.detail && (
                <span className="col-span-2 min-w-0 truncate text-[10px] text-[hsl(var(--wb-text-muted))]">
                  {item.detail}
                </span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
