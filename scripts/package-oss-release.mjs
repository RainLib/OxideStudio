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
import { resolveReleaseBaseUrl } from "./write-tauri-release-config.mjs";

const ASSET_PATTERNS = [
  /\.dmg$/i,
  /\.app\.tar\.gz(?:\.sig)?$/i,
  /\.appimage(?:\.sig)?$/i,
  /\.deb$/i,
  /\.rpm$/i,
  /(?:-|_)setup\.exe(?:\.sig)?$/i,
  /\.msi(?:\.sig)?$/i,
  /oxide-agent-(?:aarch64-apple-darwin|x86_64-apple-darwin|x86_64-unknown-linux-gnu|x86_64-pc-windows-msvc)(?:\.exe)?$/i,
];

const RELEASE_TARGETS = [
  {
    key: "darwin-aarch64",
    artifactDirectory: "tauri-bundle-macos-aarch64",
    platform: "macos",
    updaterPattern: /\.app\.tar\.gz$/i,
    cliPattern: /oxide-agent-aarch64-apple-darwin$/i,
  },
  {
    key: "darwin-x86_64",
    artifactDirectory: "tauri-bundle-macos-x86_64",
    platform: "macos",
    updaterPattern: /\.app\.tar\.gz$/i,
    cliPattern: /oxide-agent-x86_64-apple-darwin$/i,
  },
  {
    key: "linux-x86_64",
    artifactDirectory: "tauri-bundle-linux-x86_64",
    platform: "linux",
    updaterPattern: /\.appimage$/i,
    cliPattern: /oxide-agent-x86_64-unknown-linux-gnu$/i,
  },
  {
    key: "windows-x86_64",
    artifactDirectory: "tauri-bundle-windows-x86_64",
    platform: "windows",
    updaterPattern: /(?:-|_)setup\.exe$/i,
    cliPattern: /oxide-agent-x86_64-pc-windows-msvc\.exe$/i,
  },
];

const TARGET_BY_ARTIFACT_DIRECTORY = new Map(
  RELEASE_TARGETS.map((target) => [target.artifactDirectory, target])
);

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

function releaseTarget(inputPath, file) {
  const [artifactDirectory] = relative(inputPath, file).split(sep);
  return TARGET_BY_ARTIFACT_DIRECTORY.get(artifactDirectory);
}

function isReleaseAsset(file) {
  return ASSET_PATTERNS.some((pattern) => pattern.test(file));
}

async function sha256(file) {
  const contents = await readFile(file);
  return createHash("sha256").update(contents).digest("hex");
}

function assetUrl(baseUrl, tag, target, name) {
  return `${baseUrl}/${tag}/${target}/${encodeURIComponent(name)}`;
}

function selectUpdaterArtifact(target, files) {
  const matches = files.filter((file) => target.updaterPattern.test(file));
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one updater artifact for ${target.key}, found ${matches.length}.`
    );
  }
  return matches[0];
}

function requireCliArtifact(target, files) {
  const matches = files.filter((file) => target.cliPattern.test(file));
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one standalone oxide-agent CLI for ${target.key}, found ${matches.length}.`
    );
  }
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
  objectPrefix,
  notes = `OxideStudio ${tag}`,
  pubDate = new Date().toISOString(),
}) {
  requireSemver(version);
  if (tag !== `v${version}`) {
    throw new Error(`Release tag ${tag} must match v${version}.`);
  }

  const normalizedBaseUrl = resolveReleaseBaseUrl(baseUrl, objectPrefix);
  const inputPath = resolve(input);
  const outputPath = resolve(output);
  const versionPath = join(outputPath, tag);
  await rm(outputPath, { recursive: true, force: true });
  await mkdir(versionPath, { recursive: true });

  const discovered = (await walkFiles(inputPath)).filter(isReleaseAsset);
  const sourceFiles = new Map(
    RELEASE_TARGETS.map((target) => [target.key, []])
  );
  for (const file of discovered) {
    const target = releaseTarget(inputPath, file);
    if (!target) {
      throw new Error(
        `Release asset is not under a recognized target artifact directory: ${relative(inputPath, file)}`
      );
    }
    sourceFiles.get(target.key).push(file);
  }

  const copiedFiles = [];
  const updaterPlatforms = {};
  for (const target of RELEASE_TARGETS) {
    const files = sourceFiles.get(target.key).sort();
    if (files.length === 0) {
      throw new Error(
        `No release assets found for ${target.key} under ${inputPath}.`
      );
    }

    const targetPath = join(versionPath, target.key);
    await mkdir(targetPath, { recursive: true });
    const copiedNames = new Set();
    for (const source of files) {
      const name = basename(source);
      if (copiedNames.has(name)) {
        throw new Error(`Duplicate ${target.key} release asset: ${name}`);
      }
      copiedNames.add(name);
      const destination = join(targetPath, name);
      await copyFile(source, destination);
      copiedFiles.push({
        target: target.key,
        platform: target.platform,
        name,
        path: destination,
      });
    }

    const updaterSource = selectUpdaterArtifact(target, files);
    requireCliArtifact(target, files);
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
    updaterPlatforms[target.key] = {
      signature,
      url: assetUrl(normalizedBaseUrl, tag, target.key, updaterName),
    };
  }

  const darwinArm64 = updaterPlatforms["darwin-aarch64"];
  const darwinX86_64 = updaterPlatforms["darwin-x86_64"];
  if (darwinArm64.url === darwinX86_64.url) {
    throw new Error("macOS updater URLs must be different for each architecture.");
  }
  if (darwinArm64.signature === darwinX86_64.signature) {
    throw new Error(
      "macOS updater signatures must be different for each architecture."
    );
  }

  const fileMetadata = [];
  for (const file of copiedFiles) {
    const details = await stat(file.path);
    fileMetadata.push({
      target: file.target,
      platform: file.platform,
      name: file.name,
      size: details.size,
      sha256: await sha256(file.path),
      url: assetUrl(normalizedBaseUrl, tag, file.target, file.name),
    });
  }
  fileMetadata.sort((left, right) =>
    `${left.target}/${left.name}`.localeCompare(
      `${right.target}/${right.name}`
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
    .map((file) => `${file.sha256}  ${file.target}/${file.name}`)
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
    objectPrefix: process.env.ALIYUN_OSS_PREFIX,
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
