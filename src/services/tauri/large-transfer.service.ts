import { invokeWithInterceptors } from "./client";
import type {
  LargeTransferCursor,
  LargeTransferPage,
  LargeTransferPreview,
  LargeTransferRequest,
  LargeTransferSummary,
} from "./types/largeTransfer";

export const largeTransferService = {
  prepare: (request: LargeTransferRequest) =>
    invokeWithInterceptors<LargeTransferSummary>("prepare_large_transfer", {
      request,
    }),
  list: (projectId: string, cursor?: LargeTransferCursor | null) =>
    invokeWithInterceptors<LargeTransferPage>("list_large_transfers", {
      request: { projectId, cursor },
    }),
  get: (projectId: string, id: string) =>
    invokeWithInterceptors<LargeTransferSummary>("get_large_transfer", {
      request: { projectId, id },
    }),
  preview: (projectId: string, id: string) =>
    invokeWithInterceptors<LargeTransferPreview>("preview_large_transfer", {
      request: { projectId, id },
    }),
  start: (projectId: string, id: string, confirmationToken: string) =>
    invokeWithInterceptors<LargeTransferSummary>("start_large_transfer", {
      request: { projectId, id, confirmationToken },
    }),
  pause: (projectId: string, id: string) =>
    invokeWithInterceptors<boolean>("pause_large_transfer", {
      request: { projectId, id },
    }),
  cancel: (projectId: string, id: string) =>
    invokeWithInterceptors<boolean>("cancel_large_transfer", {
      request: { projectId, id },
    }),
};
