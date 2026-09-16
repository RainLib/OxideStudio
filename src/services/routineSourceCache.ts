/** Stable compatibility entry point for PostgreSQL routine source caching. */
export { RoutineSourceCache } from "./routine-source-cache/cache";
export type { RoutineSourceIdentity } from "./routine-source-cache/contracts";
export {
  routineSourceCacheKey,
  routineSourceCacheScope,
} from "./routine-source-cache/identity";
export {
  invalidateRoutineSourceCache,
  loadPostgresRoutineDefinitions,
  resetRoutineSourceCacheForTests,
} from "./routine-source-cache/runtime";
