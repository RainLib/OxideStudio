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

export async function writeReleaseConfig({ baseUrl, publicKey, output }) {
  const normalizedBaseUrl = normalizeReleaseBaseUrl(baseUrl);
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
  const result = await writeReleaseConfig({ baseUrl, publicKey, output });
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
