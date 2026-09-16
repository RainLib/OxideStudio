import {
  isMetadataConnectionScopeCurrent,
  resolveMetadataConnectionScope,
} from "@/services/metadataConnectionScope";
import type { RoutineSourceIdentity } from "./contracts";

export function cacheSegment(value: string | null | undefined): string {
  return encodeURIComponent(value || "");
}

export function resolvedRoutineIdentity(identity: RoutineSourceIdentity) {
  return resolveMetadataConnectionScope(identity);
}

export function routineSourceCacheScope(identity: RoutineSourceIdentity): string {
  const resolved = resolvedRoutineIdentity(identity);
  return [
    "routine-source:v1",
    cacheSegment(resolved.projectId),
    cacheSegment(resolved.connectionId),
    cacheSegment(resolved.driver),
    cacheSegment(resolved.driverPackageVersion),
    cacheSegment(resolved.connectionDatabaseName),
  ].join(":");
}

export function routineSourceCacheKey(identity: RoutineSourceIdentity): string {
  return [
    routineSourceCacheScope(identity),
    cacheSegment(identity.schema),
    cacheSegment(identity.routine),
  ].join(":");
}

export { isMetadataConnectionScopeCurrent };
