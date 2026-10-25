import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ExplorerRemoveDataSourceDialogContext {
  pendingDataSourceRemoval: { id: string; name: string } | null;
  isRemovingDataSource: boolean;
  setPendingDataSourceRemoval: React.Dispatch<
    React.SetStateAction<{ id: string; name: string } | null>
  >;
  setDataSourceRemovalError: React.Dispatch<
    React.SetStateAction<string | null>
  >;
  dataSourceRemovalError: string | null;
  handleRemoveDataSource: () => Promise<void>;
}

export function ExplorerRemoveDataSourceDialog({
  pendingDataSourceRemoval,
  isRemovingDataSource,
  setPendingDataSourceRemoval,
  setDataSourceRemovalError,
  dataSourceRemovalError,
  handleRemoveDataSource,
}: ExplorerRemoveDataSourceDialogContext) {
  return (
    <Dialog
      open={Boolean(pendingDataSourceRemoval)}
      onOpenChange={(open) => {
        if (!open && !isRemovingDataSource) {
          setPendingDataSourceRemoval(null);
          setDataSourceRemovalError(null);
        }
      }}
    >
      <DialogContent className="w-[420px] max-w-[calc(100vw-32px)] gap-4 p-5">
        <DialogHeader>
          <DialogTitle className="text-[15px]">Remove data source?</DialogTitle>
          <DialogDescription className="text-[12px] leading-5 wb-muted">
            Remove <strong>{pendingDataSourceRemoval?.name}</strong> from
            OxideStudio. This deletes the saved connection configuration and
            cached metadata, but does not delete the remote database.
          </DialogDescription>
        </DialogHeader>
        {dataSourceRemovalError && (
          <div className="rounded-[4px] bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
            {dataSourceRemovalError}
          </div>
        )}
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button
            type="button"
            variant="ghost"
            disabled={isRemovingDataSource}
            onClick={() => setPendingDataSourceRemoval(null)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={isRemovingDataSource}
            onClick={() => void handleRemoveDataSource()}
          >
            {isRemovingDataSource ? "Removing..." : "Remove Data Source"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
