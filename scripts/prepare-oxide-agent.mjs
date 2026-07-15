import { access, chmod, copyFile, readdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const explicitTarget = process.argv.find(
  (argument, index, argumentsList) =>
    argumentsList[index - 1] === "--target" && Boolean(argument),
);
const target =
  explicitTarget ||
  process.env.TAURI_ENV_TARGET_TRIPLE?.trim() ||
  process.env.TARGET?.trim() ||
  rustHostTriple();
const extension = target.includes("windows") ? ".exe" : "";
const binary = join(
  root,
  "src-tauri",
  "binaries",
  `oxide-agent-${target}${extension}`,
);
const builtBinary = join(
  root,
  "src-tauri",
  "target",
  target,
  "release",
  `oxide-agent${extension}`,
);
const skip = /^(?:1|true|yes|on)$/iu.test(
  process.env.OXIDE_SKIP_OXIDE_AGENT_PREPARE ?? "",
);

if (skip) {
  await requireExecutable(binary);
  process.stderr.write(`[oxide-agent] using prepared ${binary}\n`);
  process.exit(0);
}

const sourceMtime = Math.max(
  await newestMtime(join(root, "src-tauri", "src", "bin", "oxide_agent")),
  await fileMtime(join(root, "src-tauri", "src", "bin", "oxide-agent.rs")),
  await newestMtime(join(root, "src-tauri", "src", "core")),
  await newestMtime(join(root, "src-tauri", "src", "drivers")),
  await fileMtime(join(root, "src-tauri", "Cargo.toml")),
  await fileMtime(join(root, "src-tauri", "Cargo.lock")),
);
const binaryMtime = await fileMtime(binary);
if (binaryMtime >= sourceMtime) {
  await requireExecutable(binary);
  process.stderr.write(`[oxide-agent] ${target} binary is current\n`);
  process.exit(0);
}

await runCargo([
  "build",
  "--release",
  "--manifest-path",
  join(root, "src-tauri", "Cargo.toml"),
  "--bin",
  "oxide-agent",
  "--target",
  target,
]);
await copyFile(builtBinary, binary);
if (!target.includes("windows")) await chmod(binary, 0o755);
await requireExecutable(binary);
process.stderr.write(`[oxide-agent] prepared ${binary}\n`);

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

function runCargo(args) {
  const executable = process.platform === "win32" ? "cargo.exe" : "cargo";
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, args, {
      cwd: root,
      env: {
        ...process.env,
        // Avoid a circular bundle-time check while producing the external bin.
        TAURI_CONFIG: JSON.stringify({ bundle: { externalBin: [] } }),
      },
      stdio: "inherit",
    });
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else {
        rejectPromise(
          new Error(
            `oxide-agent build failed (${signal ? `signal ${signal}` : `exit ${code}`})`,
          ),
        );
      }
    });
  });
}
