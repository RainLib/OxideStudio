import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type {
  SqlLibraryDeleteTarget,
  SqlLibraryEditDialog,
} from "@/features/saved-sql/ui/sqlLibraryPanelTypes";
import type { FormEvent } from "react";

interface SqlLibraryPanelDialogsProps {
  dialog: SqlLibraryEditDialog | null;
  dialogName: string;
  deleteTarget: SqlLibraryDeleteTarget | null;
  error: string | null;
  isMutating: boolean;
  onDialogOpenChange: (open: boolean) => void;
  onDialogNameChange: (name: string) => void;
  onDialogSubmit: (event: FormEvent) => void;
  onDeleteOpenChange: (open: boolean) => void;
  onConfirmDelete: () => void;
}

export function SqlLibraryPanelDialogs({
  dialog,
  dialogName,
  deleteTarget,
  error,
  isMutating,
  onDialogOpenChange,
  onDialogNameChange,
  onDialogSubmit,
  onDeleteOpenChange,
  onConfirmDelete,
}: SqlLibraryPanelDialogsProps) {
  return (
    <>
      <Dialog open={Boolean(dialog)} onOpenChange={onDialogOpenChange}>
        <DialogContent className="w-[420px] max-w-[calc(100vw-32px)] rounded-[6px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-text))]">
          <form onSubmit={onDialogSubmit}>
            <DialogHeader>
              <DialogTitle className="text-[13px]">
                {dialog?.mode === "folder"
                  ? "Create folder"
                  : dialog?.mode === "query"
                    ? "Create saved query"
                    : "Rename SQL Library item"}
              </DialogTitle>
              <DialogDescription className="text-[10px] leading-5">
                This item is stored in the current project&apos;s private SQL Library, not on disk.
              </DialogDescription>
            </DialogHeader>
            <Input
              autoFocus
              value={dialogName}
              onChange={(event) => onDialogNameChange(event.target.value)}
              className="wb-field mt-3"
              aria-label="SQL Library item name"
            />
            {error && <div className="mt-2 text-[10px] text-red-300">{error}</div>}
            <DialogFooter className="mt-4">
              <Button type="button" variant="ghost" size="sm" onClick={() => onDialogOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" className="wb-primary-button" disabled={isMutating}>
                {dialog?.mode?.startsWith("rename") ? "Rename" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={onDeleteOpenChange}>
        <DialogContent className="w-[420px] max-w-[calc(100vw-32px)] rounded-[6px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-text))]">
          <DialogHeader>
            <DialogTitle className="text-[13px]">Delete {deleteTarget?.item.name}?</DialogTitle>
            <DialogDescription className="text-[10px] leading-5">
              {deleteTarget?.kind === "folder"
                ? "The folder, nested folders, and saved queries inside it will be permanently deleted."
                : "The saved query will be permanently deleted."}
            </DialogDescription>
          </DialogHeader>
          {error && <div className="text-[10px] text-red-300">{error}</div>}
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => onDeleteOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" size="sm" disabled={isMutating} onClick={onConfirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
