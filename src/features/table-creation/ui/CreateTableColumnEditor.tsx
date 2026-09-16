import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  CreateTableColumn,
  CreateTableColumnDragState,
} from "@/features/table-creation/model/types";
import { supportsAutoIncrementForDataType } from "@/lib/databaseDialect";
import type { DatabaseCapabilities } from "@/services/tauri";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import type { MouseEvent } from "react";

interface CreateTableColumnEditorProps {
  columns: readonly CreateTableColumn[];
  typeOptions: readonly string[];
  capabilities: DatabaseCapabilities;
  dragState: CreateTableColumnDragState;
  onAddColumn: () => void;
  onRemoveColumn: (index: number) => void;
  onUpdateColumn: (
    index: number,
    field: keyof CreateTableColumn,
    value: string | boolean,
  ) => void;
  onDragStart: (event: MouseEvent, index: number) => void;
  onDragEnter: (index: number) => void;
  onDragEnd: () => void;
}

export function CreateTableColumnEditor({
  columns,
  typeOptions,
  capabilities,
  dragState,
  onAddColumn,
  onRemoveColumn,
  onUpdateColumn,
  onDragStart,
  onDragEnter,
  onDragEnd,
}: CreateTableColumnEditorProps) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-muted-foreground">
        Columns
      </label>

      <div className="space-y-2">
        {columns.map((column, index) => {
          const autoIncrementSupported = supportsAutoIncrementForDataType(
            capabilities,
            column.type,
          );
          return (
            <div
              key={index}
              onMouseEnter={() => onDragEnter(index)}
              onMouseUp={onDragEnd}
              className={`flex items-start gap-2 rounded-[5px] border bg-[hsl(var(--wb-panel))] p-3 transition-all ${
                dragState.isDragging && dragState.dragIndex === index
                  ? "opacity-50 border-primary/50"
                  : dragState.isDragging && dragState.hoverIndex === index
                    ? "border-primary border-dashed"
                    : "border-[hsl(var(--wb-border-subtle))]"
              }`}
            >
              <div
                onMouseDown={(event) => onDragStart(event, index)}
                className="h-8 w-6 flex items-center justify-center cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0 select-none"
                title="Drag to reorder"
              >
                <GripVertical size={14} />
              </div>
              <div className="flex-1 grid grid-cols-12 gap-2 items-center">
                <div className="col-span-3">
                  <Input
                    value={column.name}
                    onChange={(event) => onUpdateColumn(index, "name", event.target.value)}
                    placeholder="Column name"
                    className="h-8 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-input))] text-xs"
                  />
                </div>
                <div className="col-span-2">
                  <Select
                    value={column.type}
                    onValueChange={(value) => onUpdateColumn(index, "type", value)}
                  >
                    <SelectTrigger className="h-8 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-input))] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {typeOptions.map((type) => (
                        <SelectItem key={type} value={type} className="text-xs">
                          {type}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Input
                    value={column.length}
                    onChange={(event) => onUpdateColumn(index, "length", event.target.value)}
                    placeholder="Length"
                    className="h-8 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-input))] text-xs"
                  />
                </div>
                <div className="col-span-2">
                  <Input
                    value={column.comment || ""}
                    onChange={(event) => onUpdateColumn(index, "comment", event.target.value)}
                    placeholder="Comment"
                    className="h-8 border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-input))] text-xs"
                  />
                </div>
                <div className="col-span-3 flex items-center gap-2 px-2 h-8">
                  <div className="flex items-center gap-1.5">
                    <Checkbox
                      id={`pk-${index}`}
                      checked={column.isPrimaryKey}
                      onCheckedChange={(checked) => onUpdateColumn(index, "isPrimaryKey", !!checked)}
                    />
                    <label
                      htmlFor={`pk-${index}`}
                      className="text-xs cursor-pointer"
                      title="Primary Key"
                    >
                      PK
                    </label>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Checkbox
                      id={`nn-${index}`}
                      checked={column.isNotNull}
                      onCheckedChange={(checked) => onUpdateColumn(index, "isNotNull", !!checked)}
                    />
                    <label
                      htmlFor={`nn-${index}`}
                      className="text-xs cursor-pointer"
                      title="Not Null"
                    >
                      NN
                    </label>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Checkbox
                      id={`ai-${index}`}
                      checked={column.isAutoIncrement}
                      disabled={!autoIncrementSupported}
                      onCheckedChange={(checked) => onUpdateColumn(index, "isAutoIncrement", !!checked)}
                    />
                    <label
                      htmlFor={`ai-${index}`}
                      className={`text-xs ${
                        autoIncrementSupported
                          ? "cursor-pointer"
                          : "cursor-not-allowed opacity-50"
                      }`}
                      title={
                        autoIncrementSupported
                          ? "Auto Increment"
                          : "Auto increment requires an integer-compatible type"
                      }
                    >
                      AI
                    </label>
                  </div>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                onClick={() => onRemoveColumn(index)}
                disabled={columns.length === 1}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          );
        })}
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={onAddColumn}
        className="border-dashed border-[hsl(var(--wb-border))] hover:bg-[hsl(var(--wb-hover))]"
      >
        <Plus size={14} className="mr-2" /> Add Column
      </Button>
    </div>
  );
}
