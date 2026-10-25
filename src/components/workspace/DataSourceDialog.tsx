import { useState } from "react";
import { FileUp, Loader2 } from "lucide-react";
import { ConnectionForm } from "@/components/connection/ConnectionForm";
import { ConnectionImportDialog } from "@/components/connection/ConnectionImportDialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  detectConnectionImportSource,
  parseConnectionImport,
  type ConnectionImportParseResult,
} from "@/features/connection-import";
import { connectionService } from "@/services/tauri";

interface DataSourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DataSourceDialog({
  open,
  onOpenChange,
}: DataSourceDialogProps) {
  const [importPreview, setImportPreview] = useState<{
    fileName: string;
    result: ConnectionImportParseResult;
  } | null>(null);
  const [isPickingImport, setIsPickingImport] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const chooseImportFile = async () => {
    setIsPickingImport(true);
    setImportError(null);
    try {
      const selected = await connectionService.importConnectionConfigFile();
      if (!selected) return;
      const source = detectConnectionImportSource(
        selected.fileName,
        selected.content,
      );
      setImportPreview({
        fileName: selected.fileName,
        result: parseConnectionImport(source, selected.content),
      });
    } catch (reason) {
      setImportError(
        reason instanceof Error ? reason.message : "Could not read the selected configuration.",
      );
    } finally {
      setIsPickingImport(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent layout="custom" className="flex h-[min(680px,calc(100vh-40px))] w-[min(920px,calc(100vw-40px))] max-w-none flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="relative flex h-9 shrink-0 items-center justify-center border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-10">
          <DialogTitle className="text-[12px] font-semibold">
            Data Sources and Drivers
          </DialogTitle>
          <button
            type="button"
            className="wb-icon-button absolute right-9 top-1/2 h-7 w-7 -translate-y-1/2"
            title="Import connection configuration"
            aria-label="Import connection configuration"
            disabled={isPickingImport}
            onClick={() => void chooseImportFile()}
          >
            {isPickingImport ? <Loader2 size={14} className="animate-spin" /> : <FileUp size={14} />}
          </button>
        </DialogHeader>
        {importError && (
          <p role="alert" className="border-b border-red-500/25 bg-red-500/10 px-4 py-2 text-[10px] text-red-200">
            {importError}
          </p>
        )}
        <div className="min-h-0 flex-1">
          <ConnectionForm
            onConnected={() => onOpenChange(false)}
            onCancel={() => onOpenChange(false)}
          />
        </div>
      </DialogContent>
      <ConnectionImportDialog
        open={Boolean(importPreview)}
        fileName={importPreview?.fileName || ""}
        result={importPreview?.result || null}
        onClose={() => setImportPreview(null)}
        onImported={() => setImportPreview(null)}
      />
    </Dialog>
  );
}
