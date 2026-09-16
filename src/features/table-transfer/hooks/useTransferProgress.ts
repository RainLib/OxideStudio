import { tableService } from "@/services/tauri";
import type { TableDataTransferProgress } from "@/services/tauri/types";
import { useEffect } from "react";

interface TransferProgressOptions {
  open: boolean;
  transferId: string;
  setProgress: React.Dispatch<
    React.SetStateAction<TableDataTransferProgress | null>
  >;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
}

export function useTransferProgress({
  open,
  transferId,
  setProgress,
  setError,
}: TransferProgressOptions) {
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void tableService
      .listenTableDataTransferProgress((nextProgress) => {
        if (!disposed && nextProgress.transferId === transferId) {
          setProgress(nextProgress);
        }
      })
      .then((nextUnlisten) => {
        if (disposed) nextUnlisten();
        else unlisten = nextUnlisten;
      })
      .catch((nextError) => {
        if (!disposed) {
          setError(
            nextError instanceof Error ? nextError.message : String(nextError),
          );
        }
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [open, transferId]);
}
