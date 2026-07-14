import { useEffect } from "react";
import { useHistoryStore } from "@/store/useHistoryStore";
import { useProjectStore } from "@/store/useProjectStore";

export function QueryHistorySync() {
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const loadHistory = useHistoryStore((state) => state.loadHistory);

  useEffect(() => {
    void loadHistory(activeProjectId);
  }, [activeProjectId, loadHistory]);

  return null;
}
