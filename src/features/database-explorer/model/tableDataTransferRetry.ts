import type {
  TableDataTransferEndpoint,
  TableDataTransferReport,
} from "@/services/tauri/types";

/**
 * Reports are audit records, never executable jobs. A safe terminal report may
 * seed a fresh preview for the same source relation. A MySQL post-commit DDL
 * interruption requires manual target inspection and cannot seed that flow.
 */
export function canRetryTableDataTransferReport(
  report: TableDataTransferReport,
  source: TableDataTransferEndpoint,
) {
  return (
    report.retryPolicy !== "manualReviewRequired" &&
    report.source.connectionId === source.connectionId &&
    report.source.driver === source.driver &&
    report.source.database === source.database &&
    report.source.schema === source.schema &&
    report.source.table === source.table
  );
}
