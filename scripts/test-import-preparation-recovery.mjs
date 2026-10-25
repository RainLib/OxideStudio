// Actual bounded JSON normalization -> kill owned child -> new-process cleanup.
// The interrupted preparation is reclaimed; this is not cursor resumption.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "oxide-import-preparation-"));
const env = { ...process.env, CARGO_PROFILE_DEV_DEBUG: "0", CARGO_PROFILE_TEST_DEBUG: "0", CARGO_INCREMENTAL: "0", CARGO_BUILD_JOBS: "4", TAURI_CONFIG: JSON.stringify({ bundle: { externalBin: [] } }) };
delete env.PROTOC;
const nativeEnv = { ...env, TEMP: directory, TMP: directory, TMPDIR: directory, OXIDE_IMPORT_PREPARATION_EVIDENCE_DIR: directory };
const evidence = { success: false, scope: "native-library-import-preparation-cleanup", desktopIpcTested: false, cursorResumptionTested: false, platform: `${process.platform}-${process.arch}` };
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
  const args = ["commands::table::tests::import_jobs_native::import_preparation_process_helper", "--ignored", "--exact", "--nocapture", "--test-threads=1"];
  const initialLog = await fs.open(path.join(directory, "initial.log"), "w");
  let fixture, fixtureRoot, workspace;
  try {
    start(executable, args, { ...nativeEnv, OXIDE_IMPORT_PREPARATION_ATTEMPT: "initial" }, initialLog.fd);
    fixture = await waitFor(() => readJson(path.join(directory, "fixture.json")));
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
    child.kill();
    const exit = await completion;
    assert.ok(exit.code !== 0 || exit.signal, "initial process must be forcibly terminated");
    evidence.forcedTermination = { ...exit, phase: observed.phase, sourceBytes: observed.source_bytes, normalizedRows: observed.normalized_rows };
    assert.equal((await fs.stat(workspace)).isDirectory(), true, "crashed workspace must exist before recovery");
  } finally { await initialLog.close(); }
  const recoveryLog = await fs.open(path.join(directory, "recovery.log"), "w");
  try {
    start(executable, args, { ...nativeEnv, OXIDE_IMPORT_PREPARATION_ATTEMPT: "recover" }, recoveryLog.fd);
    const deadline = new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("recovery deadline exceeded")), 120000); timer.unref(); });
    assert.equal((await Promise.race([completion, deadline])).code, 0);
    assert.match(await fs.readFile(path.join(directory, "recovery.log"), "utf8"), /1 passed; 0 failed; 0 ignored/);
  } finally { await recoveryLog.close(); }
  Object.assign(evidence, await readJson(path.join(directory, "native-evidence.json")));
  for (const name of ["workspaceReclaimed", "sourceUnchanged", "targetUnchanged", "noReadyJobCreated"]) assert.equal(evidence[name], true, name);
  await assert.rejects(fs.stat(workspace), { code: "ENOENT" });
  for (const name of ["source.json", "target.sqlite"]) {
    const file = path.join(fixtureRoot, name);
    assert.equal(path.dirname(await fs.realpath(file)), fixtureRoot);
    assert.ok((await fs.lstat(file)).isFile());
    await fs.unlink(file);
  }
  evidence.fixtureFilesRemoved = true;
  evidence.success = true;
} catch (error) { evidence.error = error.stack ?? String(error); process.exitCode = 1; }
finally {
  if (child && child.exitCode === null && child.signalCode === null) { child.kill(); await completion; }
  await fs.writeFile(path.join(directory, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify({ evidence: path.join(directory, "evidence.json"), ...evidence }, null, 2));
}
