import { tableService } from "@/services/tauri";
import type { WorkbenchTask } from "@/store/useTaskStore";
import { useEffect, useRef } from "react";

interface TableTransferProgressOptions {
  updateTask: (
    id: string,
    updates: Partial<Pick<WorkbenchTask, "title" | "detail" | "progress">>,
  ) => void;
}

export function useTableTransferProgress({
  updateTask,
}: TableTransferProgressOptions) {
  const activeTableExportRef = useRef<{
    exportId: string;
    taskId: string;
  } | null>(null);
  const activeTableImportsRef = useRef(new Map<string, string>());

  useEffect(() => {
    if (typeof tableService.listenTableExportProgress !== "function") {
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void tableService
      .listenTableExportProgress((progress) => {
        const activeExport = activeTableExportRef.current;
        if (!activeExport || activeExport.exportId !== progress.exportId)
          return;
        const progressDetail = `${progress.rowsExported.toLocaleString()} rows in ${progress.batches.toLocaleString()} batches`;
        updateTask(activeExport.taskId, {
          detail: progress.message
            ? `${progressDetail} · ${progress.message}`
            : progressDetail,
        });
      })
      .then((stopListening) => {
        if (disposed) stopListening();
        else unlisten = stopListening;
      })
      .catch((error) => {
        console.error("Failed to listen for table export progress:", error);
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [updateTask]);

  useEffect(() => {
    if (typeof tableService.listenTableImportProgress !== "function") return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void tableService
      .listenTableImportProgress((progress) => {
        const taskId = activeTableImportsRef.current.get(progress.importId);
        if (!taskId) return;
        const count = `${progress.rowsImported.toLocaleString()} rows in ${progress.batches.toLocaleString()} batches`;
        const total =
          progress.totalRows != null
            ? ` / ${progress.totalRows.toLocaleString()} total`
            : "";
        updateTask(taskId, {
          detail: progress.message
            ? `${count}${total} · ${progress.message}`
            : `${count}${total}`,
        });
      })
      .then((stopListening) => {
        if (disposed) stopListening();
        else unlisten = stopListening;
      })
      .catch((error) => {
        console.error("Failed to listen for table import progress:", error);
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [updateTask]);

  return { activeTableExportRef, activeTableImportsRef };
}
