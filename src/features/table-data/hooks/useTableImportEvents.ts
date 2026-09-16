import type { TabData } from "@/features/workspace-tabs/model/types";
import {
  APP_EVENT_REQUEST_TABLE_CSV_IMPORT,
  APP_EVENT_REQUEST_TABLE_JSON_IMPORT,
  APP_EVENT_REQUEST_TABLE_XLSX_IMPORT,
  type TableCsvImportRequest,
  type TableJsonImportRequest,
  type TableXlsxImportRequest,
} from "@/lib/actionEvents";
import { useEffect } from "react";

interface TableImportEventsOptions {
  tabConnectionId: string | null;
  activeTab: TabData | undefined;
  isTableReadOnly: boolean;
  openCsvImportPicker: () => Promise<void>;
  openXlsxImportPicker: () => Promise<void>;
  openJsonImportPicker: () => Promise<void>;
}

export function useTableImportEvents({
  tabConnectionId,
  activeTab,
  isTableReadOnly,
  openCsvImportPicker,
  openXlsxImportPicker,
  openJsonImportPicker,
}: TableImportEventsOptions) {
  useEffect(() => {
    const requestCsvImport = (event: Event) => {
      const detail = (event as CustomEvent<TableCsvImportRequest>).detail;
      if (
        !detail ||
        detail.connectionId !== tabConnectionId ||
        detail.schema !== activeTab?.schemaName ||
        detail.table !== activeTab?.tableName ||
        detail.database !== activeTab?.databaseName ||
        isTableReadOnly ||
        activeTab?.isExecuting
      ) {
        return;
      }
      void openCsvImportPicker();
    };
    window.addEventListener(
      APP_EVENT_REQUEST_TABLE_CSV_IMPORT,
      requestCsvImport,
    );
    return () =>
      window.removeEventListener(
        APP_EVENT_REQUEST_TABLE_CSV_IMPORT,
        requestCsvImport,
      );
  }, [
    activeTab?.databaseName,
    activeTab?.isExecuting,
    activeTab?.schemaName,
    activeTab?.tableName,
    isTableReadOnly,
    tabConnectionId,
  ]);

  useEffect(() => {
    const requestXlsxImport = (event: Event) => {
      const detail = (event as CustomEvent<TableXlsxImportRequest>).detail;
      if (
        !detail ||
        detail.connectionId !== tabConnectionId ||
        detail.schema !== activeTab?.schemaName ||
        detail.table !== activeTab?.tableName ||
        detail.database !== activeTab?.databaseName ||
        isTableReadOnly ||
        activeTab?.isExecuting
      ) {
        return;
      }
      void openXlsxImportPicker();
    };
    window.addEventListener(
      APP_EVENT_REQUEST_TABLE_XLSX_IMPORT,
      requestXlsxImport,
    );
    return () =>
      window.removeEventListener(
        APP_EVENT_REQUEST_TABLE_XLSX_IMPORT,
        requestXlsxImport,
      );
  }, [
    activeTab?.databaseName,
    activeTab?.isExecuting,
    activeTab?.schemaName,
    activeTab?.tableName,
    isTableReadOnly,
    tabConnectionId,
  ]);

  useEffect(() => {
    const requestJsonImport = (event: Event) => {
      const detail = (event as CustomEvent<TableJsonImportRequest>).detail;
      if (
        !detail ||
        detail.connectionId !== tabConnectionId ||
        detail.schema !== activeTab?.schemaName ||
        detail.table !== activeTab?.tableName ||
        detail.database !== activeTab?.databaseName ||
        isTableReadOnly ||
        activeTab?.isExecuting
      ) {
        return;
      }
      void openJsonImportPicker();
    };
    window.addEventListener(
      APP_EVENT_REQUEST_TABLE_JSON_IMPORT,
      requestJsonImport,
    );
    return () =>
      window.removeEventListener(
        APP_EVENT_REQUEST_TABLE_JSON_IMPORT,
        requestJsonImport,
      );
  }, [
    activeTab?.databaseName,
    activeTab?.isExecuting,
    activeTab?.schemaName,
    activeTab?.tableName,
    isTableReadOnly,
    tabConnectionId,
  ]);
}
