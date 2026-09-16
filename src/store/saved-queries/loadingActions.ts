import { savedSqlService } from "@/services/tauri/saved-sql.service";
import type {
  SavedQueryGet,
  SavedQuerySet,
  SavedQueryState,
} from "./contracts";
import { migrateLegacySavedQueries } from "./legacyMigration";
import { savedQueryFiles } from "./state";

let loadEpoch = 0;

type LoadingActions = Pick<SavedQueryState, "loadProject">;

export function createSavedQueryLoadingActions(
  set: SavedQuerySet,
  get: SavedQueryGet,
): LoadingActions {
  return {
    loadProject: async (projectId) => {
      const epoch = ++loadEpoch;
      set({
        projectId,
        folders: [],
        ...savedQueryFiles([]),
        isLoading: true,
        error: null,
      });
      try {
        let library = await savedSqlService.loadLibrary(projectId);
        if (await migrateLegacySavedQueries(projectId, library.files)) {
          library = await savedSqlService.loadLibrary(projectId);
        }
        if (epoch !== loadEpoch || get().projectId !== projectId) return;
        set({
          folders: library.folders,
          ...savedQueryFiles(library.files),
          isLoading: false,
        });
      } catch (error) {
        if (epoch !== loadEpoch || get().projectId !== projectId) return;
        set({
          isLoading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}
