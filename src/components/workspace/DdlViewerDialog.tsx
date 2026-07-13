import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Copy } from "lucide-react";
import { useState } from "react";

interface DdlViewerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  tableName: string;
  ddl: string;
}

export function DdlViewerDialog({
  isOpen,
  onClose,
  tableName,
  ddl,
}: DdlViewerDialogProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(ddl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>DDL: {tableName}</DialogTitle>
        </DialogHeader>
        <div
          className="group relative flex-1 overflow-auto rounded-md bg-muted p-4 font-mono text-xs whitespace-pre-wrap"
          data-text-selectable="true"
        >
          {ddl}
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-background/50 hover:bg-background"
            onClick={handleCopy}
            title="Copy to clipboard"
          >
            <Copy size={16} />
          </Button>
        </div>
        {copied && (
          <div className="text-xs text-green-500 text-right">Copied!</div>
        )}
      </DialogContent>
    </Dialog>
  );
}
