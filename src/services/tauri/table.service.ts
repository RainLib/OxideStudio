export * from "./table/page";
export * from "./table/export";
export * from "./table/compare";
export * from "./table/import";
export * from "./table/transfer";
export * from "./table/definition";

import { tableCompareService } from "./table/compare";
import { tableDefinitionService } from "./table/definition";
import { tableExportService } from "./table/export";
import { tableImportService } from "./table/import";
import { tablePageService } from "./table/page";
import { tableTransferService } from "./table/transfer";

export const tableService = {
  ...tablePageService,
  ...tableCompareService,
  ...tableTransferService,
  ...tableExportService,
  ...tableImportService,
  ...tableDefinitionService,
};
