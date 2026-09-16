import { getPostgresRoutineDefinitions } from "@/services/tauri/table.service";
import { MetadataCacheSupersededError } from "@/services/metadataCacheGeneration";
import { RoutineSourceCache } from "./cache";
import type {
  RoutineSourceIdentity,
  RoutineSourceInvalidationIdentity,
} from "./contracts";
import {
  cacheSegment,
  isMetadataConnectionScopeCurrent,
  resolvedRoutineIdentity,
  routineSourceCacheKey,
  routineSourceCacheScope,
} from "./identity";

const routineSourceCache = new RoutineSourceCache();

export function loadPostgresRoutineDefinitions(
  identity: RoutineSourceIdentity,
  options?: { force?: boolean },
): Promise<string[]> {
  const resolved = resolvedRoutineIdentity(identity);
  return routineSourceCache.load(
    routineSourceCacheKey(resolved),
    async () => {
      if (!isMetadataConnectionScopeCurrent(resolved)) {
        throw new MetadataCacheSupersededError();
      }
      const definitions = await getPostgresRoutineDefinitions(
        resolved.connectionId,
        resolved.schema,
        resolved.routine,
      );
      if (!isMetadataConnectionScopeCurrent(resolved)) {
        throw new MetadataCacheSupersededError();
      }
      return definitions;
    },
    options,
  );
}

export function invalidateRoutineSourceCache(
  identity: RoutineSourceInvalidationIdentity,
): void {
  const resolved = resolvedRoutineIdentity({
    ...identity,
    schema: identity.schema || "",
    routine: identity.routine || "",
  });
  const scope = routineSourceCacheScope(resolved);
  const prefix = identity.routine
    ? `${scope}:${cacheSegment(identity.schema)}:${cacheSegment(identity.routine)}`
    : identity.schema
      ? `${scope}:${cacheSegment(identity.schema)}:`
      : `${scope}:`;
  routineSourceCache.invalidatePrefix(prefix);
}

export function resetRoutineSourceCacheForTests(): void {
  routineSourceCache.clear();
}
