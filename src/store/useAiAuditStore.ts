import type { AiToolAuditEntry } from "@/ai/tools/types";
import { create } from "zustand";

const MAX_AI_AUDIT_ENTRIES = 100;

interface AiAuditState {
  entries: AiToolAuditEntry[];
  record: (entry: AiToolAuditEntry) => void;
  clear: () => void;
}

export const useAiAuditStore = create<AiAuditState>((set) => ({
  entries: [],
  record: (entry) =>
    set((state) => ({
      entries: [entry, ...state.entries].slice(0, MAX_AI_AUDIT_ENTRIES),
    })),
  clear: () => set({ entries: [] }),
}));
