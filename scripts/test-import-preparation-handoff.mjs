// Actual bounded CSV/JSON/XLSX normalization -> forced termination -> new-process cursor recovery.
// Replays and validates the committed prefix, then appends and publishes once.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { nativeProcessMemory } from "./lib/native-process-memory.mjs";

const argv = process.argv.slice(2);
assert.ok(argv.length === 0 || (argv.length === 2 && argv[0] === "--format"), "usage: --format csv|json|xlsx");
const format = argv[1] ?? "json";
assert.ok(["csv", "json", "xlsx"].includes(format), "unsupported import format");
const sourceFile = `source.${format}`, offlineFile = `source.offline.${format}`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = await fs.mkdtemp(path.join(os.tmpdir(), `oxide-import-preparation-handoff-${format}-`));
const env = { ...process.env, CARGO_PROFILE_DEV_DEBUG: "0", CARGO_PROFILE_TEST_DEBUG: "0", CARGO_INCREMENTAL: "0", CARGO_BUILD_JOBS: "4", TAURI_CONFIG: JSON.stringify({ bundle: { externalBin: [] } }) };
delete env.PROTOC;
const nativeEnv = { ...env, TEMP: directory, TMP: directory, TMPDIR: directory, OXIDE_IMPORT_PREPARATION_EVIDENCE_DIR: directory, OXIDE_IMPORT_PREPARATION_FORMAT: format };
const evidence = { success: false, format, stagingInterruptionTested: format !== "json", scope: "native-library-preparation-target-and-handoff", desktopIpcTested: false, cursorResumptionTested: true, readyHandoffInterruptionTested: true, platform: `${process.platform}-${process.arch}` };
let child, completion;
function start(command, args, environment, output, error = output) {
  child = spawn(command, args, { cwd: root, env: environment, windowsHide: true, stdio: ["ignore", output, error] });
  completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}
async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT" || error instanceof SyntaxError) return null; throw error; }
}
async function waitFor(observe) {
  const deadline = Date.now() + 10 * 60000;
  while (true) {
    const value = await observe();
    if (value) return value;
    assert.ok(child.exitCode === null && child.signalCode === null, "child exited before interruption checkpoint; inspect initial.log");
    assert.ok(Date.now() < deadline, "preparation fixture deadline exceeded");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
async function memory(pid) {
  const owned = child;
  assert.equal(owned.pid, pid);
  return nativeProcessMemory(pid, {
    isAlive: () => owned.exitCode === null && owned.signalCode === null,
    onRetry: value => (evidence.memoryObservationRetries ??= []).push(value),
  });
}
function memoryGate(value) {if(value) assert.ok(value.peakWorkingSetBytes>0 && value.peakWorkingSetBytes<=256*1024*1024,"fixture working-set gate exceeded");}
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
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(executable)) hash.update(chunk);
  evidence.testExecutableSha256 = hash.digest("hex");
  const args = ["commands::table::tests::import_preparation_resume_native::import_preparation_resume_process_helper", "--ignored", "--exact", "--nocapture", "--test-threads=1"];
  const initialLog = await fs.open(path.join(directory, "initial.log"), "w");
  let fixture, fixtureRoot, workspace;
  try {
    start(executable, args, { ...nativeEnv, OXIDE_IMPORT_PREPARATION_ATTEMPT: "initial" }, initialLog.fd);
    fixture = await waitFor(() => readJson(path.join(directory, "fixture.json")));
    assert.equal(fixture.format, format);
    fixtureRoot = await fs.realpath(fixture.root);
    assert.equal(path.dirname(fixtureRoot), await fs.realpath(directory));
    assert.ok(!(await fs.lstat(fixtureRoot)).isSymbolicLink());
    const preparationRoot = path.join(fixtureRoot, "jobs", "import-preparations");
    const observed = await waitFor(async () => {
      const names = await fs.readdir(preparationRoot).catch((error) => { if (error.code === "ENOENT") return []; throw error; });
      for (const name of names.filter((name) => /^prep-[0-9a-f-]{36}$/.test(name))) {
        const owner = await readJson(path.join(preparationRoot, name, "owner.json"));
        if (!owner) continue;
        const record = JSON.parse(owner.body);
        if (record.phase === "normalizing" && record.normalized_rows >= 5000 && record.normalized_rows < fixture.rows) return { name, ...record };
      }
      return null;
    });
    workspace = path.join(preparationRoot, observed.name);
    assert.equal(path.dirname(await fs.realpath(workspace)), await fs.realpath(preparationRoot));
    assert.ok((await fs.stat(path.join(workspace, "normalized.sqlite"))).size > 0);
    evidence.initialMemory=await memory(child.pid); memoryGate(evidence.initialMemory);
    child.kill();
    const exit = await completion;
    assert.ok(exit.code !== 0 || exit.signal, "initial process must be forcibly terminated");
    evidence.forcedTermination = { ...exit, phase: observed.phase, sourceBytes: observed.source_bytes, normalizedRows: observed.normalized_rows };
    assert.equal((await fs.stat(workspace)).isDirectory(), true, "crashed workspace must exist before recovery");
  } finally { await initialLog.close(); }
  await fs.rename(path.join(fixtureRoot, sourceFile), path.join(fixtureRoot, offlineFile));
  const prepareLog = await fs.open(path.join(directory,"prepare.log"),"w");
  try {
    start(executable,args,{...nativeEnv,OXIDE_IMPORT_PREPARATION_ATTEMPT:"prepare"},prepareLog.fd);
    const ready=await waitFor(()=>readJson(path.join(directory,"handoff-ready.json")));
    assert.equal(ready.jobId,fixture.preparationId);
    assert.ok(ready.confirmationToken.startsWith("IMPORT "));
    evidence.preparationMemory=await memory(child.pid); memoryGate(evidence.preparationMemory);
    child.kill();
    const exit=await completion;
    assert.ok(exit.code!==0 || exit.signal);
    evidence.handoffForcedTermination={...exit,jobId:ready.jobId};
    assert.equal((await fs.stat(workspace)).isDirectory(),true,"ready crash must precede raw workspace cleanup");
  } finally {await prepareLog.close();}
  if (format !== "json") {
    const stagingLog = await fs.open(path.join(directory, "staging.log"), "w");
    try {
      start(executable, args, { ...nativeEnv, OXIDE_IMPORT_PREPARATION_ATTEMPT: "stage" }, stagingLog.fd);
      const staged = await waitFor(() => readJson(path.join(directory, "staging-ready.json")));
      assert.equal(staged.jobId, fixture.preparationId);
      assert.ok(staged.rowsStaged >= 1500 && staged.rowsStaged < fixture.rows);
      assert.equal(staged.targetRows, 0);
      evidence.stagingMemory = await memory(child.pid); memoryGate(evidence.stagingMemory);
      child.kill();
      const exit = await completion;
      assert.ok(exit.code !== 0 || exit.signal);
      evidence.stagingForcedTermination = { ...exit, ...staged };
    } finally { await stagingLog.close(); }
  }
  const finishLog=await fs.open(path.join(directory,"finish.log"),"w");
  try {
    start(executable,args,{...nativeEnv,OXIDE_IMPORT_PREPARATION_ATTEMPT:"finish",OXIDE_IMPORT_HANDOFF_MEASURE:"1"},finishLog.fd);
    await waitFor(async()=>{try{await fs.stat(path.join(directory,"measure-ready"));return true;}catch(error){if(error.code==="ENOENT")return null;throw error;}});
    evidence.publicationMemory=await memory(child.pid); memoryGate(evidence.publicationMemory);
    await fs.writeFile(path.join(directory,"measure-done"),"done");
    assert.equal((await completion).code,0);
    assert.match(await fs.readFile(path.join(directory,"finish.log"),"utf8"),/1 passed; 0 failed; 0 ignored/);
  } finally {await finishLog.close();}
  Object.assign(evidence, await readJson(path.join(directory, "native-evidence.json")));
  for (const name of ["workspaceReclaimed", "sourceUnchanged", "targetUnchangedBeforePublication", "noReadyJobBeforeResume", "sourceOffline", "allPayloadsAndPresenceVerified", "preparationResumed", "handoffRecovered", "sameReviewRecovered", "stableJobId", "optionsPreserved", "targetUnchangedDuringStaging"]) assert.equal(evidence[name], true, name);
  assert.equal(evidence.handoffJobCount,1);
  assert.equal(evidence.rows,1000001);
  assert.ok(evidence.normalizedRowsBefore >= 5000 && evidence.normalizedRowsBefore < 1000001);
  assert.equal(evidence.normalizedRowsBefore + evidence.appendedRows,1000001);
  assert.equal(evidence.providedRows,333334);
  assert.equal(evidence.explicitNullRows,format === "json" ? 333334 : 666667);
  assert.equal(evidence.defaultedRows,format === "json" ? 333333 : 0);
  assert.equal(evidence.unmappedDefaultRows,1000001);
  assert.equal(evidence.sharedStrings,format === "xlsx" ? 1000002 : 0);
  assert.equal(evidence.parserReplayFromStart,true);
  assert.ok(evidence.stagingRowsObserved >= 1500);
  if (format !== "json") {
    assert.equal(evidence.stagingResumed,true);
    assert.ok(evidence.stagedRowsBefore >= evidence.stagingForcedTermination.rowsStaged);
    assert.ok(evidence.stagedRowsBefore < fixture.rows);
  }
  await assert.rejects(fs.stat(workspace), { code: "ENOENT" });
  for (const name of [offlineFile, "target.sqlite"]) {
    const file = path.join(fixtureRoot, name);
    assert.equal(path.dirname(await fs.realpath(file)), fixtureRoot);
    assert.ok((await fs.lstat(file)).isFile());
    await fs.unlink(file);
  }
  evidence.fixtureFilesRemoved = true;
  evidence.fixturePeakWorkingSetBudgetBytes=256*1024*1024;
  evidence.success = true;
} catch (error) { evidence.error = error.stack ?? String(error); process.exitCode = 1; }
finally {
  if (child && child.exitCode === null && child.signalCode === null) { child.kill(); await completion; }
  await fs.writeFile(path.join(directory, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify({ evidence: path.join(directory, "evidence.json"), ...evidence }, null, 2));
}
