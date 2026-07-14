import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveReleaseBaseUrl } from "./write-tauri-release-config.mjs";

const REQUIRED_PLATFORMS = [
  "darwin-aarch64",
  "darwin-x86_64",
  "linux-x86_64",
  "windows-x86_64",
];
const RETRYABLE_HTTP_STATUSES = new Set([
  404, 408, 425, 429, 500, 502, 503, 504,
]);

function wait(delayMs) {
  return new Promise((resolveWait) => setTimeout(resolveWait, delayMs));
}

async function fetchManifestWithRetry(
  manifestUrl,
  { fetchImpl, attempts, retryDelayMs, waitImpl }
) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const manifest = new URL(manifestUrl);
    manifest.searchParams.set(
      "release-verification",
      `${Date.now()}-${attempt}`
    );
    try {
      const response = await fetchImpl(manifest, {
        redirect: "follow",
        cache: "no-store",
      });
      if (response.ok || !RETRYABLE_HTTP_STATUSES.has(response.status)) {
        return { manifest, response };
      }
      lastError = new Error(
        `Update manifest is not downloadable (${response.status}): ${manifest}`
      );
      await response.body?.cancel();
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts) {
      const delayMs = Math.min(retryDelayMs * 2 ** (attempt - 1), 15_000);
      console.warn(
        `Update manifest is not public yet; retrying in ${delayMs}ms (${attempt}/${attempts}).`
      );
      await waitImpl(delayMs);
    }
  }
  throw lastError;
}

async function assertDownloadable(url, fetchImpl) {
  let response = await fetchImpl(url, {
    method: "HEAD",
    redirect: "follow",
    cache: "no-store",
  });
  if (response.status === 405) {
    response = await fetchImpl(url, {
      headers: { Range: "bytes=0-0" },
      redirect: "follow",
      cache: "no-store",
    });
    await response.body?.cancel();
  }
  if (!response.ok) {
    throw new Error(`Release asset is not downloadable (${response.status}): ${url}`);
  }
}

export async function verifyOssRelease({
  manifestUrl,
  version,
  baseUrl,
  objectPrefix,
  fetchImpl = fetch,
  manifestAttempts = 6,
  retryDelayMs = 2_000,
  waitImpl = wait,
}) {
  const normalizedBaseUrl = resolveReleaseBaseUrl(baseUrl, objectPrefix);
  const { manifest, response } = await fetchManifestWithRetry(manifestUrl, {
    fetchImpl,
    attempts: manifestAttempts,
    retryDelayMs,
    waitImpl,
  });
  if (!response.ok) {
    throw new Error(
      `Update manifest is not downloadable (${response.status}): ${manifest}`
    );
  }

  const payload = await response.json();
  if (payload.version !== version) {
    throw new Error(
      `Published version ${payload.version || "<missing>"} does not match ${version}.`
    );
  }

  const checkedUrls = new Set();
  for (const platform of REQUIRED_PLATFORMS) {
    const update = payload.platforms?.[platform];
    if (!update?.signature?.trim()) {
      throw new Error(`Missing updater signature for ${platform}.`);
    }
    if (
      typeof update.url !== "string" ||
      !update.url.startsWith(`${normalizedBaseUrl}/v${version}/`)
    ) {
      throw new Error(`Invalid updater URL for ${platform}: ${update?.url}`);
    }
    if (!checkedUrls.has(update.url)) {
      await assertDownloadable(update.url, fetchImpl);
      checkedUrls.add(update.url);
    }
  }

  return payload;
}

async function main() {
  const version = process.env.RELEASE_VERSION?.trim();
  const baseUrl = process.env.OXIDE_RELEASE_BASE_URL?.trim();
  const objectPrefix = process.env.ALIYUN_OSS_PREFIX;
  if (!version || !baseUrl) {
    throw new Error(
      "RELEASE_VERSION and OXIDE_RELEASE_BASE_URL are required."
    );
  }
  const resolvedBaseUrl = resolveReleaseBaseUrl(baseUrl, objectPrefix);
  const manifestUrl = `${resolvedBaseUrl}/latest.json`;
  await verifyOssRelease({ manifestUrl, version, baseUrl, objectPrefix });
  console.log(`Verified Aliyun OSS update manifest for v${version}.`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
