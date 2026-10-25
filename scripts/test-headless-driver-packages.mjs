// Signed native CLI -> production sidecar acceptance. All keys, package stores,
// profiles and database files belong to this temporary fixture; nothing publishes.
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { copySource, sha256 } from "./lib/desktop-update-fixture.mjs";
import { JsonFixtureProcess, profileFixture, rqliteHttpFixture } from "./lib/headless-driver-fixture.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "oxide-headless-drivers-"));
const snapshot = path.join(directory, "source");
const originalTarget = path.resolve(process.env.CARGO_TARGET_DIR || path.join(root, "src-tauri/target"));
const target = path.resolve(process.env.OXIDE_HEADLESS_DRIVER_TARGET_DIR || path.join(originalTarget, "headless-driver-acceptance"));
const shared = target.toLowerCase() === originalTarget.toLowerCase();
const extension = process.platform === "win32" ? ".exe" : "";
const rustTarget = execFileSync("rustc", ["-vV"], { encoding: "utf8" }).match(/^host:\s*(.+)$/m)?.[1]?.trim();
assert.ok(rustTarget, "A native Rust target is required");
const cli = path.join(root, "node_modules/@tauri-apps/cli/tauri.js");
const appVersion = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")).version;
const environment = { ...process.env, CARGO_TARGET_DIR: target, CARGO_INCREMENTAL: "0", CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS || "4", CARGO_PROFILE_DEV_DEBUG: "0", CARGO_PROFILE_TEST_DEBUG: "0" };
for (const name of Object.keys(environment)) if (/^(TAURI_SIGNING_|OXIDE_DRIVER_SIGNING_|OXIDE_HEADLESS_DRIVER_)/.test(name) || name === "TAURI_CONFIG") delete environment[name];
const cargo = process.platform === "win32" ? "cargo.exe" : "cargo";
let changed = false, server, profile;
async function run(command, args, label, options = {}) {
  process.stdout.write(`Signed driver acceptance: ${label}\n`);
  const log = createWriteStream(path.join(directory, `${label}.log`));
  const child = spawn(command, args, { cwd: snapshot, env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], ...options });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  const status = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  log.end();
  assert.equal(status, 0, `${label} failed; inspect ${path.join(directory, `${label}.log`)}`);
}
async function restore() {
  if (!shared || !changed) return;
  await run(cargo, ["build", "--offline", "--no-default-features", "--manifest-path", path.join(root, "src-tauri/Cargo.toml"), "--bin", "oxide-agent"], "restore-original-agent", {
    cwd: root, env: { ...process.env, CARGO_TARGET_DIR: originalTarget, CARGO_INCREMENTAL: "0", CARGO_PROFILE_DEV_DEBUG: "0", CARGO_PROFILE_TEST_DEBUG: "0" },
  });
  changed = false;
}
try {
  await copySource(root, snapshot);
  const key = path.join(directory, "fixture-signing.key");
  await run(process.execPath, [cli, "signer", "generate", "--ci", "-p", "", "-w", key], "generate-ephemeral-key");
  const updaterKey = (await fs.readFile(`${key}.pub`, "utf8")).trim();
  const driverKey = Buffer.from(updaterKey, "base64").toString("utf8").trim();
  assert.ok(driverKey.startsWith("untrusted comment:"), "Decode the updater key wrapper into the registry's minisign public-key format");
  environment.OXIDE_DRIVER_SIGNING_PUBLIC_KEY = driverKey;
  changed = true;
  await run(cargo, ["build", "--offline", "--no-default-features", "--manifest-path", path.join(snapshot, "src-tauri/Cargo.toml"), "--bin", "oxide-agent"], "build-trusted-fixture-cli");
  const agent = path.join(directory, `fixture-agent${extension}`);
  await fs.copyFile(path.join(target, "debug", `oxide-agent${extension}`), agent);
  if (process.platform !== "win32") await fs.chmod(agent, 0o755);
  assert.equal(execFileSync(agent, ["--version"], { encoding: "utf8", windowsHide: true }).trim(), `oxide-agent ${appVersion}`);
  await restore();
  const registry = path.join(directory, "selected-registry");
  await fs.mkdir(registry);
  profile = await profileFixture(directory, registry);
  server = await rqliteHttpFixture(directory);
  const rqliteManifest = path.join(snapshot, "src-tauri/crates/oxide-driver-rqlite/Cargo.toml");
  const rqliteSource = path.join(snapshot, "src-tauri/crates/oxide-driver-rqlite/src/main.rs");
  const originalManifest = await fs.readFile(rqliteManifest, "utf8"), originalSource = await fs.readFile(rqliteSource, "utf8");
  async function sign(manifest) {
    await run(process.execPath, [cli, "signer", "sign", "-f", key, "-p", "", manifest], `sign-${path.basename(path.dirname(manifest))}`);
    const signature = Buffer.from((await fs.readFile(`${manifest}.sig`, "utf8")).trim(), "base64").toString("utf8");
    assert.ok(signature.startsWith("untrusted comment:"), "The registry requires an actual minisign signature");
    await fs.writeFile(`${manifest}.minisig`, signature);
  }
  async function packageRqlite(version, readOnly = true) {
    await fs.writeFile(rqliteManifest, originalManifest.replace(/^version\s*=\s*"[^"]+"/m, `version = "${version}"`));
    await fs.writeFile(rqliteSource, readOnly ? originalSource : originalSource.replace("read_only_enforcement: true", "read_only_enforcement: false"));
    await run(cargo, ["build", "--offline", "--manifest-path", rqliteManifest], `build-rqlite-${version}`);
    const destination = path.join(registry, "rqlite", version);
    await run(process.execPath, [path.join(root, "scripts/package-rqlite-driver.mjs"), "--target", rustTarget, "--version", version, "--binary", path.join(target, "debug", `oxide-driver-rqlite${extension}`), "--out", destination], `package-rqlite-${version}`);
    await sign(path.join(destination, "manifest.json"));
    return destination;
  }
  const a = await packageRqlite("0.1.0");
  await packageRqlite("0.1.1"); await packageRqlite("0.1.2", false);
  await fs.writeFile(path.join(registry, "rqlite/current"), "0.1.1\n");
  async function call(name, input, { database = "main", fail, timeout = "5" } = {}) {
    const file = path.join(directory, "request.json");
    await fs.writeFile(file, JSON.stringify(input));
    const child = spawn(agent, ["tools", "call", name, "--input", `@${file}`, ...profile.args(database), "--query-timeout-secs", timeout], { env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
    const result = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    if (fail) { assert.notEqual(result, 0); assert.match(stderr, fail); assert.equal(stdout, ""); return; }
    assert.equal(result, 0, stderr); return JSON.parse(stdout);
  }
  const query = { sql: "SELECT id, name FROM items ORDER BY id", maxRows: 2 };
  profile.configure("rqlite", { url: server.url, database: "main", driverPackageVersion: "0.1.0" });
  assert.equal((await call("query.runReadOnly", query)).data.driverPackageVersion, "0.1.0");
  profile.configure("rqlite", { url: server.url, database: "main" });
  const rows = await call("query.runReadOnly", query);
  assert.equal(rows.data.driverPackageVersion, "0.1.1"); assert.equal(rows.data.rowCount, 2); assert.equal(rows.data.truncated, true);
  const live = await call("metadata.inspectLive", { kind: "columns", schema: "main", relation: "items" });
  assert.deepEqual(live.data.objects.map((column) => column.name), ["id", "name"]);
  const mcp = new JsonFixtureProcess(agent, ["mcp", "stdio", ...profile.args()], environment);
  try {
    const initialized = await mcp.request("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "signed-driver-fixture", version: "1" } }, true);
    assert.equal(initialized.result.serverInfo.name, "oxide-agent");
    mcp.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    const reply = await mcp.request("tools/call", { name: "query.runReadOnly", arguments: query }, true);
    assert.equal(reply.result.structuredContent.data.driverPackageVersion, "0.1.1");
  } finally { await mcp.close(); }
  const before = server.state.requests.length;
  await call("query.runReadOnly", { sql: "DELETE FROM items" }, { fail: /read.only|SELECT/i });
  await call("query.runReadOnly", { sql: "SELECT * FROM outside.items" }, { fail: /outside|ambiguous/ });
  assert.equal(server.state.requests.length, before);
  profile.configure("rqlite", { url: server.url, driverPackageVersion: "0.1.2" });
  await call("metadata.inspectLive", { kind: "relations", schema: "main" }, { fail: /does not enforce/ });
  assert.equal(server.state.requests.length, before, "A non-read-only handshake must not receive connection secrets or contact the source");
  profile.configure("rqlite", { url: server.url, driverPackageVersion: "0.1.0" });
  const manifestA = path.join(a, "manifest.json"), originalA = await fs.readFile(manifestA);
  const modified = JSON.parse(originalA); modified.displayName = "tampered";
  await fs.writeFile(manifestA, JSON.stringify(modified));
  await call("metadata.inspectLive", { kind: "relations", schema: "main" }, { fail: /signature|trusted/ });
  await fs.writeFile(manifestA, originalA);
  const entry = path.join(a, JSON.parse(originalA).entrypoint), bytesA = await fs.readFile(entry);
  await fs.appendFile(entry, "tampered");
  await call("query.runReadOnly", query, { fail: /digest/ });
  await fs.writeFile(entry, bytesA);
  const fileContract = JSON.parse(originalA); fileContract.capabilities.connectionMode = "file";
  await fs.writeFile(manifestA, JSON.stringify(fileContract)); await sign(manifestA);
  await call("metadata.inspectLive", { kind: "relations", schema: "main" }, { fail: /read.only connections/ });
  await fs.writeFile(manifestA, originalA); await sign(manifestA);
  assert.equal(server.state.requests.length, before);
  profile.configure("sqlite", { url: server.source, database: server.source });
  await fs.mkdir(path.join(registry, "sqlite"));
  await fs.writeFile(path.join(registry, "sqlite/activation.json"), '{"current":"9.9.9"}');
  await call("query.runReadOnly", query, { fail: /not installed/ });
  await fs.writeFile(path.join(registry, "sqlite/activation.json"), "{");
  await call("query.runReadOnly", query, { fail: /activation/ });
  profile.configure("rqlite", { url: server.url });
  server.state.delay = 2_000;
  await call("query.runReadOnly", query, { timeout: "1", fail: /deadline/ });
  server.state.delay = 0;
  const duckManifest = path.join(root, "src-tauri/crates/oxide-driver-duckdb/Cargo.toml");
  const duckVersion = (await fs.readFile(duckManifest, "utf8")).match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  assert.ok(duckVersion);
  const duckTarget = path.join(root, "src-tauri/crates/oxide-driver-duckdb/target");
  await run(cargo, ["build", "--offline", "--manifest-path", duckManifest], "build-real-duckdb", { cwd: root, env: { ...environment, CARGO_TARGET_DIR: duckTarget, CARGO_BUILD_JOBS: "2" } });
  const duckBinary = path.join(duckTarget, "debug", `oxide-driver-duckdb${extension}`), duckSource = path.join(directory, "source.duckdb");
  const seed = new JsonFixtureProcess(duckBinary);
  try {
    await seed.driver("handshake", { protocolVersion: "1.0", hostVersion: appVersion, packageId: "oxide.duckdb", driverId: "duckdb" });
    await seed.driver("connect", { connection_id: "seed", config: { url: duckSource } });
    for (const statement of ["CREATE SCHEMA analytics", "CREATE TABLE analytics.items(id INTEGER, name VARCHAR)", "INSERT INTO analytics.items VALUES(42, 'duckdb-real')"]) await seed.driver("query", { connection_id: "seed", statement });
    await seed.driver("disconnect", { connection_id: "seed" });
  } finally { await seed.close(true); }
  const duck = path.join(registry, "duckdb", duckVersion);
  await run(process.execPath, [path.join(root, "scripts/package-duckdb-driver.mjs"), "--target", rustTarget, "--binary", duckBinary, "--out", duck], "package-real-duckdb");
  await sign(path.join(duck, "manifest.json"));
  const hash = await sha256(duckSource);
  profile.configure("duckdb", { database: duckSource, driverPackageVersion: duckVersion });
  const duckRows = await call("query.runReadOnly", { sql: "SELECT id, name FROM items", schema: "analytics" }, { database: "source", timeout: "30" });
  assert.deepEqual(duckRows.data.results[0].rows, [[42, "duckdb-real"]]);
  const columns = await call("metadata.inspectLive", { kind: "columns", database: "source", schema: "analytics", relation: "items" }, { database: "source", timeout: "30" });
  assert.deepEqual(columns.data.objects.map((column) => column.name), ["id", "name"]);
  assert.equal(await sha256(duckSource), hash);
  const missing = path.join(directory, "missing.duckdb");
  profile.configure("duckdb", { database: missing, driverPackageVersion: duckVersion });
  await call("metadata.inspectLive", { kind: "databases" }, { database: "missing", timeout: "30", fail: /connect|exist|read.only/i });
  await assert.rejects(fs.stat(missing), { code: "ENOENT" });
  assert.ok(server.state.requests.every((request) => request.path !== "/db/request"));
  const evidence = { cliVersion: appVersion, target: rustTarget, pinnedVersion: "0.1.0", activeVersion: "0.1.1", realSignedManifests: true, mcpUsesSelectedPackage: true, noSilentFallback: true, readOnlyHandshakeRequired: true, tamperingRejected: true, deadlineApplied: true, duckdbSourceUnchanged: true, missingDuckdbNotCreated: true, rqliteSource: "read-only SQLite-backed HTTP protocol fixture", duckdbSource: "actual compiled DuckDB engine", httpRequests: server.state.requests.length };
  await fs.writeFile(path.join(directory, "evidence.json"), JSON.stringify(evidence, null, 2));
  process.stdout.write(`Signed driver acceptance passed; evidence: ${directory}\n`);
} finally {
  profile?.metadata.close();
  await server?.close();
  await restore();
  process.stdout.write(`Signed driver fixture retained: ${directory}\n`);
}
