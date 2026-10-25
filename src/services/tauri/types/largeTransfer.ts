import type {
  TableDataTransferEndpoint,
  TableDataTransferMode,
} from "./tableTransfer";
import type { FileImportSnapshotPlan } from "./resumableImport";

export type LargeTransferPhase =
  | "preparing"
  | "awaitingReview"
  | "copying"
  | "paused"
  | "publishing"
  | "completed"
  | "cancelled"
  | "failed";

export interface LargeTransferRequest {
  projectId: string;
  source: TableDataTransferEndpoint;
  target: TableDataTransferEndpoint;
  mode: TableDataTransferMode;
  batchRows: number;
}

export interface LargeTransferSummary {
  id: string;
  projectId: string;
  source: TableDataTransferEndpoint;
  target: TableDataTransferEndpoint;
  mode: TableDataTransferMode;
  phase: LargeTransferPhase;
  sourceRows: number;
  rowsStaged: number;
  batches: number;
  snapshotBytes: number;
  reviewReady: boolean;
  createdAt: number;
  updatedAt: number;
  issue?: string | null;
}

export interface LargeTransferPreview {
  job: LargeTransferSummary;
  confirmationToken: string;
  targetRowsBefore: number;
  mappedColumns: {
    source: string;
    target: string;
    sourceType: string;
    targetType: string;
  }[];
  skippedColumns: string[];
  warnings: string[];
  fileImport?: FileImportSnapshotPlan | null;
}

export interface LargeTransferCursor {
  updatedAt: number;
  id: string;
}

export interface LargeTransferPage {
  jobs: LargeTransferSummary[];
  nextCursor?: LargeTransferCursor | null;
}
