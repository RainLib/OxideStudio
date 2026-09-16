import type { TableDataCompareResult } from "@/services/tauri/types/tableCompare";

export type FullComparisonMeta = {
  sourceRows: number;
  targetRows: number;
  batchSize: number;
  detailLimitPerStatus: number;
  detailsTruncated: boolean;
  degradationLevel: TableDataCompareResult["degradationLevel"];
  samplingRate: number;
  verificationMethod: TableDataCompareResult["verificationMethod"];
  countsExact: boolean;
  sampledKeyCount: number;
  checksumsMatch?: boolean;
};
