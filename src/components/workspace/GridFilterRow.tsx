import { useCallback, useEffect, useMemo, useState } from "react";
import type { GridColumn } from "@glideapps/glide-data-grid";
import { ArrowUpDown, Code2, Filter, Plus, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { DatabaseCapabilities, DatabaseDriver } from "@/services/tauri/types";
import { WhereCompletionInput } from "./WhereCompletionInput";
import {
  rememberDataGridConditionHistory,
  type DataGridConditionHistoryScope,
} from "@/features/data-grid/model/conditionHistory";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type FilterOperator =
  | "equals"
  | "contains"
  | "startsWith"
  | "endsWith"
  | ">"
  | "<"
  | ">="
  | "<=";

export interface ColumnFilter {
  column: string;
  operator: FilterOperator;
  value: string;
  logic?: "AND" | "OR";
}

interface GridFilterRowProps {
  columns: readonly GridColumn[];
  mode: "visual" | "sql";
  visualFilters: ColumnFilter[];
  sqlFilter: string;
  onModeChange: (mode: "visual" | "sql") => void;
  onVisualFiltersChange: (filters: ColumnFilter[]) => void;
  onSqlFilterChange: (sql: string) => void;
  onSearch?: () => void;
  connectionId?: string | null;
  driver?: DatabaseDriver | null;
  capabilities?: DatabaseCapabilities | null;
  tabId?: string | null;
  databaseName?: string | null;
  schemaName?: string | null;
  tableName?: string | null;
  sortColumn?: string | null;
  sortDirection?: "asc" | "desc" | null;
  onSortChange?: (
    column: string | null,
    direction: "asc" | "desc" | null,
  ) => void;
}

const operatorLabels: Record<FilterOperator, string> = {
  equals: "=",
  contains: "contains",
  startsWith: "starts with",
  endsWith: "ends with",
  ">": ">",
  "<": "<",
  ">=": ">=",
  "<=": "<=",
};

const filterButtonClass =
  "inline-flex h-6 shrink-0 items-center justify-center gap-1 rounded-[3px] px-1.5 text-[10px] wb-muted hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))] disabled:opacity-40";

function gridColumnId(column: GridColumn) {
  return String(column.id || column.title);
}

/** Keep column ordering stable while narrowing a dense schema list. */
export function filterGridColumns(
  columns: readonly GridColumn[],
  query: string,
) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return columns;

  return columns.filter((column) =>
    [gridColumnId(column), column.title]
      .filter(Boolean)
      .some((value) => value.toLowerCase().includes(normalizedQuery)),
  );
}

function FilterColumnSelect({
  columns,
  value,
  onValueChange,
}: {
  columns: readonly GridColumn[];
  value: string;
  onValueChange: (column: string) => void;
}) {
  const [columnSearch, setColumnSearch] = useState("");
  const filteredColumns = useMemo(
    () => filterGridColumns(columns, columnSearch),
    [columnSearch, columns],
  );

  return (
    <Select
      value={value}
      onValueChange={onValueChange}
      onOpenChange={(open) => {
        if (!open) setColumnSearch("");
      }}
    >
      <SelectTrigger
        aria-label="Filter column"
        className="h-6 w-[160px] shrink-0 border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] px-2 text-[11px]"
      >
        <SelectValue placeholder="Column" />
      </SelectTrigger>
      <SelectContent
        header={
          <div
            className="flex items-center gap-1.5 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-2 py-1.5"
            data-filter-column-search
            onPointerDown={(event) => event.stopPropagation()}
          >
            <Search size={12} className="wb-muted shrink-0" aria-hidden="true" />
            <input
              autoFocus
              value={columnSearch}
              onChange={(event) => setColumnSearch(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
              placeholder="Search columns"
              aria-label="Search filter columns"
              className="h-6 min-w-0 flex-1 rounded-[3px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] px-1.5 text-[11px] outline-none placeholder:text-[hsl(var(--wb-text-muted))] focus:border-[hsl(var(--wb-accent))] focus:ring-1 focus:ring-[hsl(var(--wb-accent))]"
            />
          </div>
        }
      >
        {filteredColumns.length > 0 ? (
          filteredColumns.map((column) => {
            const id = gridColumnId(column);
            return (
              <SelectItem key={id} value={id} className="text-xs">
                {column.title}
              </SelectItem>
            );
          })
        ) : (
          <div className="px-2 py-2 text-[11px] wb-muted" role="status">
            No matching columns
          </div>
        )}
      </SelectContent>
    </Select>
  );
}

export function GridFilterRow({
  columns,
  mode,
  visualFilters,
  sqlFilter,
  onModeChange,
  onVisualFiltersChange,
  onSqlFilterChange,
  onSearch,
  connectionId,
  driver,
  capabilities,
  tabId,
  databaseName,
  schemaName,
  tableName,
  sortColumn,
  sortDirection,
  onSortChange,
}: GridFilterRowProps) {
  const [whereHistoryRevision, setWhereHistoryRevision] = useState(0);
  const whereHistoryScope = useMemo<DataGridConditionHistoryScope>(
    () => ({ connectionId, databaseName, schemaName, tableName }),
    [connectionId, databaseName, schemaName, tableName],
  );
  const applySqlFilter = useCallback(() => {
    rememberDataGridConditionHistory(whereHistoryScope, sqlFilter);
    setWhereHistoryRevision((revision) => revision + 1);
    onSearch?.();
  }, [onSearch, sqlFilter, whereHistoryScope]);

  useEffect(() => {
    if (mode !== "visual" || columns.length === 0) return;
    const firstColumn = String(columns[0]?.id || columns[0]?.title || "");
    if (visualFilters.length === 0) {
      onVisualFiltersChange([
        { column: firstColumn, operator: "equals", value: "" },
      ]);
      return;
    }
    if (visualFilters.some((filter) => !filter.column)) {
      onVisualFiltersChange(
        visualFilters.map((filter) =>
          filter.column ? filter : { ...filter, column: firstColumn }
        )
      );
    }
  }, [columns, mode, onVisualFiltersChange, visualFilters]);

  const updateFilter = useCallback(
    (index: number, patch: Partial<ColumnFilter>) => {
      onVisualFiltersChange(
        visualFilters.map((filter, rowIndex) =>
          rowIndex === index ? { ...filter, ...patch } : filter
        )
      );
    },
    [onVisualFiltersChange, visualFilters]
  );

  const addFilter = useCallback(() => {
    const firstColumn = String(columns[0]?.id || columns[0]?.title || "");
    onVisualFiltersChange([
      ...visualFilters,
      { column: firstColumn, operator: "equals", value: "", logic: "AND" },
    ]);
  }, [columns, onVisualFiltersChange, visualFilters]);

  const removeFilter = useCallback(
    (index: number) => {
      onVisualFiltersChange(
        visualFilters.filter((_filter, rowIndex) => rowIndex !== index)
      );
    },
    [onVisualFiltersChange, visualFilters]
  );

  if (mode === "sql") {
    return (
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-1.5">
        <button
          type="button"
          className={filterButtonClass}
          onClick={() => onModeChange("visual")}
          title="Use column filters"
        >
          <Code2 size={12} />
          WHERE
        </button>
        <WhereCompletionInput
          value={sqlFilter}
          columns={columns}
          onChange={onSqlFilterChange}
          onApply={onSearch}
          connectionId={connectionId}
          driver={driver}
          capabilities={capabilities}
          tabId={tabId}
          databaseName={databaseName}
          schemaName={schemaName}
          tableName={tableName}
          historyRevision={whereHistoryRevision}
        />
        {sqlFilter && (
          <button
            type="button"
            className={filterButtonClass}
            onClick={() => onSqlFilterChange("")}
            title="Clear condition"
            aria-label="Clear SQL condition"
          >
            <X size={12} />
          </button>
        )}
        <button
          type="button"
          className={filterButtonClass}
          onClick={applySqlFilter}
          title="Apply WHERE condition"
        >
          <Search size={12} />
          Apply
        </button>
        <div
          className="mx-0.5 h-4 w-px shrink-0 bg-[hsl(var(--wb-border-subtle))]"
          aria-hidden="true"
        />
        <div className="flex shrink-0 items-center gap-1" aria-label="Table sort">
          <ArrowUpDown size={12} className="wb-muted" aria-hidden="true" />
          <span className="text-[10px] wb-muted">SORT</span>
          <Select
            value={sortColumn || "__none__"}
            onValueChange={(column) => {
              if (column === "__none__") {
                onSortChange?.(null, null);
                return;
              }
              onSortChange?.(column, sortDirection || "asc");
            }}
          >
            <SelectTrigger
              aria-label="Sort column"
              className="h-6 w-[118px] border-transparent bg-transparent px-1.5 text-[11px] hover:bg-[hsl(var(--wb-hover))]"
            >
              <SelectValue placeholder="Column" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">No sort</SelectItem>
              {columns.map((column) => {
                const id = String(column.id || column.title);
                return (
                  <SelectItem key={id} value={id}>
                    {column.title}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          {sortColumn && (
            <Select
              value={sortDirection || "asc"}
              onValueChange={(direction) =>
                onSortChange?.(
                  sortColumn,
                  direction as "asc" | "desc",
                )
              }
            >
              <SelectTrigger
                aria-label="Sort direction"
                className="h-6 w-[68px] border-transparent bg-transparent px-1.5 text-[11px] hover:bg-[hsl(var(--wb-hover))]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="asc">ASC</SelectItem>
                <SelectItem value="desc">DESC</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-1.5 py-1">
      <div className="space-y-1">
        {visualFilters.map((filter, index) => (
          <div key={index} className="flex h-6 min-w-0 items-center gap-1">
            {index === 0 ? (
              <button
                type="button"
                className={filterButtonClass}
                onClick={() => onModeChange("sql")}
                title="Write a SQL WHERE condition"
              >
                <Filter size={12} />
                WHERE
              </button>
            ) : (
              <button
                type="button"
                className={`${filterButtonClass} w-[52px] font-mono`}
                onClick={() =>
                  updateFilter(index, {
                    logic: filter.logic === "OR" ? "AND" : "OR",
                  })
                }
                title="Toggle AND / OR"
              >
                {filter.logic || "AND"}
              </button>
            )}

            <FilterColumnSelect
              columns={columns}
              value={filter.column}
              onValueChange={(column) => updateFilter(index, { column })}
            />

            <Select
              value={filter.operator}
              onValueChange={(operator) =>
                updateFilter(index, { operator: operator as FilterOperator })
              }
            >
              <SelectTrigger className="h-6 w-[104px] shrink-0 border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] px-2 text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(operatorLabels).map(([operator, label]) => (
                  <SelectItem key={operator} value={operator}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Input
              value={filter.value}
              onChange={(event) =>
                updateFilter(index, { value: event.target.value })
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") onSearch?.();
              }}
              placeholder="Value"
              aria-label={`Filter value for ${filter.column}`}
              className="h-6 min-w-[120px] flex-1 border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] px-2 text-[11px] focus-visible:ring-0"
            />

            {index === 0 ? (
              <>
                <button
                  type="button"
                  className={filterButtonClass}
                  onClick={addFilter}
                  title="Add condition"
                  aria-label="Add filter condition"
                >
                  <Plus size={12} />
                </button>
                <button
                  type="button"
                  className={filterButtonClass}
                  onClick={onSearch}
                  title="Apply filters"
                >
                  <Search size={12} />
                  Apply
                </button>
              </>
            ) : (
              <button
                type="button"
                className={filterButtonClass}
                onClick={() => removeFilter(index)}
                title="Remove condition"
                aria-label="Remove filter condition"
              >
                <X size={12} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
