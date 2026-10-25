import { create } from "zustand";
import type { PrepareTableImportJobRequest } from "@/services/tauri/types/resumableImport";

/** Transient navigation only. Native storage owns preparation/job history. */
export const useFileImportNavigation = create<{
  projectId: string | null;
  pending: PrepareTableImportJobRequest | null;
  show: (projectId: string, request?: PrepareTableImportJobRequest) => void;
  close: () => void;
  take: (request: PrepareTableImportJobRequest) => boolean;
}>((set, get) => ({
  projectId: null,
  pending: null,
  show: (projectId, pending) => set({ projectId, pending: pending ?? null }),
  close: () => set({ projectId: null, pending: null }),
  take: (request) => {
    if (get().pending !== request) return false;
    set({ pending: null });
    return true;
  },
}));
