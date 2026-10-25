// Real file -> normalization -> authenticated job -> forced termination ->
// new-process recovery -> atomic SQLite publication. No Desktop IPC.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "oxide-resumable-import-"));
const env = { ...process.env, CARGO_PROFILE_DEV_DEBUG: "0", CARGO_PROFILE_TEST_DEBUG: "0", CARGO_INCREMENTAL: "0", CARGO_BUILD_JOBS: "4", TAURI_CONFIG: JSON.stringify({ bundle: { externalBin: [] } }) };
delete env.PROTOC;
const nativeEnv = { ...env, TEMP: directory, TMP: directory, TMPDIR: directory, OXIDE_RESUMABLE_IMPORT_EVIDENCE_DIR: directory };
const evidence = { success: false, scope: "native-library-resumable-file-import", desktopIpcTested: false, platform: `${process.platform}-${process.arch}`, rustVersion: execFileSync("rustc", ["--version"], { encoding: "utf8", windowsHide: true }).trim() };
let child, completion;
const exists = async (file) => { try { await fs.stat(file); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } };
const start = (command, args, environment, output, error) => {
  child = spawn(command, args, { cwd: root, env: environment, windowsHide: true, stdio: ["ignore", output, error] });
  completion = new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal })); });
};
async function waitMarker(name, minutes) {
  const deadline = Date.now() + minutes * 60000;
  while (true) {
    try { return JSON.parse(await fs.readFile(path.join(directory, name), "utf8")); } catch (error) { if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error; }
    assert.ok(child.exitCode === null && child.signalCode === null, `child exited before ${name}; inspect logs`);
    assert.ok(Date.now() < deadline, `${name} deadline exceeded`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
async function memory(pid) {
  if (process.platform === "win32") return JSON.parse(execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", `$fixtureProcess=Get-Process -Id ${pid}; @{peakWorkingSetBytes=$fixtureProcess.PeakWorkingSet64;privateMemoryAtMeasurementBytes=$fixtureProcess.PrivateMemorySize64}|ConvertTo-Json -Compress`], { encoding: "utf8", windowsHide: true, timeout: 10000 }));
  if (process.platform === "linux") {
    const status = await fs.readFile(`/proc/${pid}/status`, "utf8");
    return { peakWorkingSetBytes: Number(status.match(/^VmHWM:\s+(\d+) kB/m)?.[1]) * 1024 };
  }
  return null;
}
function memoryGate(value) { if (value) assert.ok(value.peakWorkingSetBytes > 0 && value.peakWorkingSetBytes <= 256 * 1024 * 1024, "fixture working-set gate exceeded"); }
try {
  const build = await fs.open(path.join(directory, "build.log"), "w"), artifacts = await fs.open(path.join(directory, "build-artifacts.jsonl"), "w");
  try {
    start("cargo", ["test", "--locked", "--offline", "--manifest-path", "src-tauri/Cargo.toml", "--lib", "--no-run", "--message-format=json"], env, artifacts.fd, build.fd);
    assert.equal((await completion).code, 0, "library test build failed");
  } finally { await build.close(); await artifacts.close(); }
  let executable;
  for await (const line of createInterface({ input: createReadStream(path.join(directory, "build-artifacts.jsonl")), crlfDelay: Infinity })) {
    const item = JSON.parse(line);
    if (item.reason === "compiler-artifact" && item.target.name === "oxide_studio_lib" && item.profile.test && item.executable) executable = item.executable;
  }
  assert.ok(executable);
  const hash = createHash("sha256"); for await (const chunk of createReadStream(executable)) hash.update(chunk); evidence.testExecutableSha256 = hash.digest("hex");
  const args = ["commands::table::tests::import_jobs_native::resumable_import_process_helper", "--ignored", "--exact", "--nocapture", "--test-threads=1"];
  const initialLog = await fs.open(path.join(directory, "initial.log"), "w");
  try {
    start(executable, args, { ...nativeEnv, OXIDE_RESUMABLE_IMPORT_ATTEMPT: "initial" }, initialLog.fd, initialLog.fd);
    const progress = await waitMarker("kill-ready.json", 20);
    assert.ok(progress.rowsStaged >= 500 && progress.rowsStaged < 1000001);
    assert.equal(progress.targetRowsBeforePublication, 0);
    evidence.initialMemory = await memory(child.pid); memoryGate(evidence.initialMemory);
    child.kill(); const exit = await completion;
    assert.ok(exit.code !== 0 || exit.signal, "initial process must be terminated before normal completion");
    evidence.forcedTermination = { ...exit, observedRowsStaged: progress.rowsStaged, targetRowsBeforePublication: 0 };
  } finally { await initialLog.close(); }
  const fixture = JSON.parse(await fs.readFile(path.join(directory, "fixture.json"), "utf8"));
  const fixtureRoot = await fs.realpath(fixture.root);
  assert.equal(path.dirname(fixtureRoot), await fs.realpath(directory), "fixture root must remain inside this runner's dedicated directory");
  assert.ok(!(await fs.lstat(fixtureRoot)).isSymbolicLink());
  const original = path.join(fixtureRoot, "source.json"), offline = path.join(fixtureRoot, "source.offline.json");
  assert.equal(await fs.realpath(path.dirname(original)), fixtureRoot);
  assert.equal(await exists(offline), false);
  await fs.rename(original, offline);
  const resumeLog = await fs.open(path.join(directory, "resume.log"), "w");
  try {
    start(executable, args, { ...nativeEnv, OXIDE_RESUMABLE_IMPORT_ATTEMPT: "resume" }, resumeLog.fd, resumeLog.fd);
    const deadline = Date.now() + 20 * 60000;
    while (!await exists(path.join(directory, "measure-ready"))) {
      assert.ok(child.exitCode === null && child.signalCode === null, "resume child exited before measurement; inspect resume.log");
      assert.ok(Date.now() < deadline, "resume fixture deadline exceeded");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    evidence.resumeMemory = await memory(child.pid); memoryGate(evidence.resumeMemory);
    await fs.writeFile(path.join(directory, "measure-done"), "done");
    const exit = await completion; assert.equal(exit.code, 0);
    assert.match(await fs.readFile(path.join(directory, "resume.log"), "utf8"), /1 passed; 0 failed; 0 ignored/);
  } finally { await resumeLog.close(); }
  Object.assign(evidence, JSON.parse(await fs.readFile(path.join(directory, "native-evidence.json"), "utf8")));
  for (const name of ["allPayloadsVerified", "targetUnchangedAfterKill", "originalSourceOffline", "mappingRecovered", "presenceBitmapsRecovered", "sourceUnchanged"]) assert.equal(evidence[name], true, name);
  assert.equal(evidence.providedRows, 333334); assert.equal(evidence.explicitNullRows, 333334); assert.equal(evidence.defaultedRows, 333333);
  assert.equal(evidence.rows, 1000001); assert.equal(evidence.batches, 2001);
  // Delete only these exact owned large fixture files after both processes exit.
  for (const name of ["source.offline.json", "target.sqlite"]) {
    const file = path.join(fixtureRoot, name);
    assert.equal(path.dirname(await fs.realpath(file)), fixtureRoot);
    assert.ok((await fs.lstat(file)).isFile());
    await fs.unlink(file);
  }
  assert.equal(await exists(path.join(fixtureRoot, "source.json")), false);
  const remaining = await fs.readdir(directory);
  assert.deepEqual(remaining.filter((name) => name.startsWith(".tmp")), [path.basename(fixtureRoot)], "normalization temporary directory survived");
  evidence.fixtureFilesRemoved = true; evidence.fixturePeakWorkingSetBudgetBytes = 256 * 1024 * 1024;
  evidence.success = true;
} catch (error) { evidence.error = error.stack ?? String(error); process.exitCode = 1; }
finally {
  if (child && child.exitCode === null && child.signalCode === null) { child.kill(); await completion; }
  await fs.writeFile(path.join(directory, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify({ evidence: path.join(directory, "evidence.json"), ...evidence }, null, 2));
}
