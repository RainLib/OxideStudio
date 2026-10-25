import { invokeWithInterceptors } from "./client";
import { largeTransferService } from "./large-transfer.service";
import type {
  LargeTransferCursor,
  LargeTransferPage,
  LargeTransferPreview,
} from "./types/largeTransfer";
import type { FileImportPreparationPage, PrepareTableImportJobRequest } from "./types/resumableImport";

/** Preparation never starts publication; start requires the returned review. */
export const fileImportJobService = {
  preparations: (projectId: string, cursor?: string | null) =>
    invokeWithInterceptors<FileImportPreparationPage>("list_table_import_preparations", { request: { projectId, cursor } }),
  resumePreparation: (projectId: string, preparationId: string) =>
    invokeWithInterceptors<LargeTransferPreview>("resume_table_import_preparation", { request: { projectId, preparationId } }),
  discardPreparation: (projectId: string, preparationId: string) =>
    invokeWithInterceptors<void>("discard_table_import_preparation", { request: { projectId, preparationId } }),
  prepare: (request: PrepareTableImportJobRequest) =>
    invokeWithInterceptors<LargeTransferPreview>("prepare_table_import_job", {
      request,
    }),
  list: (projectId: string, cursor?: LargeTransferCursor | null) =>
    invokeWithInterceptors<LargeTransferPage>("list_table_import_jobs", {
      request: { projectId, cursor },
    }),
  cancelPreparation: (importId: string) =>
    invokeWithInterceptors<string>("cancel_table_import", { importId }),
  get: largeTransferService.get,
  preview: largeTransferService.preview,
  start: largeTransferService.start,
  pause: largeTransferService.pause,
  cancel: largeTransferService.cancel,
};
