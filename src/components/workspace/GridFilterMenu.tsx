import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Filter, X } from "lucide-react";
import { FilterState } from "@/lib/gridUtils";

interface GridFilterMenuProps {
  column: string;
  filter?: FilterState;
  onFilterChange: (filter: FilterState | undefined) => void;
}

export function GridFilterMenu({
  column,
  filter,
  onFilterChange,
}: GridFilterMenuProps) {
  const [operator, setOperator] = useState<FilterState["operator"]>(
    filter?.operator || "contains"
  );
  const [value, setValue] = useState(filter?.value || "");

  const handleApply = () => {
    if (value) {
      onFilterChange({ operator, value });
    } else {
      onFilterChange(undefined);
    }
  };

  const handleClear = () => {
    setValue("");
    setOperator("contains");
    onFilterChange(undefined);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`h-5 w-5 p-0 ${
            filter
              ? "text-orange-500 hover:text-orange-400"
              : "text-gray-600 hover:text-gray-400"
          }`}
        >
          <Filter size={12} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-64 bg-[#2a2a2a] border-[#3a3a3a] text-gray-200"
      >
        <div className="p-2 space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">
            Filter: {column}
          </div>

          <select
            value={operator}
            onChange={(e) =>
              setOperator(e.target.value as FilterState["operator"])
            }
            className="w-full h-8 bg-[#1a1a1a] border border-[#444] rounded text-xs px-2 text-gray-300 focus:outline-none focus:border-orange-500/50"
          >
            <option value="contains">Contains</option>
            <option value="equals">Equals</option>
            <option value="startsWith">Starts with</option>
            <option value="endsWith">Ends with</option>
            <option value="gt">Greater than</option>
            <option value="lt">Less than</option>
          </select>

          <Input
            placeholder="Filter value..."
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleApply();
              if (e.key === "Escape") handleClear();
            }}
            className="h-8 bg-[#1a1a1a] border-[#444] text-xs focus-visible:ring-1 focus-visible:ring-orange-500/50"
          />

          <DropdownMenuSeparator className="bg-[#3a3a3a]" />

          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={handleClear}
              className="flex-1 h-7 text-xs text-gray-400 hover:text-white hover:bg-[#333]"
            >
              <X size={12} className="mr-1" />
              Clear
            </Button>
            <Button
              size="sm"
              onClick={handleApply}
              className="flex-1 h-7 text-xs bg-orange-600 hover:bg-orange-700 text-white"
            >
              Apply
            </Button>
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
