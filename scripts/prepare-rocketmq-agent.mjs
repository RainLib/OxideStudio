#!/usr/bin/env node
// Build the dedicated RocketMQ workspace agent beside Tauri's external
// binaries.  It remains intentionally independent from the SQL driver package
// installer because its JSON-RPC surface models queue administration.
import { access, mkdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.env.TAURI_ENV_TARGET_TRIPLE?.trim() || process.env.TARGET?.trim() || rustHostTriple();
const extension = target.includes("windows") ? ".exe" : "";
const source = join(root, "src-tauri", "agents", "rocketmq");
const output = join(root, "src-tauri", "binaries", `oxide-agent-rocketmq-${target}${extension}`);
const sourceMtime = Math.max(
  await fileMtime(join(source, "main.go")),
  await fileMtime(join(source, "go.mod")),
  await fileMtime(join(source, "go.sum")),
);

if (await fileMtime(output) >= sourceMtime) {
  await requireExecutable(output);
  process.stderr.write(`[rocketmq-agent] ${target} binary is current\n`);
  process.exit(0);
}

const targetEnv = goTarget(target);
await mkdir(dirname(output), { recursive: true });
await run("go", ["build", "-trimpath", "-o", output, "."], { cwd: source, env: { ...process.env, ...targetEnv, CGO_ENABLED: "0" } });
await requireExecutable(output);
process.stderr.write(`[rocketmq-agent] bundled ${output}\n`);

function rustHostTriple() {
  const details = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const host = details.match(/^host:\s*(.+)$/mu)?.[1]?.trim();
  if (!host) throw new Error("Unable to determine the Rust host target triple");
  return host;
}

function goTarget(value) {
  switch (value) {
    case "x86_64-pc-windows-msvc": return { GOOS: "windows", GOARCH: "amd64" };
    case "x86_64-unknown-linux-gnu": return { GOOS: "linux", GOARCH: "amd64" };
    case "aarch64-apple-darwin": return { GOOS: "darwin", GOARCH: "arm64" };
    default: throw new Error(`RocketMQ agent does not support target ${value}`);
  }
}

async function fileMtime(path) { try { return (await stat(path)).mtimeMs; } catch { return 0; } }
async function requireExecutable(path) { await access(path, process.platform === "win32" ? constants.F_OK : constants.X_OK); }
function run(command, args, options) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { ...options, stdio: "inherit" });
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => code === 0 ? resolvePromise() : rejectPromise(new Error(`${command} failed (${signal || `exit ${code}`})`)));
  });
}
