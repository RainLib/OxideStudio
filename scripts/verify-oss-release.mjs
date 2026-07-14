import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeReleaseBaseUrl } from "./write-tauri-release-config.mjs";

const REQUIRED_PLATFORMS = [
  "darwin-aarch64",
  "darwin-x86_64",
  "linux-x86_64",
  "windows-x86_64",
];

async function assertDownloadable(url) {
  let response = await fetch(url, {
    method: "HEAD",
    redirect: "follow",
    cache: "no-store",
  });
  if (response.status === 405) {
    response = await fetch(url, {
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

export async function verifyOssRelease({ manifestUrl, version, baseUrl }) {
  const normalizedBaseUrl = normalizeReleaseBaseUrl(baseUrl);
  const manifest = new URL(manifestUrl);
  manifest.searchParams.set("release-verification", Date.now().toString());
  const response = await fetch(manifest, {
    redirect: "follow",
    cache: "no-store",
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
      await assertDownloadable(update.url);
      checkedUrls.add(update.url);
    }
  }

  return payload;
}

async function main() {
  const version = process.env.RELEASE_VERSION?.trim();
  const baseUrl = process.env.OXIDE_RELEASE_BASE_URL?.trim();
  if (!version || !baseUrl) {
    throw new Error(
      "RELEASE_VERSION and OXIDE_RELEASE_BASE_URL are required."
    );
  }
  const manifestUrl = `${normalizeReleaseBaseUrl(baseUrl)}/latest.json`;
  await verifyOssRelease({ manifestUrl, version, baseUrl });
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
