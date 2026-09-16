import { createSavedQueryStore } from "./saved-queries/createSavedQueryStore";

export type {
  SavedQuery,
  SavedQueryState,
  SavedQueryTarget,
} from "./saved-queries/contracts";

export const useSavedQueryStore = createSavedQueryStore();
