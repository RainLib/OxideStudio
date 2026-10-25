// Native file-query boundary acceptance; no Desktop, saved connection or release key.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { JsonFixtureProcess } from "./lib/headless-driver-fixture.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "oxide-file-query-acceptance-"));
const driverRoot = path.join(root, "src-tauri/crates/oxide-driver-duckdb");
const binary = path.join(driverRoot, "target/debug", `oxide-driver-duckdb${process.platform === "win32" ? ".exe" : ""}`);
const environment = { ...process.env, CARGO_TARGET_DIR: path.join(driverRoot, "target"), CARGO_INCREMENTAL: "0", CARGO_BUILD_JOBS: "4", CARGO_PROFILE_DEV_DEBUG: "0", CARGO_PROFILE_TEST_DEBUG: "0" };
const evidence = { success: false, scope: "native-file-query-sidecar", desktopEntryPointsTested: false, crashCleanupTested: false };
let processFixture;

async function hash(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function build() {
  const log = await fs.open(path.join(directory, "build.log"), "w");
  try {
    await new Promise((resolve, reject) => {
      const child = spawn("cargo", ["build", "--locked", "--offline", "--manifest-path", path.join(driverRoot, "Cargo.toml")], { cwd: root, env: environment, windowsHide: true, stdio: ["ignore", log.fd, log.fd] });
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Native build failed (${code}); see build.log`)));
    });
  } finally { await log.close(); }
}

async function query(statement) {
  const result = await processFixture.driver("query", { connection_id: "file", statement });
  assert.equal(result.kind, "query");
  return result.value;
}

function measureMemory(pid) {
  if (process.platform === "win32") {
    const result = execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", `$taskProcess=Get-Process -Id ${pid}; @{peakWorkingSetBytes=$taskProcess.PeakWorkingSet64;privateMemoryAtMeasurementBytes=$taskProcess.PrivateMemorySize64}|ConvertTo-Json -Compress`], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
    return JSON.parse(result);
  }
  return null;
}

try {
  await build();
  evidence.binarySha256 = await hash(binary);
  const source = path.join(directory, "million.csv");
  const offline = path.join(directory, "million.csv.offline");
  const rows = 1_000_001;
  const output = await fs.open(source, "wx");
  try {
    await output.write("id,payload\n");
    // Bounded generation; the source is over 100 MiB with real distinct IDs.
    for (let first = 0; first < rows; first += 5_000) {
      let block = "";
      for (let id = first; id < Math.min(rows, first + 5_000); id++) block += `${id},${"x".repeat(112)}\n`;
      await output.write(block);
    }
  } finally { await output.close(); }
  evidence.sourceBytes = (await fs.stat(source)).size;
  evidence.sourceSha256 = await hash(source);
  evidence.rows = rows;
  processFixture = new JsonFixtureProcess(binary, [], environment);
  const handshake = await processFixture.driver("handshake", { protocolVersion: "1.0", hostVersion: "0.1.18", packageId: "oxide.duckdb", driverId: "duckdb" });
  assert.equal(handshake.value.capabilities.fileQueries, true);
  const start = performance.now();
  await processFixture.driver("connect", { connection_id: "file", config: { url: source, options: { readOnly: "true", fileQueryFormat: "csv" } } });
  evidence.openMilliseconds = performance.now() - start;
  const snapshot = (await query("SELECT current_setting('allowed_paths')[1]"))[0].rows[0][0];
  assert.ok(path.basename(path.dirname(snapshot)).startsWith("oxide-file-query-"));
  assert.equal(path.resolve(path.dirname(path.dirname(snapshot))).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
  assert.equal(await hash(snapshot), evidence.sourceSha256);
  await fs.rename(source, offline);
  const result = await query("-- source is offline\n SELECT count(*), sum(id), min(id), max(id) FROM data");
  // DuckDB SUM(INTEGER) is HUGEINT, represented exactly as a protocol string.
  assert.deepEqual(result[0].rows, [[rows, String(BigInt(rows - 1) * BigInt(rows) / 2n), 0, rows - 1]]);
  const preview = await query("SELECT * FROM data ORDER BY id LIMIT 1001");
  assert.equal(preview[0].rows.length, 1000);
  assert.equal(preview[0].truncated, true);
  assert.equal(preview[0].rowLimit, 1000);
  const rejected = await processFixture.request("query", { connection_id: "file", statement: "CREATE TABLE forbidden(id INT)" });
  assert.equal(rejected.status, "error");
  assert.equal(rejected.result.code, "READ_ONLY_REJECTED");
  evidence.memory = measureMemory(processFixture.child.pid);
  if (process.platform === "win32") {
    evidence.fixturePeakWorkingSetBudgetBytes = 256 * 1024 * 1024;
    assert.ok(evidence.memory.peakWorkingSetBytes > 0 && evidence.memory.peakWorkingSetBytes <= evidence.fixturePeakWorkingSetBudgetBytes);
  }
  assert.equal(await hash(offline), evidence.sourceSha256);
  await processFixture.driver("disconnect", { connection_id: "file" });
  await assert.rejects(fs.stat(path.dirname(snapshot)), { code: "ENOENT" });
  await processFixture.driver("shutdown");
  await processFixture.close();
  assert.equal(processFixture.child.exitCode, 0);
  evidence.exitCode = 0;
  evidence.sourceOfflineQueryPassed = true;
  evidence.sourceUnchanged = true;
  evidence.snapshotRemovedOnDisconnect = true;
  evidence.elapsedMilliseconds = performance.now() - start;
  // Retain the small evidence and build log, not the generated large dataset.
  await fs.unlink(offline);
  evidence.success = true;
} catch (error) {
  evidence.failure = error.message;
  process.exitCode = 1;
} finally {
  if (processFixture && processFixture.child.exitCode === null) await processFixture.close();
  for (const name of ["million.csv", "million.csv.offline"]) {
    const generated = path.resolve(directory, name);
    assert.equal(path.dirname(generated), path.resolve(directory));
    await fs.unlink(generated).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
  await fs.writeFile(path.join(directory, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ directory, ...evidence }, null, 2));
}
