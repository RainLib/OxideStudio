import type { DatabaseDriver } from "@/services/tauri/types/database";
import { useEffect } from "react";

interface UseExplorerNamespaceLoadingContext {
  activeConnectionId: string | null;
  isActiveConnectionReady: boolean;
  shouldAutoIntrospect: boolean;
  activeDriver: DatabaseDriver;
  loadSchemas: (
    connectionId: string,
    force?: boolean | undefined,
  ) => Promise<void>;
  hydrateConnectionMetadataFromCache: (
    connectionId: string,
  ) => Promise<boolean>;
}

export function useExplorerNamespaceLoading({
  activeConnectionId,
  isActiveConnectionReady,
  shouldAutoIntrospect,
  activeDriver,
  loadSchemas,
  hydrateConnectionMetadataFromCache,
}: UseExplorerNamespaceLoadingContext) {
  useEffect(() => {
    if (activeConnectionId) {
      if (
        isActiveConnectionReady &&
        (shouldAutoIntrospect || activeDriver === "redis")
      ) {
        // Show any hydrated metadata immediately, then refresh only the
        // namespace list. Object metadata stays lazy until its node expands.
        loadSchemas(activeConnectionId, true);
      } else {
        void hydrateConnectionMetadataFromCache(activeConnectionId);
      }
    }
  }, [
    activeConnectionId,
    activeDriver,
    hydrateConnectionMetadataFromCache,
    isActiveConnectionReady,
    loadSchemas,
    shouldAutoIntrospect,
  ]);
}
