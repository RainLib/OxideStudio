import { describe, expect, it } from "vitest";
import type {
  TableDataTransferEndpoint,
  TableDataTransferReport,
} from "@/services/tauri/types";
import { canRetryTableDataTransferReport } from "./tableDataTransferRetry";

const source: TableDataTransferEndpoint = {
  connectionId: "source-1",
  driver: "mysql",
  database: "app",
  schema: "app",
  table: "orders",
};

function report(
  overrides: Partial<TableDataTransferReport> = {},
): TableDataTransferReport {
  return {
    id: "report-1",
    projectId: "project-1",
    transferId: "transfer-1",
    source,
    target: {
      connectionId: "target-1",
      driver: "mysql",
      database: "archive",
      schema: "archive",
      table: "orders",
    },
    mode: "append",
    planDigest: "digest",
    maxRows: 100,
    rowsTransferred: 10,
    batches: 1,
    limitReached: false,
    status: "done",
    startedAt: 1,
    finishedAt: 2,
    ...overrides,
  };
}

describe("table transfer report retry policy", () => {
  it("allows legacy and explicitly safe reports to seed only a fresh review", () => {
    expect(canRetryTableDataTransferReport(report(), source)).toBe(true);
    expect(
      canRetryTableDataTransferReport(
        report({ retryPolicy: "freshPreview" }),
        source,
      ),
    ).toBe(true);
  });

  it("blocks convenience retry after an uncertain post-commit DDL outcome", () => {
    expect(
      canRetryTableDataTransferReport(
        report({
          status: "error",
          retryPolicy: "manualReviewRequired",
          postCommitReceipt: {
            status: "needsManualReview",
            statementsTotal: 3,
            statementsSucceeded: 1,
            message: "Inspect the target manually.",
          },
        }),
        source,
      ),
    ).toBe(false);
  });

  it("rejects reports from a different source identity", () => {
    expect(
      canRetryTableDataTransferReport(
        report(),
        { ...source, table: "customers" },
      ),
    ).toBe(false);
  });
});
