import { LSP_TAB_SNAPSHOT_DEBOUNCE_MS } from "@/features/lsp-sync/model/syncPolicy";
import {
  lspTabSnapshot,
  lspTabSnapshotsEqual,
  lspTabStructuresEqual,
} from "@/features/lsp-sync/model/tabSnapshot";
import { useTabStore } from "@/store/useTabStore";
import { useEffect, useRef, useState } from "react";

/**
 * Tab result, cursor, viewport and editor text updates all share one Zustand
 * collection. Publish structural changes immediately, but only publish SQL text
 * after editor input goes idle. This keeps document closure and target changes
 * responsive without rebuilding and reparsing the sync plan on every keystroke.
 */
export function useDebouncedLspTabSnapshot() {
  const [tabs, setTabs] = useState(() =>
    lspTabSnapshot(useTabStore.getState().tabs),
  );
  const latestRef = useRef(tabs);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = useTabStore.subscribe((state) => {
      const next = lspTabSnapshot(state.tabs);
      if (lspTabSnapshotsEqual(latestRef.current, next)) return;
      const structureChanged = !lspTabStructuresEqual(latestRef.current, next);
      latestRef.current = next;
      if (timer !== null) clearTimeout(timer);
      if (structureChanged) {
        timer = null;
        setTabs(next);
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        setTabs(latestRef.current);
      }, LSP_TAB_SNAPSHOT_DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    };
  }, []);

  return tabs;
}
