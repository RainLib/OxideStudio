import type { TabData } from "@/features/workspace-tabs/model/types";
import { tableService } from "@/services/tauri";
import type { TableExportReport } from "@/services/tauri/types";
import { useEffect, useState } from "react";

interface TableExportReportOptions {
  activeProjectId: string;
  tabConnectionId: string | null;
  activeTab: TabData | undefined;
}

export function useTableExportReport({
  activeProjectId,
  tabConnectionId,
  activeTab,
}: TableExportReportOptions) {
  const [recentExportReport, setRecentExportReport] =
    useState<TableExportReport | null>(null);

  useEffect(() => {
    let active = true;
    if (
      !activeProjectId ||
      !tabConnectionId ||
      !activeTab?.schemaName ||
      !activeTab.tableName ||
      typeof tableService.listTableExportReports !== "function"
    ) {
      setRecentExportReport(null);
      return () => {
        active = false;
      };
    }
    void tableService
      .listTableExportReports(activeProjectId, tabConnectionId, 20)
      .then((reports) => {
        if (!active) return;
        setRecentExportReport(
          reports.find(
            (report) =>
              report.schema === activeTab.schemaName &&
              report.table === activeTab.tableName,
          ) || null,
        );
      })
      .catch(() => {
        if (active) setRecentExportReport(null);
      });
    return () => {
      active = false;
    };
  }, [
    activeProjectId,
    activeTab?.schemaName,
    activeTab?.tableName,
    tabConnectionId,
  ]);

  return { recentExportReport, setRecentExportReport };
}
