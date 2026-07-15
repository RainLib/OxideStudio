import {
  chmod,
  mkdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { exec } from "@yao-pkg/pkg";

const require = createRequire(import.meta.url);
const pkgFetchCli = require.resolve("@yao-pkg/pkg-fetch/lib-es5/bin.js");
const here = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(here, "../..");
const explicitTarget = argument("--target");
const triple =
  explicitTarget ||
  process.env.TAURI_ENV_TARGET_TRIPLE ||
  process.env.TARGET ||
  rustHostTriple();
const target = pkgTargetForTriple(triple);
const extension = triple.includes("windows") ? ".exe" : "";
const output = join(
  workspace,
  "src-tauri",
  "binaries",
  `oxide-agent-host-${triple}${extension}`,
);
const temporaryOutput = `${output}.tmp-${process.pid}-${randomUUID()}`;
const lockDirectory = `${output}.package-lock`;
const releaseLock = await acquirePackageLock(lockDirectory);

try {
  await mkdir(dirname(output), { recursive: true });
  try {
    execFileSync(
      process.execPath,
      [
        pkgFetchCli,
        "--node-range",
        "node22",
        "--platform",
        target.platform,
        "--arch",
        target.arch,
        "--force-fetch",
      ],
      { cwd: workspace, stdio: "inherit", timeout: 120_000 },
    );
  } catch (error) {
    throw new Error(
      [
        `Unable to download the verified Node 22 pkg base for ${triple}.`,
        "Source compilation is intentionally disabled because it is slow, non-atomic, and unsuitable for release builds.",
        "Check direct access to github.com/yao-pkg/pkg-fetch releases or configure HTTPS_PROXY.",
        error instanceof Error ? error.message : String(error),
      ].join(" "),
      { cause: error },
    );
  }

  await rm(temporaryOutput, { force: true });
  await exec([
    join(workspace, "agent-host", "dist", "oxide-agent-host.cjs"),
    "--targets",
    target.pkg,
    "--output",
    temporaryOutput,
    "--compress",
    "GZip",
    "--fallback-to-source",
    "--no-native-build",
    "--no-signature",
  ]);
  if (!extension) await chmod(temporaryOutput, 0o755);

  execFileSync(
    process.execPath,
    [
      join(workspace, "scripts", "smoke-agent-host.mjs"),
      "--binary",
      temporaryOutput,
      "--max-startup-ms",
      process.env.OXIDE_AGENT_HOST_MAX_STARTUP_MS?.trim() || "2000",
      "--max-rss-mb",
      process.env.OXIDE_AGENT_HOST_MAX_RSS_MB?.trim() || "200",
    ],
    { cwd: workspace, stdio: "inherit", timeout: 60_000 },
  );

  await replaceOutput(temporaryOutput, output);
  process.stderr.write(`[agent-host] packaged ${triple} -> ${output}\n`);
} finally {
  await rm(temporaryOutput, { force: true }).catch(() => undefined);
  await releaseLock();
}

function argument(name) {
  const exact = process.argv.find((value) => value.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1).trim();
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}

function rustHostTriple() {
  const details = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const host = details.match(/^host:\s*(.+)$/m)?.[1]?.trim();
  if (!host) throw new Error("Unable to determine the Rust host target triple");
  return host;
}

function pkgTargetForTriple(target) {
  const mappings = new Map([
    [
      "aarch64-apple-darwin",
      { pkg: "node22-macos-arm64", platform: "macos", arch: "arm64" },
    ],
    [
      "x86_64-apple-darwin",
      { pkg: "node22-macos-x64", platform: "macos", arch: "x64" },
    ],
    [
      "x86_64-unknown-linux-gnu",
      { pkg: "node22-linux-x64", platform: "linux", arch: "x64" },
    ],
    [
      "x86_64-pc-windows-msvc",
      { pkg: "node22-win-x64", platform: "win", arch: "x64" },
    ],
  ]);
  const mapped = mappings.get(target);
  if (!mapped) {
    throw new Error(`Unsupported agent host target triple: ${target}`);
  }
  return mapped;
}

async function acquirePackageLock(path) {
  const deadline = Date.now() + 15 * 60_000;
  while (true) {
    try {
      await mkdir(path);
      try {
        await writeFile(
          join(path, "owner.json"),
          `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`,
          "utf8",
        );
      } catch (error) {
        await rm(path, { recursive: true, force: true });
        throw error;
      }
      return () => rm(path, { recursive: true, force: true });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const age = await stat(path)
        .then((entry) => Date.now() - entry.mtimeMs)
        .catch(() => 0);
      if (age > 30 * 60_000) {
        await rm(path, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for agent host package lock: ${path}`);
      }
      await delay(500);
    }
  }
}

async function replaceOutput(source, destination) {
  try {
    await rename(source, destination);
  } catch (error) {
    if (!triple.includes("windows") || !["EEXIST", "EPERM"].includes(error?.code)) {
      throw error;
    }
    // Windows cannot atomically replace an existing executable. Release builds
    // do not run the old sidecar, so remove it only after the new binary passed
    // the complete protocol smoke test.
    await rm(destination, { force: true });
    await rename(source, destination);
  }
}
