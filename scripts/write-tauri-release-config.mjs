import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function normalizeReleaseBaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("OXIDE_RELEASE_BASE_URL must use HTTPS.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "OXIDE_RELEASE_BASE_URL cannot contain credentials, a query, or a fragment."
    );
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.href.replace(/\/$/, "");
}

export function normalizeOssPrefix(value) {
  const prefix = value?.trim().replace(/^\/+|\/+$/g, "");
  if (!prefix) return "";
  if (
    prefix.includes("\\") ||
    prefix
      .split("/")
      .some(
        (segment) => !segment || segment === "." || segment === ".."
      )
  ) {
    throw new Error("ALIYUN_OSS_PREFIX must be a clean OSS object prefix.");
  }
  return prefix;
}

export function resolveReleaseBaseUrl(baseUrl, objectPrefix) {
  const normalizedBaseUrl = normalizeReleaseBaseUrl(baseUrl);
  const normalizedPrefix = normalizeOssPrefix(objectPrefix);
  if (!normalizedPrefix) return normalizedBaseUrl;

  const url = new URL(normalizedBaseUrl);
  const basePath = url.pathname.replace(/\/+$/, "");
  const encodedPrefix = normalizedPrefix
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const prefixPath = `/${encodedPrefix}`;
  if (basePath === prefixPath || basePath.endsWith(prefixPath)) {
    return normalizedBaseUrl;
  }

  url.pathname = `${basePath}${prefixPath}`;
  return url.href.replace(/\/$/, "");
}

function normalizeWindowsCertificateThumbprint(value) {
  const thumbprint = value?.replace(/\s+/g, "").toUpperCase();
  if (!thumbprint) return undefined;
  if (!/^[0-9A-F]{40}$/.test(thumbprint)) {
    throw new Error(
      "WINDOWS_CERTIFICATE_THUMBPRINT must be a 40-character SHA-1 thumbprint."
    );
  }
  return thumbprint;
}

function normalizeTimestampUrl(value) {
  const url = new URL(value || "http://timestamp.digicert.com");
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("WINDOWS_TIMESTAMP_URL must use HTTP or HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("WINDOWS_TIMESTAMP_URL cannot contain credentials.");
  }
  return url.href;
}

export async function writeReleaseConfig({
  baseUrl,
  objectPrefix,
  publicKey,
  output,
  windowsCertificateThumbprint,
  windowsTimestampUrl,
}) {
  const normalizedBaseUrl = resolveReleaseBaseUrl(baseUrl, objectPrefix);
  const normalizedPublicKey = publicKey?.trim();
  if (!normalizedPublicKey) {
    throw new Error("Missing OXIDE_UPDATER_PUBLIC_KEY.");
  }
  const endpoint = `${normalizedBaseUrl}/latest.json`;
  const outputPath = resolve(output);
  const config = {
    plugins: {
      updater: {
        endpoints: [endpoint],
        pubkey: normalizedPublicKey,
      },
    },
  };
  const thumbprint = normalizeWindowsCertificateThumbprint(
    windowsCertificateThumbprint
  );
  if (thumbprint) {
    config.bundle = {
      windows: {
        certificateThumbprint: thumbprint,
        digestAlgorithm: "sha256",
        timestampUrl: normalizeTimestampUrl(windowsTimestampUrl),
      },
    };
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { endpoint, outputPath };
}

async function main() {
  const baseUrl = process.env.OXIDE_RELEASE_BASE_URL?.trim();
  if (!baseUrl) {
    throw new Error("Missing OXIDE_RELEASE_BASE_URL.");
  }
  const publicKey = process.env.OXIDE_UPDATER_PUBLIC_KEY;

  const output = process.argv[2] || "src-tauri/tauri.release.conf.json";
  const result = await writeReleaseConfig({
    baseUrl,
    objectPrefix: process.env.ALIYUN_OSS_PREFIX,
    publicKey,
    output,
    windowsCertificateThumbprint:
      process.env.WINDOWS_CERTIFICATE_THUMBPRINT,
    windowsTimestampUrl: process.env.WINDOWS_TIMESTAMP_URL,
  });
  console.log(`Tauri updater endpoint: ${result.endpoint}`);
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
