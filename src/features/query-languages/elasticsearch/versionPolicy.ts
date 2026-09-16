import {
  type ElasticsearchConsoleCompletion,
  type ElasticsearchMajorVersion,
  type ElasticsearchServerVersion,
  type ElasticsearchVersionInput,
} from "@/features/query-languages/elasticsearch/types";

export function normalizeElasticsearchVersion(
  version?: ElasticsearchVersionInput,
): ElasticsearchServerVersion | undefined {
  if (typeof version === "number") return { major: version, minor: 0 };
  if (!version) return undefined;
  return version;
}

function supportsElasticsearchVersion(
  version: ElasticsearchVersionInput | undefined,
  minimumMajor: ElasticsearchMajorVersion,
  minimumMinor = 0,
) {
  const normalized = normalizeElasticsearchVersion(version);
  // The server version may be temporarily unavailable during a reconnect.
  // In that state keep suggestions discoverable instead of hiding valid DSL.
  return (
    !normalized ||
    normalized.major > minimumMajor ||
    (normalized.major === minimumMajor && normalized.minor >= minimumMinor)
  );
}

export function filterVersionedSearchBodyCompletions(
  completions: readonly ElasticsearchConsoleCompletion[],
  version?: ElasticsearchVersionInput,
) {
  return completions.filter((completion) => {
    if (completion.label === "runtime_mappings") {
      return supportsElasticsearchVersion(version, 7, 11);
    }
    if (completion.label === "knn") {
      return supportsElasticsearchVersion(version, 8);
    }
    return true;
  });
}

export function filterVersionedQueryCompletions(
  completions: readonly ElasticsearchConsoleCompletion[],
  version?: ElasticsearchVersionInput,
) {
  const normalized = normalizeElasticsearchVersion(version);
  return completions.filter((completion) => {
    if (completion.label === "type") {
      return !normalized || normalized.major <= 6;
    }
    if (
      ["intervals", "distance_feature", "rank_feature", "pinned"].includes(
        completion.label,
      )
    ) {
      return supportsElasticsearchVersion(version, 7);
    }
    if (completion.label === "combined_fields") {
      return supportsElasticsearchVersion(version, 7, 13);
    }
    return true;
  });
}
