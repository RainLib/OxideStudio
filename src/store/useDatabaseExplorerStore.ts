import {
  useCallback,
  useMemo,
  type Dispatch,
  type SetStateAction,
} from "react";
import { createDatabaseExplorerStore } from "./database-explorer/createDatabaseExplorerStore";
import {
  EMPTY_EXPLORER_CONNECTION_ASSIGNMENTS,
  EMPTY_EXPLORER_CONNECTION_GROUPS,
  EMPTY_EXPLORER_EXPANDED,
  EMPTY_EXPLORER_NODE_IDS,
  EMPTY_EXPLORER_VISIBILITY_FILTERS,
} from "./database-explorer/state";

export type {
  DatabaseExplorerScopeState,
  DatabaseExplorerStore,
  ExplorerConnectionGroup,
  ExplorerConnectionSortMode,
  ExplorerExpansionBucket,
  ExplorerFilterScope,
  ExplorerSearchMode,
  ExplorerStringListUpdate,
  ExplorerViewMode,
} from "./database-explorer/contracts";
export {
  EMPTY_EXPLORER_CONNECTION_ASSIGNMENTS,
  EMPTY_EXPLORER_CONNECTION_GROUPS,
  EMPTY_EXPLORER_NODE_IDS,
  EMPTY_EXPLORER_VISIBILITY_FILTERS,
};

import type {
  ExplorerExpansionBucket,
  ExplorerStringListUpdate,
} from "./database-explorer/contracts";

export const useDatabaseExplorerStore = createDatabaseExplorerStore();

/** A useState-compatible adapter keeps legacy tree renderers working while
 * their local expansion state is moved into the shared explorer runtime. */
export function useExplorerExpansionState(
  scopeId: string,
  bucket: ExplorerExpansionBucket,
): [string[], Dispatch<ExplorerStringListUpdate>] {
  const values = useDatabaseExplorerStore(
    (state) =>
      state.scopes[scopeId]?.expanded[bucket] ?? EMPTY_EXPLORER_EXPANDED[bucket],
  );
  const updateExpanded = useDatabaseExplorerStore(
    (state) => state.updateExpanded,
  );
  const setValues = useCallback<Dispatch<ExplorerStringListUpdate>>(
    (update) => updateExpanded(scopeId, bucket, update),
    [bucket, scopeId, updateExpanded],
  );
  return [values, setValues];
}

export function useExplorerExpansionSetState(
  scopeId: string,
  bucket: ExplorerExpansionBucket,
  namespace: string,
): [Set<string>, Dispatch<SetStateAction<Set<string>>>] {
  const [storedValues, setStoredValues] = useExplorerExpansionState(
    scopeId,
    bucket,
  );
  const prefix = `${namespace}\u0000`;
  const values = useMemo(
    () =>
      new Set(
        storedValues
          .filter((value) => value.startsWith(prefix))
          .map((value) => value.slice(prefix.length)),
      ),
    [prefix, storedValues],
  );
  const setValues = useCallback<Dispatch<SetStateAction<Set<string>>>>(
    (update) => {
      setStoredValues((currentStored) => {
        const currentValues = new Set(
          currentStored
            .filter((value) => value.startsWith(prefix))
            .map((value) => value.slice(prefix.length)),
        );
        const nextValues =
          typeof update === "function" ? update(currentValues) : update;
        return [
          ...currentStored.filter((value) => !value.startsWith(prefix)),
          ...[...nextValues].map((value) => `${prefix}${value}`),
        ];
      });
    },
    [prefix, setStoredValues],
  );
  return [values, setValues];
}

export function resetDatabaseExplorerStoreForTests() {
  useDatabaseExplorerStore.setState({ scopes: {} });
}
