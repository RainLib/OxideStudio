export const METADATA_CACHE_SUPERSEDED_CODE =
  "OXIDE_METADATA_CACHE_SUPERSEDED";

export class MetadataCacheSupersededError extends Error {
  readonly code = METADATA_CACHE_SUPERSEDED_CODE;

  constructor() {
    super("Metadata request was superseded by a newer cache generation.");
    this.name = "MetadataCacheSupersededError";
  }
}

export function isMetadataCacheSupersededError(
  error: unknown,
): error is MetadataCacheSupersededError {
  return (
    error instanceof MetadataCacheSupersededError ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === METADATA_CACHE_SUPERSEDED_CODE)
  );
}

/**
 * Tracks the generation of one metadata-cache scope. A request captures the
 * current generation before doing I/O and must still own it before publishing
 * or persisting its result. Invalidating the scope advances the generation so
 * late responses cannot resurrect deleted metadata.
 */
export class MetadataCacheGenerationRegistry {
  private readonly generations = new Map<string, number>();
  private nextGeneration = 0;
  private readonly maxEntries: number;

  constructor(maxEntries = 512) {
    this.maxEntries = Math.max(1, Math.floor(maxEntries));
  }

  capture(scope: string): number {
    const existing = this.generations.get(scope);
    if (existing !== undefined) {
      this.generations.delete(scope);
      this.generations.set(scope, existing);
      return existing;
    }
    const generation = ++this.nextGeneration;
    this.generations.set(scope, generation);
    this.prune();
    return generation;
  }

  advance(scope: string): number {
    this.generations.delete(scope);
    const generation = ++this.nextGeneration;
    this.generations.set(scope, generation);
    this.prune();
    return generation;
  }

  isCurrent(scope: string, generation: number): boolean {
    return this.capture(scope) === generation;
  }

  assertCurrent(scope: string, generation: number): void {
    if (!this.isCurrent(scope, generation)) {
      throw new MetadataCacheSupersededError();
    }
  }

  get size(): number {
    return this.generations.size;
  }

  private prune() {
    while (this.generations.size > this.maxEntries) {
      const oldest = this.generations.keys().next().value;
      if (typeof oldest !== "string") return;
      this.generations.delete(oldest);
    }
  }
}
