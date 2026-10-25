import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";

export class JsonFixtureProcess {
  constructor(executable, args = [], env = process.env) {
    this.nextId = 1;
    this.pending = new Map();
    this.child = spawn(executable, args, { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    this.child.stderr.resume();
    this.completion = new Promise((resolve) => this.child.once("close", (code) => {
      this.fail(new Error(`Fixture process exited (${code})`)); resolve(code);
    }));
    this.child.once("error", (error) => this.fail(error));
    createInterface({ input: this.child.stdout, crlfDelay: Infinity }).on("line", (line) => {
      try {
        if (Buffer.byteLength(line) > 4 * 1024 * 1024) throw new Error("Fixture response exceeds 4 MiB");
        const value = JSON.parse(line), pending = this.pending.get(value.id);
        if (!pending) {
          if (value.id === 0 && value.status === "error") throw new Error(`Fixture driver protocol rejected: ${value.result?.code}`);
          return;
        }
        this.pending.delete(value.id); clearTimeout(pending.timer); pending.resolve(value);
      } catch (error) { this.fail(error); this.child.kill(); }
    });
  }
  fail(error) {
    this.failure ??= error;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }
  async request(method, params, mcp = false) {
    if (this.failure) throw this.failure;
    const id = this.nextId++;
    const reply = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Fixture ${method} timed out`)); }, 20_000);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.child.stdin.write(`${JSON.stringify({ ...(mcp ? { jsonrpc: "2.0" } : {}), id, method, ...(params === undefined ? {} : { params }) })}\n`, (error) => { if (error) this.fail(error); });
    return reply;
  }
  async driver(method, params) {
    const reply = await this.request(method, params);
    if (reply.status !== "ok") throw new Error(`Native sidecar rejected ${method}: ${reply.result?.code}`);
    return reply.result;
  }
  async close(driver = false) {
    if (driver && !this.failure) await this.driver("shutdown").catch(() => {});
    this.child.stdin.end();
    let timer;
    await Promise.race([this.completion, new Promise((resolve) => { timer = setTimeout(resolve, 2_000); })]);
    clearTimeout(timer);
    if (this.child.exitCode === null) this.child.kill();
    await this.completion;
  }
}

export async function profileFixture(directory, registry) {
  const profile = path.join(directory, "profile");
  await fs.mkdir(profile);
  const metadata = new DatabaseSync(path.join(profile, "metadata.db"));
  metadata.exec("CREATE TABLE projects(id TEXT PRIMARY KEY); INSERT INTO projects VALUES('fixture-project'); CREATE TABLE connections(id TEXT PRIMARY KEY, project_id TEXT, name TEXT, driver TEXT, config TEXT, updated_at INTEGER); CREATE TABLE resources(id TEXT, project_id TEXT, connection_id TEXT, parent_id TEXT, kind TEXT, name TEXT, metadata TEXT, last_updated INTEGER);");
  const settings = { drivers: { storePath: registry } };
  await fs.writeFile(path.join(profile, "settings.json"), JSON.stringify(settings));
  return {
    profile, metadata, settings,
    configure(driver, config) {
      metadata.prepare("INSERT INTO connections VALUES('fixture-connection','fixture-project','fixture',?,?,?) ON CONFLICT(id) DO UPDATE SET driver=excluded.driver, config=excluded.config, updated_at=excluded.updated_at")
        .run(driver, JSON.stringify({ id: "fixture-connection", projectId: "fixture-project", name: "fixture", driver, url: "", ...config }), Date.now());
    },
    args(database = "main") { return ["--project", "fixture-project", "--connection", "fixture-connection", "--data-dir", profile, "--database", database]; },
  };
}

export async function rqliteHttpFixture(directory) {
  const source = path.join(directory, "rqlite-source.sqlite");
  const writer = new DatabaseSync(source);
  writer.exec("CREATE TABLE items(id INTEGER PRIMARY KEY, name TEXT); INSERT INTO items VALUES(1, 'one'),(2, 'two'),(3, 'three'),(4, 'four');");
  writer.close();
  const database = new DatabaseSync(source, { readOnly: true });
  const state = { requests: [], delay: 0 };
  const server = http.createServer(async (request, response) => {
    state.requests.push({ method: request.method, path: request.url });
    try {
      if (request.url === "/readyz") { response.end("ready"); return; }
      if (request.url === "/status") { response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ build: { version: "8.36.0" } })); return; }
      if (request.method !== "POST" || request.url !== "/db/query") { response.writeHead(403).end(); return; }
      let body = "";
      for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 256 * 1024) throw new Error("Fixture request exceeds its budget"); }
      if (state.delay) await new Promise((resolve) => setTimeout(resolve, state.delay));
      const statements = JSON.parse(body);
      const results = statements.map((entry) => {
        const [sql, ...parameters] = Array.isArray(entry) ? entry : [entry];
        try {
          const statement = database.prepare(sql), columns = statement.columns();
          statement.setReturnArrays(true);
          return { columns: columns.map((column) => column.name), types: columns.map((column) => (column.type || "text").toLowerCase()), values: statement.all(...parameters) };
        } catch (error) { return { error: error.message }; }
      });
      response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ results }));
    } catch (error) { response.writeHead(500).end(JSON.stringify({ error: error.message })); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return { source, state, url: `http://127.0.0.1:${server.address().port}`,
    async close() { await new Promise((resolve) => server.close(resolve)); database.close(); } };
}
