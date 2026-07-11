import { ConnectionForm } from "@/components/connection/ConnectionForm";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DataSourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DataSourceDialog({
  open,
  onOpenChange,
}: DataSourceDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(680px,calc(100vh-40px))] w-[min(920px,calc(100vw-40px))] max-w-none flex-col gap-0 overflow-hidden rounded-[7px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] p-0 text-[hsl(var(--wb-text))] shadow-[0_24px_72px_rgba(0,0,0,0.52)]">
        <DialogHeader className="flex h-9 shrink-0 items-center justify-center border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-10">
          <DialogTitle className="text-[12px] font-semibold">
            Data Sources and Drivers
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1">
          <ConnectionForm
            onConnected={() => onOpenChange(false)}
            onCancel={() => onOpenChange(false)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
