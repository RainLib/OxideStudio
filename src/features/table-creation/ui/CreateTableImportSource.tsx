import { Button } from "@/components/ui/button";
import type { TableImportSource } from "@/features/table-creation/model/types";
import { FileUp, Loader2, X } from "lucide-react";

interface CreateTableImportSourceProps {
  importSource: TableImportSource | null;
  isSubmitting: boolean;
  isInferringImport: boolean;
  onClear: () => void;
  onChoose: () => void;
}

export function CreateTableImportSource({
  importSource,
  isSubmitting,
  isInferringImport,
  onClear,
  onChoose,
}: CreateTableImportSourceProps) {
  return (
    <section className="rounded-[6px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))] p-3">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-accent))]">
          <FileUp size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium">Create from import file</div>
          <div className="truncate text-[11px] wb-muted">
            {importSource
              ? `${importSource.filePath.split(/[\\/]/).pop()} · ${importSource.totalRows.toLocaleString()} reviewed rows · edit the inferred columns before creating`
              : "Infer editable columns from CSV, JSON, or XLSX; creation is followed by a checked native import."}
          </div>
        </div>
        {importSource && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground"
            onClick={onClear}
            disabled={isSubmitting || isInferringImport}
            title="Use manual columns only"
          >
            <X size={14} />
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={onChoose}
          disabled={isSubmitting || isInferringImport}
          className="h-8 shrink-0 text-xs"
        >
          {isInferringImport ? <Loader2 size={13} className="mr-1.5 animate-spin" /> : <FileUp size={13} className="mr-1.5" />}
          {importSource ? "Replace file" : "Choose file"}
        </Button>
      </div>
    </section>
  );
}
