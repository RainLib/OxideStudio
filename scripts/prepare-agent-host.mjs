import { access, readdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target =
  process.env.TAURI_ENV_TARGET_TRIPLE?.trim() ||
  process.env.TARGET?.trim() ||
  rustHostTriple();
const extension = target.includes("windows") ? ".exe" : "";
const binary = join(
  root,
  "src-tauri",
  "binaries",
  `oxide-agent-host-${target}${extension}`,
);
const skip = /^(?:1|true|yes|on)$/iu.test(
  process.env.OXIDE_SKIP_AGENT_HOST_PACKAGE ?? "",
);

if (skip) {
  await requireExecutable(binary);
  process.stderr.write(`[agent-host] using prepared ${binary}\n`);
  process.exit(0);
}

const sourceMtime = Math.max(
  await newestMtime(join(root, "agent-host", "src")),
  await newestMtime(join(root, "agent-host", "scripts")),
  await fileMtime(join(root, "agent-host", "package.json")),
  await fileMtime(join(root, "agent-contract", "src", "index.ts")),
  await fileMtime(join(root, "package-lock.json")),
);
const binaryMtime = await fileMtime(binary);
if (binaryMtime >= sourceMtime) {
  await requireExecutable(binary);
  process.stderr.write(`[agent-host] ${target} binary is current\n`);
  process.exit(0);
}

await runNpm(["run", "agent-host:package", "--", "--target", target]);
await requireExecutable(binary);

function rustHostTriple() {
  const details = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const host = details.match(/^host:\s*(.+)$/mu)?.[1]?.trim();
  if (!host) throw new Error("Unable to determine the Rust host target triple");
  return host;
}

async function newestMtime(directory) {
  let latest = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    latest = Math.max(
      latest,
      entry.isDirectory() ? await newestMtime(path) : await fileMtime(path),
    );
  }
  return latest;
}

async function fileMtime(path) {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return 0;
  }
}

async function requireExecutable(path) {
  await access(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);
}

function runNpm(args) {
  const executable = process.platform === "win32" ? "npm.cmd" : "npm";
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, args, {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else {
        rejectPromise(
          new Error(
            `Agent host packaging failed (${signal ? `signal ${signal}` : `exit ${code}`})`,
          ),
        );
      }
    });
  });
}
