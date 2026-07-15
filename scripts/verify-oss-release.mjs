import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
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

async function assertAssetMatches(
  asset,
  { fetchImpl, attempts, retryDelayMs, waitImpl }
) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const assetUrl = new URL(asset.url);
    assetUrl.searchParams.set(
      "release-asset-verification",
      `${Date.now()}-${attempt}`
    );
    try {
      const response = await fetchImpl(assetUrl, {
        redirect: "follow",
        cache: "no-store",
      });
      if (!response.ok) {
        lastError = new Error(
          `Release asset is not downloadable (${response.status}): ${assetUrl}`
        );
        await response.body?.cancel();
        if (!RETRYABLE_HTTP_STATUSES.has(response.status)) throw lastError;
      } else if (!response.body) {
        throw new Error(`Release asset response has no body: ${assetUrl}`);
      } else {
        const hash = createHash("sha256");
        let size = 0;
        for await (const chunk of response.body) {
          const bytes = Buffer.from(chunk);
          size += bytes.length;
          hash.update(bytes);
        }
        const sha256 = hash.digest("hex");
        if (size !== asset.size) {
          throw new Error(
            `Release asset size mismatch for ${asset.target}/${asset.name}: expected ${asset.size}, received ${size}.`
          );
        }
        if (sha256 !== asset.sha256) {
          throw new Error(
            `Release asset SHA-256 mismatch for ${asset.target}/${asset.name}: expected ${asset.sha256}, received ${sha256}.`
          );
        }
        return;
      }
    } catch (error) {
      lastError = error;
      if (
        error instanceof Error &&
        (error.message.includes("size mismatch") ||
          error.message.includes("SHA-256 mismatch"))
      ) {
        throw error;
      }
    }

    if (attempt < attempts) {
      const delayMs = Math.min(retryDelayMs * 2 ** (attempt - 1), 15_000);
      console.warn(
        `Release asset is not public yet; retrying in ${delayMs}ms (${attempt}/${attempts}): ${asset.url}`
      );
      await waitImpl(delayMs);
    }
  }
  throw lastError;
}

function validateReleaseIndex(index, version, normalizedBaseUrl) {
  if (
    !index ||
    typeof index !== "object" ||
    index.version !== version ||
    index.tag !== `v${version}` ||
    !Array.isArray(index.files)
  ) {
    throw new Error("Release index version, tag, or files are invalid.");
  }
  const keys = new Set();
  for (const file of index.files) {
    const key = `${file?.target}/${file?.name}`;
    const expectedUrl = `${normalizedBaseUrl}/v${version}/${file?.target}/${encodeURIComponent(file?.name ?? "")}`;
    if (
      !REQUIRED_PLATFORMS.includes(file?.target) ||
      typeof file?.name !== "string" ||
      !file.name ||
      file.name.includes("/") ||
      !Number.isSafeInteger(file?.size) ||
      file.size < 0 ||
      typeof file?.sha256 !== "string" ||
      !/^[0-9a-f]{64}$/u.test(file.sha256) ||
      file.url !== expectedUrl
    ) {
      throw new Error(`Release index contains an invalid file entry: ${key}.`);
    }
    if (keys.has(key)) throw new Error(`Release index contains duplicate file: ${key}.`);
    keys.add(key);
  }
  return keys;
}

export async function verifyVersionedOssRelease({
  version,
  baseUrl,
  objectPrefix,
  expectedReleaseIndexPath,
  fetchImpl = fetch,
  manifestAttempts = 6,
  assetAttempts = 3,
  retryDelayMs = 2_000,
  waitImpl = wait,
}) {
  const normalizedBaseUrl = resolveReleaseBaseUrl(baseUrl, objectPrefix);
  const expected = JSON.parse(
    await readFile(resolve(expectedReleaseIndexPath), "utf8")
  );
  const expectedKeys = validateReleaseIndex(
    expected,
    version,
    normalizedBaseUrl
  );
  const releaseIndexUrl = `${normalizedBaseUrl}/v${version}/release.json`;
  const { manifest: fetchedUrl, response } = await fetchManifestWithRetry(
    releaseIndexUrl,
    {
      fetchImpl,
      attempts: manifestAttempts,
      retryDelayMs,
      waitImpl,
    }
  );
  if (!response.ok) {
    throw new Error(
      `Release index is not downloadable (${response.status}): ${fetchedUrl}`
    );
  }
  const published = await response.json();
  const publishedKeys = validateReleaseIndex(
    published,
    version,
    normalizedBaseUrl
  );
  if (
    expectedKeys.size !== publishedKeys.size ||
    [...expectedKeys].some((key) => !publishedKeys.has(key))
  ) {
    throw new Error("Published release index file set does not match the local index.");
  }
  const publishedByKey = new Map(
    published.files.map((file) => [`${file.target}/${file.name}`, file])
  );
  for (const file of expected.files) {
    const publishedFile = publishedByKey.get(`${file.target}/${file.name}`);
    if (
      publishedFile.size !== file.size ||
      publishedFile.sha256 !== file.sha256 ||
      publishedFile.url !== file.url
    ) {
      throw new Error(
        `Published release metadata does not match ${file.target}/${file.name}.`
      );
    }
  }

  await verifyOssRelease({
    manifestUrl: `${normalizedBaseUrl}/v${version}/latest.json`,
    version,
    baseUrl,
    objectPrefix,
    fetchImpl,
    manifestAttempts,
    retryDelayMs,
    waitImpl,
  });
  for (const file of expected.files) {
    await assertAssetMatches(file, {
      fetchImpl,
      attempts: assetAttempts,
      retryDelayMs,
      waitImpl,
    });
  }
  return published;
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

  if (
    !payload.platforms ||
    typeof payload.platforms !== "object" ||
    Array.isArray(payload.platforms)
  ) {
    throw new Error("Update manifest platforms must be an object.");
  }

  const publishedPlatforms = Object.keys(payload.platforms);
  const missingPlatforms = REQUIRED_PLATFORMS.filter(
    (platform) => !publishedPlatforms.includes(platform)
  );
  const unexpectedPlatforms = publishedPlatforms.filter(
    (platform) => !REQUIRED_PLATFORMS.includes(platform)
  );
  if (missingPlatforms.length || unexpectedPlatforms.length) {
    throw new Error(
      `Update manifest target mismatch; missing: ${missingPlatforms.join(", ") || "none"}; unexpected: ${unexpectedPlatforms.join(", ") || "none"}.`
    );
  }

  const urlOwners = new Map();
  for (const platform of REQUIRED_PLATFORMS) {
    const update = payload.platforms[platform];
    const signature =
      typeof update?.signature === "string" ? update.signature.trim() : "";
    if (!signature) {
      throw new Error(`Missing updater signature for ${platform}.`);
    }
    const expectedUrlPrefix = `${normalizedBaseUrl}/v${version}/${platform}/`;
    if (
      typeof update.url !== "string" ||
      !update.url.startsWith(expectedUrlPrefix)
    ) {
      throw new Error(`Invalid updater URL for ${platform}: ${update?.url}`);
    }
    const existingOwner = urlOwners.get(update.url);
    if (existingOwner) {
      throw new Error(
        `Updater URL is shared by ${existingOwner} and ${platform}: ${update.url}`
      );
    }
    urlOwners.set(update.url, platform);
    await assertDownloadable(update.url, fetchImpl);
  }

  if (
    payload.platforms["darwin-aarch64"].signature.trim() ===
    payload.platforms["darwin-x86_64"].signature.trim()
  ) {
    throw new Error(
      "macOS updater signatures must be different for each architecture."
    );
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
  if (/^(?:1|true|yes|on)$/iu.test(process.env.OXIDE_VERIFY_VERSIONED_ASSETS ?? "")) {
    const expectedReleaseIndexPath =
      process.env.OXIDE_EXPECTED_RELEASE_INDEX?.trim();
    if (!expectedReleaseIndexPath) {
      throw new Error(
        "OXIDE_EXPECTED_RELEASE_INDEX is required for versioned asset verification."
      );
    }
    await verifyVersionedOssRelease({
      version,
      baseUrl,
      objectPrefix,
      expectedReleaseIndexPath,
    });
    console.log(`Verified immutable Aliyun OSS assets for v${version}.`);
    return;
  }
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
