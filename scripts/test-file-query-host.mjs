// Actual native Host/session lifecycle acceptance with a fresh local signing
// key, exercising production signature resolution and process launch.
// No release key, global driver installation or Desktop UI is involved.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "oxide-file-query-host-"));
const driver = path.join(root, "src-tauri/crates/oxide-driver-duckdb");
const binary = path.join(driver, "target/debug", `oxide-driver-duckdb${process.platform === "win32" ? ".exe" : ""}`);
const env = { ...process.env, CARGO_INCREMENTAL: "0", CARGO_BUILD_JOBS: "4", CARGO_PROFILE_DEV_DEBUG: "0", CARGO_PROFILE_TEST_DEBUG: "0", PROTOC: "C:/oxide-file-query-headless-must-not-use-protoc.exe" };
delete env.TAURI_CONFIG;
for (const name of Object.keys(env)) if (/^(TAURI_SIGNING_|OXIDE_DRIVER_SIGNING_|OXIDE_FILE_QUERY_TEST_)/.test(name)) delete env[name];
const key = path.join(directory, "ephemeral-signing.key");
const registry = path.join(directory, "signed-drivers");
const cli = path.join(root, "node_modules/@tauri-apps/cli/tauri.js");
const evidence = { success: false, scope: "native-host-file-session-lifecycle", packageTrust: "fresh local minisign key and production Registry::new", productionSignatureResolutionTested: false, signedInstallationUiTested: false, desktopUiTested: false };

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function run(command, args, label, environment, quiet = false) {
  const log = await fs.open(path.join(directory, `${label}.log`), "w");
  let code;
  try {
    code = await new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd: root, env: environment, windowsHide: true, stdio: ["ignore", quiet ? "ignore" : log.fd, quiet ? "ignore" : log.fd] });
      child.once("error", reject);
      child.once("close", resolve);
    });
  } finally { await log.close(); }
  assert.equal(code, 0, `${label} failed; inspect its log`);
  return fs.readFile(path.join(directory, `${label}.log`), "utf8");
}

try {
  await run("cargo", ["build", "--locked", "--offline", "--manifest-path", path.join(driver, "Cargo.toml")], "build-driver", { ...env, CARGO_TARGET_DIR: path.join(driver, "target") });
  evidence.driverSha256 = await sha256(binary);
  await run(process.execPath, [cli, "signer", "generate", "--ci", "-p", "", "-w", key], "generate-key", env, true);
  env.OXIDE_DRIVER_SIGNING_PUBLIC_KEY = Buffer.from((await fs.readFile(`${key}.pub`, "utf8")).trim(), "base64").toString("utf8").trim();
  assert.ok(env.OXIDE_DRIVER_SIGNING_PUBLIC_KEY.startsWith("untrusted comment:"));
  const target = execFileSync("rustc", ["-vV"], { encoding: "utf8", windowsHide: true }).match(/^host:\s*(.+)$/m)?.[1]?.trim();
  assert.ok(target);
  for (const version of ["0.1.0", "0.1.1"]) {
    const destination = path.join(registry, "duckdb", version);
    await run(process.execPath, [path.join(root, "scripts/package-duckdb-driver.mjs"), "--target", target, "--binary", binary, "--version", version, "--out", destination], `package-${version}`, env);
    const manifest = path.join(destination, "manifest.json");
    if (version === "0.1.1") {
      const noGrant = JSON.parse(await fs.readFile(manifest, "utf8"));
      noGrant.capabilities.fileQueryFormats = [];
      await fs.writeFile(manifest, `${JSON.stringify(noGrant, null, 2)}\n`);
    }
    await run(process.execPath, [cli, "signer", "sign", "-f", key, "-p", "", manifest], `sign-${version}`, env);
    const signature = Buffer.from((await fs.readFile(`${manifest}.sig`, "utf8")).trim(), "base64").toString("utf8");
    assert.ok(signature.startsWith("untrusted comment:"));
    await fs.writeFile(`${manifest}.minisig`, signature);
  }
  const build = await run("cargo", ["test", "--locked", "--offline", "--manifest-path", path.join(root, "src-tauri/Cargo.toml"), "--no-default-features", "--lib", "--no-run", "--message-format=json"], "build-host-tests", { ...env, CARGO_TARGET_DIR: path.join(root, "src-tauri/target") });
  const artifacts = build.split(/\r?\n/).filter((line) => line.startsWith("{")).map((line) => JSON.parse(line))
    .filter((item) => item.reason === "compiler-artifact" && item.target?.name === "oxide_studio_lib" && item.profile?.test && item.executable);
  assert.equal(artifacts.length, 1, "expected one actual library test executable");
  const executable = artifacts[0].executable;
  evidence.hostTestSha256 = await sha256(executable);
  const output = await run(executable, ["file_query_live_host_", "--ignored", "--test-threads=1", "--nocapture"], "native-host-lifecycle", { ...env, OXIDE_FILE_QUERY_TEST_BINARY: binary, OXIDE_FILE_QUERY_TEST_SIGNED_REGISTRY: registry });
  const summary = output.match(/test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored;/);
  assert.deepEqual(summary?.slice(1), ["2", "0", "0"]);
  evidence.passed = 2;
  evidence.productionSignatureResolutionTested = true;
  evidence.failed = 0;
  evidence.ignored = 0;
  evidence.coverage = ["manifest-format-denial", "project-and-window-scope", "four-session-budget", "cancelled-open-ticket", "SQL-error-keeps-session", "query-deadline-kills-and-cleans", "abandoned-query-cleanup", "window-close-during-query", "abandoned-open-cleanup", "Host-EOF-stops-running-query", "driver-lease-before-cleanup", "startup-reclaims-owned-orphan", "source-unchanged"];
  evidence.success = true;
  evidence.coverage.unshift("production-signature-and-digest", "tampered-manifest-denial");
  evidence.coverage.push("CSV-JSON-JSONL-Parquet-under-cleared-Host-environment");
} catch (error) {
  evidence.failure = error.message;
  process.exitCode = 1;
} finally {
  for (const ownedKey of [key, `${key}.pub`]) {
    await fs.unlink(ownedKey).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
  evidence.ephemeralKeyRemoved = true;
  await fs.writeFile(path.join(directory, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ directory, ...evidence }, null, 2));
}
