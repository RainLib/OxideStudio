import type {
  ElasticsearchMajorVersion,
  ElasticsearchServerVersion,
} from "@/lib/elasticsearchConsole";

/**
 * Parse only the server versions supported by the native Elasticsearch
 * driver. Keeping this outside the Monaco component makes the Console's
 * completion gates independently testable and prevents a reconnect from
 * silently falling back to a less precise major-only check.
 */
export function parseElasticsearchConsoleServerVersion(
  version: string | null | undefined,
): ElasticsearchServerVersion | undefined {
  const parts = version?.match(/(6|7|8)(?:\.(\d+))?/);
  const major = Number.parseInt(parts?.[1] || "", 10);
  const minor = Number.parseInt(parts?.[2] || "0", 10);
  return major === 6 || major === 7 || major === 8
    ? { major: major as ElasticsearchMajorVersion, minor }
    : undefined;
}
