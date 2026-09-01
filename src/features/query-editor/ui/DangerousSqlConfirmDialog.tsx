import { AlertTriangle } from "lucide-react";
import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type DangerousSqlConfirmDialogProps = {
  open: boolean;
  message: string;
  onDecision: (approved: boolean) => void;
  onCloseAutoFocus?: ComponentProps<typeof DialogContent>["onCloseAutoFocus"];
};

/**
 * Application-owned confirmation for destructive SQL. Unlike window.confirm,
 * this keeps the editor responsive to the desktop focus lifecycle and lets a
 * caller restore Monaco focus only after the dialog has actually closed.
 */
export function DangerousSqlConfirmDialog({
  open,
  message,
  onDecision,
  onCloseAutoFocus,
}: DangerousSqlConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onDecision(false);
      }}
    >
      <DialogContent
        className="max-w-md border-destructive/45"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-5" aria-hidden="true" />
            Confirm destructive SQL
          </DialogTitle>
          <DialogDescription className="leading-6">
            {message}
          </DialogDescription>
        </DialogHeader>
        <p className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs leading-5 text-muted-foreground">
          This action can modify or permanently remove database data. Review the
          statement in the editor before continuing.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onDecision(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => onDecision(true)}>
            Execute SQL
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
