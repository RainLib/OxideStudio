import {
  ROUTINE_SOURCE_MAX_CHARS,
  ROUTINE_SOURCE_MAX_ENTRIES,
  ROUTINE_SOURCE_TTL_MS,
  type RoutineSourceEntry,
} from "./contracts";

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
      if (existing.promise && (!force || existing.force)) return existing.promise;
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

  invalidatePrefix(prefix: string): void {
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size() {
    return this.entries.size;
  }

  private prune(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (typeof oldest !== "string") return;
      this.entries.delete(oldest);
    }
  }
}
