// Build two actual package versions in a private source copy. The user's
// Cargo.toml/lock stay untouched; shared Cargo outputs are rebuilt on exit.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "oxide-backup-upgrade-"));
const snapshot = path.join(scratch, "source");
const target = path.resolve(process.env.CARGO_TARGET_DIR || path.join(root, "src-tauri/target"));
const environment = {
  ...process.env,
  CARGO_TARGET_DIR: target,
  CARGO_INCREMENTAL: "0",
  CARGO_PROFILE_DEV_DEBUG: "0",
  CARGO_PROFILE_TEST_DEBUG: "0",
  TAURI_CONFIG: process.env.TAURI_CONFIG || '{"bundle":{"externalBin":[]}}',
};

async function cargo(args, cwd, extra = {}) {
  const child = spawn("cargo", args, { cwd, env: { ...environment, ...extra }, stdio: "inherit", windowsHide: true });
  await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`cargo ${args.join(" ")} failed (${code ?? signal})`)));
  });
}

let outputsChanged = false;
try {
  for (const directory of ["src-tauri", "enterprise"]) {
    await fs.cp(path.join(root, directory), path.join(snapshot, directory), {
      recursive: true,
      filter: (source) => {
        const name = path.basename(source);
        return !["target", "node_modules", ".git", "dist", "secrets"].includes(name)
          && name !== ".env" && !name.startsWith(".env.");
      },
    });
  }
  const manifest = path.join(snapshot, "src-tauri/Cargo.toml");
  for (const file of [manifest, path.join(snapshot, "src-tauri/Cargo.lock")]) {
    if ((await fs.lstat(file)).isSymbolicLink()) throw new Error("The upgrade source copy requires regular Cargo version files");
  }
  const source = await fs.readFile(manifest, "utf8");
  const match = source.match(/^version\s*=\s*"(\d+)\.(\d+)\.(\d+)[^"]*"/m);
  if (!match) throw new Error("Cannot identify the desktop package version");
  const next = `${match[1]}.${match[2]}.${BigInt(match[3]) + 1n}`;
  outputsChanged = true;
  await cargo(["build", "--offline", "--manifest-path", manifest, "--bin", "oxide-studio"], snapshot);
  const previous = path.join(scratch, process.platform === "win32" ? "previous-worker.exe" : "previous-worker");
  await fs.copyFile(path.join(target, "debug", process.platform === "win32" ? "oxide-studio.exe" : "oxide-studio"), previous);
  if (process.platform !== "win32") await fs.chmod(previous, 0o700);
  const installationFixture = path.join(scratch, "installation-fixture.json");
  await cargo([
    "test", "--offline", "--manifest-path", manifest, "--test", "backup_worker", "--",
    "--ignored", "--exact", "update_installer_commit_fixture",
  ], snapshot, { OXIDE_UPDATE_INSTALL_FIXTURE: installationFixture });
  await fs.writeFile(manifest, source.replace(match[0], `version = "${next}"`));
  console.log(`Backup upgrade evidence: ${scratch}; previous ${match[0]}, successor ${next}`);
  await cargo([
    "test", "--offline", "--manifest-path", manifest, "--test", "backup_worker", "--",
    "--ignored", "--exact", "cooperative_worker_upgrade_finishes_current_copy_before_successor_claims_queue",
  ], snapshot, { OXIDE_BACKUP_PREVIOUS_WORKER: previous });
  await cargo([
    "test", "--offline", "--manifest-path", manifest, "--test", "backup_worker", "--",
    "--ignored", "--exact", "updated_worker_resumes_committed_installation_only_after_actual_version_changes",
  ], snapshot, { OXIDE_UPDATE_INSTALL_FIXTURE: installationFixture });
} finally {
  if (outputsChanged) await cargo(["build", "--offline", "--manifest-path", path.join(root, "src-tauri/Cargo.toml"), "--bins"], root);
  console.log(`Backup upgrade source copy retained for review: ${scratch}`);
}
