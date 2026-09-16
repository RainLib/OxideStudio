import { useCallback, useEffect, useRef } from "react";
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
  const runtimeRef = useRef(options);
  runtimeRef.current = options;
  const cachesRef = useRef<CachedSqlCompletionCaches>({
    fields: new Map(),
    joinConstraints: new Map(),
  });

  useEffect(() => {
    cachesRef.current.fields.clear();
    cachesRef.current.joinConstraints.clear();
  }, [options.connectionId, options.driver, options.metadataRevision]);

  return useCallback(
    (request: CachedSqlCompletionRequestOptions) =>
      createCachedSqlCompletionRequest(
        runtimeRef.current,
        cachesRef.current,
        request,
      ),
    [],
  );
}
