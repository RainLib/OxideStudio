import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeReleaseBaseUrl } from "./write-tauri-release-config.mjs";

const ASSET_PATTERNS = [
  /\.dmg$/i,
  /\.app\.tar\.gz(?:\.sig)?$/i,
  /\.appimage(?:\.sig)?$/i,
  /\.deb$/i,
  /\.rpm$/i,
  /(?:-|_)setup\.exe(?:\.sig)?$/i,
  /\.msi(?:\.sig)?$/i,
];

async function walkFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function releasePlatform(file) {
  const normalized = file.split(sep).join("/").toLowerCase();
  if (
    normalized.includes("tauri-bundle-macos") ||
    normalized.includes("/macos/") ||
    normalized.includes("/dmg/")
  ) {
    return "macos";
  }
  if (
    normalized.includes("tauri-bundle-linux") ||
    normalized.includes("/appimage/") ||
    normalized.includes("/deb/") ||
    normalized.includes("/rpm/")
  ) {
    return "linux";
  }
  if (
    normalized.includes("tauri-bundle-windows") ||
    normalized.includes("/nsis/") ||
    normalized.includes("/msi/")
  ) {
    return "windows";
  }
  return null;
}

function isReleaseAsset(file) {
  return ASSET_PATTERNS.some((pattern) => pattern.test(file));
}

async function sha256(file) {
  const contents = await readFile(file);
  return createHash("sha256").update(contents).digest("hex");
}

function assetUrl(baseUrl, tag, platform, name) {
  return `${baseUrl}/${tag}/${platform}/${encodeURIComponent(name)}`;
}

function selectUpdaterArtifact(platform, files) {
  if (platform === "macos") {
    return files.find((file) => /\.app\.tar\.gz$/i.test(file));
  }
  if (platform === "linux") {
    return files.find((file) => /\.appimage$/i.test(file));
  }
  return (
    files.find((file) => /(?:-|_)setup\.exe$/i.test(file)) ||
    files.find((file) => /\.exe$/i.test(file))
  );
}

function requireSemver(version) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid release version: ${version}`);
  }
}

export async function packageOssRelease({
  input,
  output,
  version,
  tag = `v${version}`,
  baseUrl,
  notes = `OxideStudio ${tag}`,
  pubDate = new Date().toISOString(),
}) {
  requireSemver(version);
  if (tag !== `v${version}`) {
    throw new Error(`Release tag ${tag} must match v${version}.`);
  }

  const normalizedBaseUrl = normalizeReleaseBaseUrl(baseUrl);
  const inputPath = resolve(input);
  const outputPath = resolve(output);
  const versionPath = join(outputPath, tag);
  await rm(outputPath, { recursive: true, force: true });
  await mkdir(versionPath, { recursive: true });

  const discovered = (await walkFiles(inputPath)).filter(isReleaseAsset);
  const sourceFiles = { macos: [], linux: [], windows: [] };
  for (const file of discovered) {
    const platform = releasePlatform(file);
    if (platform) sourceFiles[platform].push(file);
  }

  const copiedFiles = [];
  const updaterPlatforms = {};
  for (const platform of ["macos", "linux", "windows"]) {
    const files = sourceFiles[platform];
    if (files.length === 0) {
      throw new Error(`No ${platform} release assets found under ${inputPath}.`);
    }

    const platformPath = join(versionPath, platform);
    await mkdir(platformPath, { recursive: true });
    const copiedNames = new Set();
    for (const source of files) {
      const name = basename(source);
      if (copiedNames.has(name)) {
        throw new Error(`Duplicate ${platform} release asset: ${name}`);
      }
      copiedNames.add(name);
      const destination = join(platformPath, name);
      await copyFile(source, destination);
      copiedFiles.push({ platform, name, path: destination });
    }

    const updaterSource = selectUpdaterArtifact(platform, files);
    if (!updaterSource) {
      throw new Error(`No updater artifact found for ${platform}.`);
    }
    const signatureSource = `${updaterSource}.sig`;
    if (!files.includes(signatureSource)) {
      throw new Error(
        `Missing updater signature for ${relative(inputPath, updaterSource)}.`
      );
    }
    const signature = (await readFile(signatureSource, "utf8")).trim();
    if (!signature) {
      throw new Error(`Updater signature is empty: ${signatureSource}`);
    }

    const updaterName = basename(updaterSource);
    const update = {
      signature,
      url: assetUrl(normalizedBaseUrl, tag, platform, updaterName),
    };
    if (platform === "macos") {
      updaterPlatforms["darwin-aarch64"] = update;
      updaterPlatforms["darwin-x86_64"] = update;
    } else if (platform === "linux") {
      updaterPlatforms["linux-x86_64"] = update;
    } else {
      updaterPlatforms["windows-x86_64"] = update;
    }
  }

  const fileMetadata = [];
  for (const file of copiedFiles) {
    const details = await stat(file.path);
    fileMetadata.push({
      platform: file.platform,
      name: file.name,
      size: details.size,
      sha256: await sha256(file.path),
      url: assetUrl(normalizedBaseUrl, tag, file.platform, file.name),
    });
  }
  fileMetadata.sort((left, right) =>
    `${left.platform}/${left.name}`.localeCompare(
      `${right.platform}/${right.name}`
    )
  );

  const latest = {
    version,
    notes,
    pub_date: pubDate,
    platforms: updaterPlatforms,
  };
  const release = {
    version,
    tag,
    pub_date: pubDate,
    files: fileMetadata,
  };
  const checksums = fileMetadata
    .map((file) => `${file.sha256}  ${file.platform}/${file.name}`)
    .join("\n");

  await writeFile(
    join(outputPath, "latest.json"),
    `${JSON.stringify(latest, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    join(versionPath, "latest.json"),
    `${JSON.stringify(latest, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    join(versionPath, "release.json"),
    `${JSON.stringify(release, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    join(versionPath, "checksums.sha256"),
    `${checksums}\n`,
    "utf8"
  );

  return { latest, release, outputPath, versionPath };
}

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function main() {
  const version = argument("version");
  const tag = argument("tag", version ? `v${version}` : undefined);
  const input = argument("input", "release-input");
  const output = argument("output", "release-output");
  const baseUrl = argument("base-url", process.env.OXIDE_RELEASE_BASE_URL);
  if (!version || !tag || !baseUrl) {
    throw new Error(
      "Usage: node scripts/package-oss-release.mjs --version <semver> --tag <tag> --base-url <https-url> [--input path] [--output path]"
    );
  }

  const result = await packageOssRelease({
    input,
    output,
    version,
    tag,
    baseUrl,
    notes: process.env.RELEASE_NOTES?.trim() || `OxideStudio ${tag}`,
    pubDate: process.env.RELEASE_PUB_DATE || new Date().toISOString(),
  });
  console.log(
    `Prepared ${result.release.files.length} release assets in ${result.outputPath}.`
  );
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
