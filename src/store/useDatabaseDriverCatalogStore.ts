import { create } from "zustand";
import {
  registerRuntimeDatabaseCatalog,
  supportedDatabaseDriverProfiles,
  type DatabaseDriverProfile,
} from "@/lib/databaseDialect";
import { databaseService } from "@/services/tauri";

export type DatabaseDriverCatalogStatus =
  "idle" | "loading" | "ready" | "fallback";

interface DatabaseDriverCatalogState {
  profiles: DatabaseDriverProfile[];
  status: DatabaseDriverCatalogStatus;
  error: string | null;
  load: () => Promise<void>;
}

let pendingLoad: Promise<void> | null = null;

export const useDatabaseDriverCatalogStore = create<DatabaseDriverCatalogState>(
  (set, get) => ({
    profiles: supportedDatabaseDriverProfiles(),
    status: "idle",
    error: null,
    load: async () => {
      if (get().status === "ready") return;
      if (pendingLoad) return pendingLoad;
      const loadPromise = (async () => {
        set({ status: "loading", error: null });
        try {
          const capabilities = await databaseService.listDatabaseCapabilities();
          if (capabilities.length === 0) {
            throw new Error(
              "The backend returned an empty database driver catalog",
            );
          }
          registerRuntimeDatabaseCatalog(capabilities);
          set({
            profiles: supportedDatabaseDriverProfiles(),
            status: "ready",
            error: null,
          });
        } catch (error) {
          set({
            profiles: supportedDatabaseDriverProfiles(),
            status: "fallback",
            error: error instanceof Error ? error.message : String(error),
          });
        } finally {
          pendingLoad = null;
        }
      })();
      pendingLoad = loadPromise;
      await loadPromise;
    },
  }),
);

export function resetDatabaseDriverCatalogStoreForTests() {
  pendingLoad = null;
  useDatabaseDriverCatalogStore.setState({
    profiles: supportedDatabaseDriverProfiles(),
    status: "idle",
    error: null,
  });
}
