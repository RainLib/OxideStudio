import { readSourceText } from "./lib/source-text.mjs";

import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readSourceText(path.join(root, relativePath));
const facade = read("src/components/workspace/TableDataTransferDialog.tsx");
const controller = read("src/features/table-transfer/hooks/useTableDataTransferDialogController.ts");
const view = read("src/features/table-transfer/ui/TableDataTransferDialogView.tsx");
const contract = read("src/features/table-transfer/model/tableDataTransferDialogTypes.ts");

for (const required of [
  "useTableDataTransferDialogController",
  "TableDataTransferDialogView",
  "export function TableDataTransferDialog",
]) {
  if (!facade.includes(required)) {
    throw new Error(`Table transfer facade must retain ${required}.`);
  }
}

for (const required of [
  "export function useTableDataTransferDialogController",
  "useTransferDestinationMetadata(",
  "useTransferProgress(",
  "useTransferRequests(",
  "createTransferExecutionActions({",
  "createTransferReviewActions({",
  "createTransferTargetActions({",
]) {
  if (!controller.includes(required)) {
    throw new Error(`Table transfer controller must retain ${required}.`);
  }
}

for (const required of [
  "TransferWorkflowSidebar",
  "TransferSetupSection",
  "TransferReviewSection",
]) {
  if (!view.includes(required)) {
    throw new Error(`Table transfer view must retain ${required}.`);
  }
}

for (const forbidden of [
  "useState(",
  "useEffect(",
  "useTransferRequests(",
  "databaseService",
  "tableService",
  "useConnectionStore(",
]) {
  if (view.includes(forbidden)) {
    throw new Error(`Table transfer view must not own ${forbidden}.`);
  }
}

if (view.includes('components/workspace/TableDataTransferDialog')) {
  throw new Error("Table transfer view must not import its compatibility facade.");
}
if (!contract.includes("export interface TableDataTransferDialogProps")) {
  throw new Error("Table transfer dialog props must have one feature-level contract owner.");
}

console.log("Table transfer dialog boundaries verified: facade, lifecycle controller, contract, and presentation are explicit.");
