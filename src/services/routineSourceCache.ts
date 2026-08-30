import {
  getPostgresRoutineDefinitions,
} from "@/services/tauri/table.service";
import type { DatabaseDriver } from "@/services/tauri/types";
import {
  isMetadataConnectionScopeCurrent,
  resolveMetadataConnectionScope,
} from "@/services/metadataConnectionScope";
import { MetadataCacheSupersededError } from "@/services/metadataCacheGeneration";

const ROUTINE_SOURCE_TTL_MS = 24 * 60 * 60 * 1000;
const ROUTINE_SOURCE_MAX_CHARS = 5 * 1024 * 1024;
const ROUTINE_SOURCE_MAX_ENTRIES = 256;

type RoutineSourceEntry = {
  expiresAt: number;
  force: boolean;
  promise?: Promise<string[]>;
  value?: string[];
};

export class RoutineSourceCache {
  private readonly entries = new Map<string, RoutineSourceEntry>();

  constructor(
    private readonly ttlMs = ROUTINE_SOURCE_TTL_MS,
    private readonly maxEntries = ROUTINE_SOURCE_MAX_ENTRIES,
    private readonly maxChars = ROUTINE_SOURCE_MAX_CHARS,
  ) {}

  load(
    key: string,
    loader: () => Promise<string[]>,
    options?: { force?: boolean; now?: number },
  ): Promise<string[]> {
    const force = options?.force === true;
    const now = options?.now ?? Date.now();
    const existing = this.entries.get(key);
    if (existing) {
      this.entries.delete(key);
      this.entries.set(key, existing);
      if (existing.promise && (!force || existing.force)) {
        return existing.promise;
      }
      if (!force && existing.value && existing.expiresAt > now) {
        return Promise.resolve(existing.value);
      }
    }

    const entry: RoutineSourceEntry = {
      expiresAt: now + this.ttlMs,
      force,
    };
    entry.promise = loader().then(
      (definitions) => {
        if (this.entries.get(key) === entry) {
          entry.promise = undefined;
          entry.force = false;
          entry.expiresAt = now + this.ttlMs;
          if (
            definitions.reduce(
              (total, definition) => total + definition.length,
              0,
            ) <= this.maxChars
          ) {
            entry.value = definitions;
          } else {
            this.entries.delete(key);
          }
        }
        return definitions;
      },
      (error) => {
        if (this.entries.get(key) === entry) this.entries.delete(key);
        throw error;
      },
    );
    this.entries.set(key, entry);
    this.prune();
    return entry.promise;
  }

  invalidatePrefix(prefix: string) {
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }

  clear() {
    this.entries.clear();
  }

  get size() {
    return this.entries.size;
  }

  private prune() {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (typeof oldest !== "string") return;
      this.entries.delete(oldest);
    }
  }
}

export type RoutineSourceIdentity = {
  projectId: string;
  connectionId: string;
  driver: DatabaseDriver;
  driverPackageVersion?: string | null;
  connectionDatabaseName?: string | null;
  schema: string;
  routine: string;
};

function cacheSegment(value: string | null | undefined) {
  return encodeURIComponent(value || "");
}

function resolvedRoutineIdentity(identity: RoutineSourceIdentity) {
  return resolveMetadataConnectionScope(identity);
}

export function routineSourceCacheScope(identity: RoutineSourceIdentity) {
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

export function routineSourceCacheKey(identity: RoutineSourceIdentity) {
  return [
    routineSourceCacheScope(identity),
    cacheSegment(identity.schema),
    cacheSegment(identity.routine),
  ].join(":");
}

const routineSourceCache = new RoutineSourceCache();

export function loadPostgresRoutineDefinitions(
  identity: RoutineSourceIdentity,
  options?: { force?: boolean },
) {
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
  identity: Pick<RoutineSourceIdentity, "projectId" | "connectionId" | "driver"> &
    Partial<
      Pick<
        RoutineSourceIdentity,
        | "driverPackageVersion"
        | "connectionDatabaseName"
        | "schema"
        | "routine"
      >
    >,
) {
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

export function resetRoutineSourceCacheForTests() {
  routineSourceCache.clear();
}
