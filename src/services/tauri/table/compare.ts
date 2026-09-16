import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invokeWithInterceptors } from "../client";
import type {
  ExecuteTableDataCompareSyncRequest,
  TableDataCompareProgress,
  TableDataCompareRequest,
  TableDataCompareResult,
  TableDataCompareSyncPreview,
  TableDataCompareSyncPreviewRequest,
  TableDataCompareSyncReceipt,
} from "../types";

export const TABLE_DATA_COMPARE_PROGRESS_EVENT =
  "table-data-compare://progress";

export function createTableDataCompareId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return randomId
    ? `table-compare-${randomId}`
    : `table-compare-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function compareTableDataFull(
  request: TableDataCompareRequest,
): Promise<TableDataCompareResult> {
  return invokeWithInterceptors<TableDataCompareResult>(
    "compare_table_data_full",
    { request },
  );
}

export async function cancelTableDataCompare(
  compareId: string,
): Promise<string> {
  return invokeWithInterceptors<string>("cancel_table_data_compare", {
    compareId,
  });
}

export async function listenTableDataCompareProgress(
  listener: (progress: TableDataCompareProgress) => void,
): Promise<UnlistenFn> {
  return listen<TableDataCompareProgress>(
    TABLE_DATA_COMPARE_PROGRESS_EVENT,
    (event) => listener(event.payload),
  );
}

export async function previewTableDataCompareSync(
  request: TableDataCompareSyncPreviewRequest,
): Promise<TableDataCompareSyncPreview> {
  return invokeWithInterceptors<TableDataCompareSyncPreview>(
    "preview_table_data_compare_sync",
    { request },
  );
}

/** Consumes a Host-frozen, short-lived synchronization plan exactly once. */
export async function executeTableDataCompareSync(
  request: ExecuteTableDataCompareSyncRequest,
): Promise<TableDataCompareSyncReceipt> {
  return invokeWithInterceptors<TableDataCompareSyncReceipt>(
    "execute_table_data_compare_sync",
    { request },
  );
}

export const tableCompareService = {
  createTableDataCompareId,
  compareTableDataFull,
  cancelTableDataCompare,
  listenTableDataCompareProgress,
  previewTableDataCompareSync,
  executeTableDataCompareSync,
};
