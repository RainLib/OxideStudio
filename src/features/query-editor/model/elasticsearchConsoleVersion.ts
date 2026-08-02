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
  // Do not reinterpret an unsupported major's minor component (for example
  // the `6` in `5.6.16`) as a supported Elasticsearch major.
  const parts = version?.match(/(?<![\d.])(6|7|8)(?:\.(\d+))?/);
  const major = Number.parseInt(parts?.[1] || "", 10);
  const minor = Number.parseInt(parts?.[2] || "0", 10);
  return major === 6 || major === 7 || major === 8
    ? { major: major as ElasticsearchMajorVersion, minor }
    : undefined;
}
