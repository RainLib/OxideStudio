import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invokeWithInterceptors } from "../client";
import type {
  CreateTableResult,
  TableDataTransferBatchExecuteRequest,
  TableDataTransferBatchPlan,
  TableDataTransferBatchPlanRequest,
  TableDataTransferBatchResult,
  TableDataTransferPreview,
  TableDataTransferProgress,
  TableDataTransferReport,
  TableDataTransferRequest,
  TableDataTransferResult,
  TableDataTransferTargetPlan,
  TableDataTransferTargetPlanRequest,
} from "../types";

export const TABLE_DATA_TRANSFER_PROGRESS_EVENT =
  "table-data-transfer://progress";

export async function previewTableDataTransfer(
  request: TableDataTransferRequest,
): Promise<TableDataTransferPreview> {
  return invokeWithInterceptors<TableDataTransferPreview>(
    "preview_table_data_transfer",
    { request },
  );
}

/**
 * Generates a reviewed, target-dialect CREATE TABLE plan from source metadata.
 * The table is not created until the separately bound confirmation is sent.
 */
export async function previewTableDataTransferTarget(
  request: TableDataTransferTargetPlanRequest,
): Promise<TableDataTransferTargetPlan> {
  return invokeWithInterceptors<TableDataTransferTargetPlan>(
    "preview_table_data_transfer_target",
    { request },
  );
}

export async function createTableDataTransferTarget(
  request: TableDataTransferTargetPlanRequest,
  confirmationToken: string,
): Promise<CreateTableResult> {
  return invokeWithInterceptors<CreateTableResult>(
    "create_table_data_transfer_target",
    { request, confirmationToken },
  );
}

export async function executeTableDataTransfer(
  request: TableDataTransferRequest,
  confirmationToken: string,
): Promise<TableDataTransferResult> {
  return invokeWithInterceptors<TableDataTransferResult>(
    "execute_table_data_transfer",
    { request, confirmationToken },
  );
}

export async function cancelTableDataTransfer(
  transferId: string,
): Promise<string> {
  return invokeWithInterceptors<string>("cancel_table_data_transfer", {
    transferId,
  });
}

/** Builds a read-only FK dependency order for a selected group of tables. */
export async function previewTableDataTransferBatchPlan(
  request: TableDataTransferBatchPlanRequest,
): Promise<TableDataTransferBatchPlan> {
  return invokeWithInterceptors<TableDataTransferBatchPlan>(
    "preview_table_data_transfer_batch_plan",
    { request },
  );
}

/** Executes all selected tables inside one native target transaction. */
export async function executeTableDataTransferBatch(
  request: TableDataTransferBatchExecuteRequest,
  confirmationToken: string,
): Promise<TableDataTransferBatchResult> {
  return invokeWithInterceptors<TableDataTransferBatchResult>(
    "execute_table_data_transfer_batch",
    { request, confirmationToken },
  );
}

export async function listTableDataTransferReports(
  projectId: string,
  connectionId: string,
  limit = 20,
): Promise<TableDataTransferReport[]> {
  return invokeWithInterceptors<TableDataTransferReport[]>(
    "list_table_data_transfer_reports",
    { projectId, connectionId, limit },
  );
}

export async function listenTableDataTransferProgress(
  listener: (progress: TableDataTransferProgress) => void,
): Promise<UnlistenFn> {
  return listen<TableDataTransferProgress>(
    TABLE_DATA_TRANSFER_PROGRESS_EVENT,
    (event) => listener(event.payload),
  );
}

export const tableTransferService = {
  previewTableDataTransfer,
  previewTableDataTransferBatchPlan,
  executeTableDataTransferBatch,
  previewTableDataTransferTarget,
  createTableDataTransferTarget,
  executeTableDataTransfer,
  cancelTableDataTransfer,
  listTableDataTransferReports,
  listenTableDataTransferProgress,
};
