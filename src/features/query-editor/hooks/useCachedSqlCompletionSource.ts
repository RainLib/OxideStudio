import { useCallback, useMemo, useRef } from "react";
import {
  createCachedSqlCompletionRequest,
  type CachedSqlCompletionCaches,
  type CachedSqlCompletionRequestOptions,
  type CachedSqlCompletionSourceOptions,
} from "../model/cachedSqlCompletion";
export {
  boundedSqlCompletionTextBeforeCursor,
  cachedRelationCompletionSuggestions,
  createCachedSqlCompletionRequest,
} from "../model/cachedSqlCompletion";
export type {
  CachedSqlCompletionRequest,
  CachedSqlCompletionRequestOptions,
  CachedSqlCompletionSourceOptions,
} from "../model/cachedSqlCompletion";

/**
 * Owns the metadata-sensitive SQL completion fallback independently from the
 * editor component. The returned request factory is stable across renderer
 * updates and reads the latest connection/schema/settings through a ref.
 */
export function useCachedSqlCompletionSource(
  options: CachedSqlCompletionSourceOptions,
) {
  const caches = useMemo<CachedSqlCompletionCaches>(()=>({
    fields: new Map(),
    joinConstraints: new Map(),
  }),[options.activeProjectId,options.connectionId,options.driver,options.metadataRevision,
    options.cacheScope,options.databaseName,options.targetSchema,options.currentSchema]);
  const runtimeRef = useRef({options,caches});
  runtimeRef.current = {options,caches};

  return useCallback(
    (request: CachedSqlCompletionRequestOptions) =>
      createCachedSqlCompletionRequest(
        runtimeRef.current.options,
        runtimeRef.current.caches,
        request,
      ),
    [],
  );
}
