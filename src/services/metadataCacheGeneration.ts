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

  capture(scope: string): number {
    return this.generations.get(scope) || 0;
  }

  advance(scope: string): number {
    const generation = this.capture(scope) + 1;
    this.generations.set(scope, generation);
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
}
