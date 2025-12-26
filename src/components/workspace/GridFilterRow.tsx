import React, { useCallback } from "react";
import { GridColumn } from "@glideapps/glide-data-grid";
import { X, Plus, Code, Table } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

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
}

const operatorLabels: Record<FilterOperator, string> = {
  equals: "equals",
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
}) => {
  const handleAddFilter = useCallback(() => {
    const firstColumn = columns[0]?.id || columns[0]?.title || "";
    const newFilter: ColumnFilter = {
      column: firstColumn,
      operator: "equals",
      value: "",
      logic: visualFilters.length > 0 ? "AND" : undefined,
    };
    onVisualFiltersChange([...visualFilters, newFilter]);
  }, [columns, visualFilters, onVisualFiltersChange]);

  const handleRemoveFilter = useCallback(
    (index: number) => {
      const updated = visualFilters.filter((_, i) => i !== index);
      // Remove logic from first item if it exists
      if (updated.length > 0 && updated[0]?.logic) {
        const first = updated[0];
        updated[0] = {
          column: first.column,
          operator: first.operator,
          value: first.value,
          logic: undefined,
        };
      }
      onVisualFiltersChange(updated);
    },
    [visualFilters, onVisualFiltersChange]
  );

  const handleToggleLogic = useCallback(
    (index: number) => {
      const updated = [...visualFilters];
      const current = updated[index];
      if (current) {
        updated[index] = {
          column: current.column,
          operator: current.operator,
          value: current.value,
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
          column,
          operator: current.operator,
          value: current.value,
          logic: current.logic,
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
          column: current.column,
          operator,
          value: current.value,
          logic: current.logic,
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
          column: current.column,
          operator: current.operator,
          value,
          logic: current.logic,
        };
      }
      onVisualFiltersChange(updated);
    },
    [visualFilters, onVisualFiltersChange]
  );

  return (
    <div className="border-b border-[#2a2a2a] bg-[#0a0a0a] px-2 py-1.5">
      <div className="flex items-center gap-2">
        {/* Mode Toggle Button */}
        <button
          onClick={() => onModeChange(mode === "visual" ? "sql" : "visual")}
          className="h-6 w-6 flex items-center justify-center text-gray-500 hover:text-gray-300 hover:bg-[#1a1a1a] rounded transition-colors"
          title={
            mode === "visual" ? "Switch to SQL mode" : "Switch to Visual mode"
          }
        >
          {mode === "visual" ? <Code size={14} /> : <Table size={14} />}
        </button>

        {/* SQL Mode */}
        {mode === "sql" ? (
          <Input
            type="text"
            placeholder="WHERE clause (e.g., id > 10 AND name LIKE '%test%')"
            value={sqlFilter}
            onChange={(e) => onSqlFilterChange(e.target.value)}
            className="h-6 flex-1 text-xs bg-[#1a1a1a] border-[#2a2a2a] text-gray-300 placeholder:text-gray-600 focus-visible:ring-1 focus-visible:ring-orange-500 focus-visible:border-orange-500"
          />
        ) : (
          /* Visual Mode */
          <div className="flex-1 flex flex-col gap-1">
            {visualFilters.map((filter, index) => (
              <div key={index} className="flex items-center gap-1.5">
                {/* AND/OR Toggle */}
                {filter.logic && (
                  <button
                    onClick={() => handleToggleLogic(index)}
                    className="px-1.5 h-6 text-[10px] font-mono bg-black text-white border border-[#333] hover:bg-[#1a1a1a] rounded uppercase"
                  >
                    {filter.logic}
                  </button>
                )}

                {/* Column Selector */}
                <select
                  value={filter.column}
                  onChange={(e) => handleColumnChange(index, e.target.value)}
                  className="h-6 px-1.5 text-[11px] bg-[#1a1a1a] text-gray-300 border border-[#2a2a2a] hover:border-[#3a3a3a] rounded focus:outline-none focus:border-orange-500"
                >
                  {columns.map((col) => {
                    const colId = col.id || col.title;
                    return (
                      <option key={colId} value={colId}>
                        {col.title}
                      </option>
                    );
                  })}
                </select>

                {/* Operator Selector */}
                <select
                  value={filter.operator}
                  onChange={(e) =>
                    handleOperatorChange(
                      index,
                      e.target.value as FilterOperator
                    )
                  }
                  className="h-6 px-1.5 text-[11px] bg-[#1a1a1a] text-gray-300 border border-[#2a2a2a] hover:border-[#3a3a3a] rounded focus:outline-none focus:border-orange-500"
                >
                  {Object.entries(operatorLabels).map(([op, label]) => (
                    <option key={op} value={op}>
                      {label}
                    </option>
                  ))}
                </select>

                {/* Value Input */}
                <Input
                  type="text"
                  placeholder="Enter Value"
                  value={filter.value}
                  onChange={(e) => handleValueChange(index, e.target.value)}
                  className="h-6 flex-1 text-[11px] bg-[#1a1a1a] border-[#2a2a2a] text-gray-300 placeholder:text-gray-600 focus-visible:ring-1 focus-visible:ring-orange-500 focus-visible:border-orange-500"
                />

                {/* Remove Button */}
                <button
                  onClick={() => handleRemoveFilter(index)}
                  className="h-6 w-6 flex items-center justify-center text-gray-500 hover:text-white hover:bg-[#1a1a1a] rounded"
                >
                  <span className="text-sm">−</span>
                </button>
              </div>
            ))}

            {/* Add Filter Button Row */}
            {visualFilters.length === 0 || (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleAddFilter}
                  className="h-6 w-6 flex items-center justify-center text-yellow-500 hover:text-yellow-400 hover:bg-[#1a1a1a] rounded transition-colors"
                  title="Add filter"
                >
                  <Plus size={14} />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Add button for empty state in visual mode */}
        {mode === "visual" && visualFilters.length === 0 && (
          <button
            onClick={handleAddFilter}
            className="h-6 w-6 flex items-center justify-center text-yellow-500 hover:text-yellow-400 hover:bg-[#1a1a1a] rounded transition-colors ml-auto"
            title="Add filter"
          >
            <Plus size={14} />
          </button>
        )}
      </div>
    </div>
  );
};
