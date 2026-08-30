#!/usr/bin/env node

/**
 * Prepares an unsigned, immutable SQLite-over-SSH worker payload.
 * Signing is deliberately isolated in the release workflow; the desktop
 * accepts only a manifest and binary bound by the configured release key.
 */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workerRoot = join(repositoryRoot, "src-tauri", "crates", "oxide-sqlite-worker");
const supportedTargets = new Map([
  ["x86_64-unknown-linux-musl", "linux-x64"],
  ["aarch64-unknown-linux-musl", "linux-aarch64"],
]);

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

async function crateVersion() {
  const cargoToml = await readFile(join(workerRoot, "Cargo.toml"), "utf8");
  const version = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (!version) throw new Error("Unable to read SQLite worker version from Cargo.toml");
  return version;
}

function safeVersion(value) {
  if (!/^[A-Za-z0-9._-]{1,96}$/u.test(value)) throw new Error("Worker version contains unsafe characters");
  return value;
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: node scripts/package-sqlite-worker.mjs --target <linux-musl-target> [--binary <path>] [--out <directory>] [--version <version>]");
    return;
  }
  const target = option("--target");
  if (!target || !supportedTargets.has(target)) {
    throw new Error(`--target must be one of: ${[...supportedTargets.keys()].join(", ")}`);
  }
  const platform = supportedTargets.get(target);
  const declaredVersion = await crateVersion();
  const version = safeVersion(option("--version") || declaredVersion);
  if (version !== declaredVersion) {
    throw new Error(`--version must match the worker crate version ${declaredVersion}`);
  }
  const entrypoint = "oxide-sqlite-worker";
  const binary = resolve(option("--binary") || join(workerRoot, "target", target, "release", entrypoint));
  const output = resolve(option("--out") || join(repositoryRoot, "artifacts", "workers", "sqlite", version, platform));
  if (!(await stat(binary).catch(() => null))?.isFile()) throw new Error(`SQLite worker binary was not found: ${binary}`);
  if (await stat(output).catch(() => null)) throw new Error(`Refusing to overwrite an existing worker package: ${output}`);

  await mkdir(output, { recursive: true });
  const packagedBinary = join(output, entrypoint);
  await copyFile(binary, packagedBinary);
  const manifest = {
    schemaVersion: 1,
    artifactKind: "sqlite-ssh-worker",
    packageId: "oxide.sqlite-ssh-worker",
    packageVersion: version,
    protocolVersion: 1,
    entrypoint: basename(packagedBinary),
    sha256: await sha256(packagedBinary),
    platform,
    rustTarget: target,
    supportedRemoteOs: ["linux"],
    capabilities: [
      "parameterized-query",
      "parameterized-execute",
      "metadata",
      "online-backup",
      "restore",
      "interrupt",
    ],
  };
  await writeFile(join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Unsigned SQLite worker package prepared at ${output}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
