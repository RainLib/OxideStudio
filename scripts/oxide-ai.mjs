#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const packageVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const buildHint = "Build the native tools with: cargo build --manifest-path src-tauri/Cargo.toml --bin oxide-agent";

function nativeBinary() {
  const explicit = process.env.OXIDE_AGENT_BIN?.trim();
  if (explicit) return resolve(explicit);
  const target = process.env.CARGO_TARGET_DIR?.trim();
  const directory = target ? resolve(target) : join(root, "src-tauri", "target");
  const executable = process.platform === "win32" ? "oxide-agent.exe" : "oxide-agent";
  const found = ["debug", "release"].map((profile) => join(directory, profile, executable)).find(existsSync);
  if (!found) throw new Error("Native oxide-agent was not found. " + buildHint + ". OXIDE_AGENT_BIN can select an installed executable.");
  return found;
}

function main() {
  const binary = nativeBinary();
  const version = spawnSync(binary, ["--version"], { encoding: "utf8", timeout: 10_000, windowsHide: true });
  if (version.error || version.status !== 0) throw new Error("Cannot start native oxide-agent. " + buildHint);
  if (version.stdout.trim() !== "oxide-agent " + packageVersion) {
    throw new Error("Native oxide-agent version does not match this checkout (" + packageVersion + "). " + buildHint);
  }
  // Keep stdio unmodified: the native process owns MCP framing, grants and errors.
  const child = spawn(binary, process.argv.slice(2), { stdio: "inherit", windowsHide: true });
  const signals = ["SIGINT", "SIGTERM"].map((signal) => {
    const forward = () => { child.kill(signal); };
    process.once(signal, forward);
    return { signal, forward };
  });
  const cleanup = () => signals.forEach(({ signal, forward }) => process.off(signal, forward));
  child.once("error", (error) => {
    cleanup();
    process.stderr.write(error.message + "\n");
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    cleanup();
    process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
  });
}

try { main(); } catch (error) {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
  process.exitCode = 1;
}
