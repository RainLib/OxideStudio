import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const execute = promisify(execFile);

export async function waitOwnedProcessExit(executable, expectedHash, pid) {
  if (await sha256(executable) !== expectedHash) throw new Error("The owned executable changed before observing process exit");
  const name = path.basename(executable);
  if (!/^(?:oxide-updater-|OxideUpdateFixture-)[a-f0-9-]{36}(?:-[\d.]+-installer)?\.exe$/i.test(name)) {
    throw new Error("Only uniquely named updater fixture processes can be observed");
  }
  if (pid !== undefined && !/^\d+$/.test(String(pid))) throw new Error("Invalid owned fixture process ID");
  await waitFor(async () => {
    const filter = pid === undefined ? `IMAGENAME eq ${name}` : `PID eq ${pid}`;
    const { stdout } = await execute("tasklist.exe", ["/FI", filter, "/FO", "CSV", "/NH"], { windowsHide: true, timeout: 5_000 });
    const found = stdout.split(/\r?\n/).map((line) => line.match(/^"([^"]+)","(\d+)"/)).filter(Boolean);
    // The signed file hash, unique image name, and installer-produced marker
    // identify this fixture. A stale/reused PID never authorizes termination.
    return !found.some((record) => record[1].toLowerCase() === name.toLowerCase() && (pid === undefined || record[2] === String(pid)));
  }, "the owned fixture process to exit", 20_000);
}

export async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export async function nsisExecutableSha256(file) {
  const bytes = await fs.readFile(file);
  const unknown = Buffer.from("__TAURI_BUNDLE_TYPE_VAR_UNK");
  const offset = bytes.indexOf(unknown);
  if (offset < 0 || bytes.indexOf(unknown, offset + 1) >= 0) {
    throw new Error("Expected one Tauri bundle marker in the unbundled executable");
  }
  // tauri-utils 2.9.3 recognizes NSS as NSIS. The bundler patches this
  // fixed-width marker while packaging, then restores its input executable.
  Buffer.from("__TAURI_BUNDLE_TYPE_VAR_NSS").copy(bytes, offset);
  return createHash("sha256").update(bytes).digest("hex");
}

export async function ownedBackupPath(root, file) {
  const parent = path.toNamespacedPath(await fs.realpath(root));
  const actual = path.toNamespacedPath(await fs.realpath(file));
  const relative = path.relative(parent, actual);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("A fixture backup escaped its owned directory");
  }
  return actual;
}

export async function waitFor(check, description, timeout = 120_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

export async function copySource(root, destination) {
  for (const directory of ["src-tauri", "enterprise"]) {
    await fs.cp(path.join(root, directory), path.join(destination, directory), {
      recursive: true,
      filter: (source) => {
        const name = path.basename(source);
        return !["target", "node_modules", ".git", "dist", "secrets"].includes(name)
          && name !== ".env" && !name.startsWith(".env.");
      },
    });
  }
  await fs.copyFile(path.join(root, "package.json"), path.join(destination, "package.json"));
  for (const file of ["Cargo.toml", "Cargo.lock", "tauri.conf.json"]) {
    if ((await fs.lstat(path.join(destination, "src-tauri", file))).isSymbolicLink()) {
      throw new Error("The updater fixture requires regular Cargo and Tauri version files");
    }
  }
}

export async function fixtureServer({ directory, runId, identifier, fromVersion, toVersion, endpoint }) {
  const existing = endpoint ? new URL(endpoint) : null;
  if (existing && (existing.protocol !== "http:" || existing.hostname !== "127.0.0.1" || !/^\/[a-f0-9]{48}$/.test(existing.pathname))) {
    throw new Error("A cached fixture requires its original loopback endpoint");
  }
  const token = existing ? existing.pathname.slice(1) : randomBytes(24).toString("hex");
  const source = path.join(directory, "source.sqlite");
  const backups = path.join(directory, "backups");
  await fs.mkdir(backups, { recursive: true });
  const database = new DatabaseSync(source);
  database.exec("PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS sample(id INTEGER PRIMARY KEY, label TEXT); INSERT OR IGNORE INTO sample VALUES(42, 'signed installer fixture');");
  let blocked = false;
  const state = { phase: "initial", mode: "untrusted", plans: [], events: [], data: null, config: null, installerExited: false, artifacts: null };
  function unblock() {
    if (blocked) { database.exec("COMMIT"); blocked = false; }
  }
  function validateProfile(value) {
    const resolved = path.resolve(value);
    if (path.basename(resolved) !== identifier || !path.isAbsolute(value)) {
      throw new Error("The packaged fixture reported an unexpected profile directory");
    }
    return resolved;
  }
  const json = (response, value, status = 200) => {
    response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify(value));
  };
  const server = http.createServer(async (request, response) => {
    try {
      const origin = request.headers.origin;
      if (origin && !["http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"].includes(origin)) return json(response, {}, 403);
      if (origin) response.setHeader("access-control-allow-origin", origin);
      response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
      response.setHeader("access-control-allow-headers", "content-type");
      if (request.method === "OPTIONS") return response.writeHead(204).end();
      const route = new URL(request.url, "http://127.0.0.1").pathname;
      if (!route.startsWith(`/${token}/`)) return json(response, {}, 403);
      const action = route.slice(token.length + 2);
      if (action === "config") return json(response, { runId, fromVersion, toVersion, source, backups, plans: state.plans, phase: state.phase });
      if (action === "latest.json") {
        if (!state.artifacts) return json(response, {}, 503);
        const artifact = state.mode === "failure" ? state.artifacts.failure : state.artifacts.success;
        // A valid signature for a different payload exercises actual signature
        // verification rather than merely rejecting malformed metadata.
        const signature = state.mode === "untrusted" ? state.artifacts.failure.signature : artifact.signature;
        return json(response, { version: toVersion, notes: "Isolated signed installer acceptance", pub_date: "2026-10-22T00:00:00Z",
          platforms: { "windows-x86_64": { signature, url: `${api.url}/${artifact.name}` } } });
      }
      const artifact = state.artifacts && Object.values(state.artifacts).find((item) => item.name === action);
      if (artifact) {
        response.writeHead(200, { "content-type": "application/octet-stream", "content-length": (await fs.stat(artifact.file)).size });
        createReadStream(artifact.file).pipe(response);
        return;
      }
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (Buffer.byteLength(body) > 256 * 1024) throw new Error("Fixture request exceeds its limit");
      }
      const value = JSON.parse(body || "{}");
      if (action === "events") {
        if (state.events.length >= 200) throw new Error("Too many fixture events");
        if (value.stage === "webview-ready") {
          const data = validateProfile(value.data), config = validateProfile(value.config);
          if (state.data && (state.data !== data || state.config !== config)) throw new Error("The update changed its profile directory");
          state.data = data; state.config = config;
        }
        if (value.stage === "plans-saved") {
          if (!Array.isArray(value.plans) || value.plans.length !== 2) throw new Error("Expected two fixture plans");
          state.plans = value.plans;
        }
        if (value.stage === "signature-rejected") state.mode = "failure";
        if (value.stage === "failure-recovered") state.mode = "success";
        const event = { at: new Date().toISOString(), ...value };
        state.events.push(event);
        await fs.appendFile(path.join(directory, "events.ndjson"), `${JSON.stringify(event)}\n`);
        process.stdout.write(`Packaged updater: ${value.stage}\n`);
        return json(response, { ok: true });
      }
      if (action === "control") {
        if (value.action === "block") {
          if (blocked) throw new Error("The source is already blocked");
          database.exec("BEGIN EXCLUSIVE"); blocked = true;
        } else if (value.action === "recovery-acknowledged") {
          if (!state.installerExited) throw new Error("The failing installer has not been observed exiting");
        } else throw new Error("Unknown fixture control action");
        return json(response, { ok: true });
      }
      json(response, {}, 404);
    } catch (error) {
      state.events.push({ stage: "error", message: String(error) });
      json(response, { error: String(error) }, 500);
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(existing ? Number(existing.port) : 0, "127.0.0.1", resolve);
  });
  const api = {
    url: `http://127.0.0.1:${server.address().port}/${token}`,
    origin: `http://127.0.0.1:${server.address().port}`,
    state, unblock,
    waitEvent(stage) {
      return waitFor(() => {
        const failure = state.events.find((event) => event.stage === "error");
        if (failure) throw new Error(failure.message);
        return state.events.find((event) => event.stage === stage);
      }, `WebView event ${stage}`);
    },
    async snapshot() {
      if (!state.data) return null;
      const root = path.join(state.data, "database-backups");
      const read = async (file) => { try { return JSON.parse(await fs.readFile(path.join(root, file), "utf8")); } catch (error) { if (error.code === "ENOENT") return null; throw error; } };
      return { control: await read("worker-control.json"), schedules: await read("sqlite-schedules.json") };
    },
    async close() { unblock(); database.close(); await new Promise((resolve) => server.close(resolve)); },
  };
  return api;
}
