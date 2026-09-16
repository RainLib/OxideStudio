import { tableService } from "@/services/tauri";
import type { TableDataTransferReport } from "@/services/tauri/types";
import { useEffect, useState } from "react";

interface TransferReportsOptions {
  open: boolean;
  projectId: string | null | undefined;
  targetConnectionId: string;
}

export function useTransferReports({
  open,
  projectId,
  targetConnectionId,
}: TransferReportsOptions) {
  const [recentReports, setRecentReports] = useState<TableDataTransferReport[]>(
    [],
  );

  useEffect(() => {
    if (!open || !projectId || !targetConnectionId) {
      setRecentReports([]);
      return;
    }
    let active = true;
    void tableService
      .listTableDataTransferReports(projectId, targetConnectionId, 5)
      .then((reports) => {
        if (active) setRecentReports(reports);
      })
      .catch(() => {
        // History is an audit convenience. A transient local-store failure
        // must never make an otherwise valid transfer target unavailable.
        if (active) setRecentReports([]);
      });
    return () => {
      active = false;
    };
  }, [open, projectId, targetConnectionId]);

  return { recentReports };
}
