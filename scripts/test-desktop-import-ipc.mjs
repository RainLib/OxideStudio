// Manual acceptance on an interactive desktop; this is a real hidden WebView,
// not a browser mock or tauri::test runtime. Never opens the production profile.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

assert.equal(process.argv.length, 2, "no arguments expected");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "oxide-desktop-import-ipc-"));
const env = { ...process.env, CARGO_PROFILE_DEV_DEBUG: "0", CARGO_PROFILE_TEST_DEBUG: "0", CARGO_INCREMENTAL: "0", CARGO_BUILD_JOBS: "4", TAURI_CONFIG: JSON.stringify({ bundle: { externalBin: [] } }) };
delete env.PROTOC;
const evidence = { success: false, scope: "isolated-real-webview-production-import-commands", platform: `${process.platform}-${process.arch}`, nativePickerTested: false, installedPackageTested: false, frontendComponentsTested: false, forcedTerminationTested: false };
let child;
async function run(command, args, output, error = output, timeout = 180000) {
  child = spawn(command, args, { cwd: root, env, windowsHide: true, stdio: ["ignore", output, error] });
  const owned = child;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; owned.kill(); }, timeout);
  try {
    const exit = await new Promise((resolve, reject) => {
      owned.once("error", reject);
      owned.once("close", (code, signal) => resolve({ code, signal }));
    });
    assert.equal(timedOut, false, "acceptance deadline exceeded");
    assert.equal(exit.code, 0, `child failed: ${JSON.stringify(exit)}`);
    return exit;
  } finally { clearTimeout(timer); }
}
try {
  const build = await fs.open(path.join(directory, "build.log"), "w");
  const artifacts = await fs.open(path.join(directory, "build-artifacts.jsonl"), "w");
  try {
    await run("cargo", ["test", "--locked", "--offline", "--manifest-path", "src-tauri/Cargo.toml", "--test", "desktop_import_ipc", "--no-run", "--message-format=json"], artifacts.fd, build.fd, 20 * 60000);
  } finally { await build.close(); await artifacts.close(); }
  let executable;
  for await (const line of createInterface({ input: createReadStream(path.join(directory, "build-artifacts.jsonl")), crlfDelay: Infinity })) {
    const item = JSON.parse(line);
    if (item.reason === "compiler-artifact" && item.target.name === "desktop_import_ipc" && item.executable) executable = item.executable;
  }
  assert.ok(executable, "native test executable missing");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(executable)) hash.update(chunk);
  evidence.executableSha256 = hash.digest("hex");
  evidence.processes = [];
  for (const stage of ["prepare", "resume"]) {
    const log = await fs.open(path.join(directory, `${stage}.log`), "w");
    let exit;
    try { exit = await run(executable, ["--run-native-ipc", directory, stage], log.fd); }
    finally { await log.close(); }
    const receipt = JSON.parse(await fs.readFile(path.join(directory, `${stage}-receipt.json`), "utf8"));
    assert.equal(receipt.success, true);
    assert.equal(receipt.realWebviewIpc, true);
    assert.equal(receipt.stage, stage);
    assert.equal(receipt.sourceRows, 1501);
    assert.equal(receipt.projectIsolationVerified, true);
    assert.equal(receipt.reviewRejectionVerified, true);
    if (stage === "prepare") {
      assert.equal(receipt.targetBefore.count, 1);
      assert.equal(receipt.cancellationVerified, true);
      const source = path.join(directory, "source-雪 & café.json");
      const sourceStat = await fs.lstat(source);
      assert.ok(sourceStat.isFile() && !sourceStat.isSymbolicLink());
      await fs.rename(source, path.join(directory, "source.offline.json"));
    } else {
      assert.equal(receipt.targetAfter.count, 1502);
      assert.equal(receipt.targetAfter.allValuesVerified, true);
      for (const key of ["restoredReviewVerified", "offlineSourceVerified", "duplicateStartIdempotent"]) assert.equal(receipt[key], true);
      const prepared = evidence.processes[0].receipt;
      assert.equal(receipt.jobId, prepared.jobId);
    }
    evidence.processes.push({ stage, exit, receipt });
  }
  // Exact known fixture files only. Keep ledgers, receipts and WebView profile
  // for diagnosis; no recursive removal or user application-data traversal.
  evidence.removedFixtureFiles = [];
  for (const name of ["target.sqlite", "source.offline.json"]) {
    const file = path.join(directory, name);
    assert.equal(path.dirname(await fs.realpath(file)), await fs.realpath(directory));
    const stat = await fs.lstat(file);
    assert.ok(stat.isFile() && !stat.isSymbolicLink());
    await fs.unlink(file);
    evidence.removedFixtureFiles.push({ name, bytes: stat.size });
  }
  evidence.success = true;
} catch (error) {
  evidence.error = error.stack ?? String(error);
  process.exitCode = 1;
} finally {
  if (child?.exitCode === null && child.signalCode === null) child.kill();
  await fs.writeFile(path.join(directory, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ directory, ...evidence }, null, 2));
}
