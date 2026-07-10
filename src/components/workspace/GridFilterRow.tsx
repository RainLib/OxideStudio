import React, { useCallback, useEffect } from "react";
import { GridColumn } from "@glideapps/glide-data-grid";
import { Plus, Code, Table, Search, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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

export const GridFilterRow: React.FC<GridFilterRowProps> = ({
  columns,
  mode,
  visualFilters,
  sqlFilter,
  onModeChange,
  onVisualFiltersChange,
  onSqlFilterChange,
  onSearch,
}) => {
  // Ensure we always have at least one filter in visual mode, and that it has a valid column
  useEffect(() => {
    if (mode === "visual") {
      // 1. If we have no filters, and we have columns, add the first one default
      if (visualFilters.length === 0 && columns.length > 0) {
        const firstColumn = columns[0]?.id || columns[0]?.title || "";
        onVisualFiltersChange([
          {
            column: firstColumn,
            operator: "equals",
            value: "",
            logic: undefined,
          },
        ]);
        return;
      }

      // 2. If existing filters have empty columns, but we have columns available, populate them
      if (visualFilters.length > 0 && columns.length > 0) {
        const firstColumn = columns[0]?.id || columns[0]?.title || "";
        const needsUpdate = visualFilters.some((f) => !f.column);

        if (needsUpdate) {
          const updated = visualFilters.map((f) => {
            if (!f.column) {
              return { ...f, column: firstColumn };
            }
            return f;
          });
          onVisualFiltersChange(updated);
        }
      }
    }
  }, [mode, visualFilters, columns, onVisualFiltersChange]);

  const handleAddFilter = useCallback(() => {
    const firstColumn = columns[0]?.id || columns[0]?.title || "";
    const newFilter: ColumnFilter = {
      column: firstColumn,
      operator: "equals",
      value: "",
      logic: "AND",
    };
    onVisualFiltersChange([...visualFilters, newFilter]);
  }, [columns, visualFilters, onVisualFiltersChange]);

  const handleRemoveFilter = useCallback(
    (index: number) => {
      // Don't allow removing the first filter
      if (index === 0) return;
      const updated = visualFilters.filter((_, i) => i !== index);
      onVisualFiltersChange(updated);
    },
    [visualFilters, onVisualFiltersChange]
  );

  const handleToggleLogic = useCallback(
    (index: number) => {
      // First filter logic cannot be toggled
      if (index === 0) return;

      const updated = [...visualFilters];
      const current = updated[index];
      if (current) {
        updated[index] = {
          ...current,
          logic: current.logic === "AND" ? "OR" : "AND",
        };
      }
      onVisualFiltersChange(updated);
    },
    [visualFilters, onVisualFiltersChange]
  );

  const handleColumnChange = useCallback(
    (index: number, column: string) => {
      const updated = [...visualFilters];
      const current = updated[index];
      if (current) {
        updated[index] = {
          ...current,
          column,
        };
      }
      onVisualFiltersChange(updated);
    },
    [visualFilters, onVisualFiltersChange]
  );

  const handleOperatorChange = useCallback(
    (index: number, operator: FilterOperator) => {
      const updated = [...visualFilters];
      const current = updated[index];
      if (current) {
        updated[index] = {
          ...current,
          operator,
        };
      }
      onVisualFiltersChange(updated);
    },
    [visualFilters, onVisualFiltersChange]
  );

  const handleValueChange = useCallback(
    (index: number, value: string) => {
      const updated = [...visualFilters];
      const current = updated[index];
      if (current) {
        updated[index] = {
          ...current,
          value,
        };
      }
      onVisualFiltersChange(updated);
    },
    [visualFilters, onVisualFiltersChange]
  );

  return (
    <div className="border-b wb-data-toolbar px-2 py-2">
      <div className="flex flex-col gap-2">
        {/* Row 1: Mode/Logic + Filter Inputs */}
        {mode === "sql" ? (
          <div className="flex items-center gap-2">
            <div className="w-[48px] shrink-0">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onModeChange("visual")}
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                title="Switch to Visual mode"
              >
                <Code size={16} />
              </Button>
            </div>
            <Input
              type="text"
              placeholder="WHERE clause (e.g. id > 10)"
              value={sqlFilter}
              onChange={(e) => onSqlFilterChange(e.target.value)}
              className="h-7 flex-1 text-xs font-mono bg-[hsl(var(--wb-editor))] border-[hsl(var(--wb-border))]"
            />
            <Button
              variant="default"
              size="icon"
              onClick={onSearch}
              className="h-7 w-7 bg-primary text-primary-foreground hover:bg-primary/90"
              title="Search"
            >
              <Search size={14} />
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {visualFilters.map((filter, index) => {
              const isFirst = index === 0;
              return (
                <div key={index} className="flex items-center gap-2">
                  {/* Left Column: Mode Toggle (Row 0) or Logic Toggle (Row > 0) */}
                  <div className="w-[48px] shrink-0 flex items-center justify-start">
                    {isFirst ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onModeChange("sql")}
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        title="Switch to SQL mode"
                      >
                        <Table size={16} />
                      </Button>
                    ) : (
                      <button
                        onClick={() => handleToggleLogic(index)}
                        className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded-[3px] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-text-muted))] hover:text-[hsl(var(--wb-text))] hover:bg-[hsl(var(--wb-hover))] border border-[hsl(var(--wb-border))] uppercase w-8 text-center transition-colors"
                      >
                        {filter.logic || "AND"}
                      </button>
                    )}
                  </div>

                  {/* Filter Inputs Group */}
                  <div className="flex-1 flex items-center gap-2 rounded-[4px] border border-transparent bg-[hsl(var(--wb-editor)/0.42)] p-1 transition-colors hover:border-[hsl(var(--wb-border))]">
                    <div className="min-w-[120px]">
                      <Select
                        value={filter.column}
                        onValueChange={(val) => handleColumnChange(index, val)}
                      >
                        <SelectTrigger className="h-7 text-xs bg-[hsl(var(--wb-editor))] border-[hsl(var(--wb-border))] px-2">
                          <SelectValue placeholder="Column" />
                        </SelectTrigger>
                        <SelectContent>
                          {columns.map((col) => {
                            const colId = col.id || col.title;
                            return (
                              <SelectItem key={colId} value={colId}>
                                {col.title}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="w-[100px]">
                      <Select
                        value={filter.operator}
                        onValueChange={(val) =>
                          handleOperatorChange(index, val as FilterOperator)
                        }
                      >
                        <SelectTrigger className="h-7 text-xs bg-[hsl(var(--wb-editor))] border-[hsl(var(--wb-border))] px-2">
                          <SelectValue placeholder="Op" />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(operatorLabels).map(([op, label]) => (
                            <SelectItem key={op} value={op}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <Input
                      type="text"
                      placeholder="Value"
                      value={filter.value}
                      onChange={(e) => handleValueChange(index, e.target.value)}
                      className="h-7 flex-1 text-xs bg-[hsl(var(--wb-editor))] border-[hsl(var(--wb-border))] text-[hsl(var(--wb-text))] placeholder:text-[hsl(var(--wb-text-muted))] min-w-[100px]"
                    />

                    {/* Right Action: Delete (if >0) OR Add+Search (if 0) */}
                    {isFirst ? (
                      <div className="flex items-center gap-1 ml-1">
                        <Button
                          variant="secondary"
                          size="icon"
                          onClick={handleAddFilter}
                          className="h-7 w-7"
                          title="Add Filter"
                        >
                          <Plus size={14} />
                        </Button>
                        <Button
                          variant="default"
                          size="icon"
                          onClick={onSearch}
                          className="h-7 w-7 bg-primary text-primary-foreground hover:bg-primary/90"
                          title="Search"
                        >
                          <Search size={14} />
                        </Button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleRemoveFilter(index)}
                        className="h-7 w-7 flex items-center justify-center text-[hsl(var(--wb-text-muted))] hover:text-red-400 hover:bg-[hsl(var(--wb-hover))] rounded transition-colors ml-1"
                        title="Remove filter"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
