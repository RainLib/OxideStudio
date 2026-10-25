// Native protocol proof: real file metadata -> isolated SQL-LSP document.
// This does not exercise the renderer, Tauri IPC or a system file picker.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { JsonFixtureProcess } from "./lib/headless-driver-fixture.mjs";

class FramedRpc {
  constructor(binary) {
    this.buffer = Buffer.alloc(0); this.sequence = 0; this.pending = new Map();
    this.child = spawn(binary, [], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    this.child.stderr.resume();
    this.completion = new Promise(resolve => this.child.once("close", code => { this.fail(new Error(`LSP exited (${code})`)); resolve(code); }));
    this.child.once("error", error => this.fail(error));
    this.child.stdout.on("data", chunk => {
      try {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        assert(this.buffer.length < 4 * 1024 * 1024);
        while (true) {
          const boundary = this.buffer.indexOf("\r\n\r\n"); if (boundary < 0) break;
          const length = Number(this.buffer.subarray(0, boundary).toString().match(/Content-Length:\s*(\d+)/i)?.[1]);
          assert(Number.isSafeInteger(length) && length > 0);
          if (this.buffer.length < boundary + 4 + length) break;
          const message = JSON.parse(this.buffer.subarray(boundary + 4, boundary + 4 + length).toString());
          this.buffer = this.buffer.subarray(boundary + 4 + length);
          if (message.method && message.id !== undefined) { this.send({ jsonrpc: "2.0", id: message.id, result: null }); continue; }
          const pending = this.pending.get(message.id); if (!pending) continue;
          this.pending.delete(message.id); clearTimeout(pending.timer);
          if (message.error) pending.reject(new Error(JSON.stringify(message.error))); else pending.resolve(message.result);
        }
      } catch (error) { this.fail(error); this.child.kill(); }
    });
  }
  fail(error) { for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); } this.pending.clear(); }
  send(message) { const body = Buffer.from(JSON.stringify(message)); this.child.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body])); }
  notify(method, params) { this.send({ jsonrpc: "2.0", method, params }); }
  request(method, params) {
    const id = ++this.sequence;
    const promise = new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`LSP ${method} timed out`)); }, 10000); this.pending.set(id, { resolve, reject, timer }); });
    this.send({ jsonrpc: "2.0", id, method, params }); return promise;
  }
}
async function exitWithin(completion) {
  let timer;
  try { return await Promise.race([completion, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Fixture process did not exit within 3 seconds")), 3000); })]); }
  finally { clearTimeout(timer); }
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const suffix = process.platform === "win32" ? ".exe" : "";
const driverBinary = path.join(root, "src-tauri/crates/oxide-driver-duckdb/target/debug", `oxide-driver-duckdb${suffix}`);
const lspBinary = path.join(root, "src-tauri/binaries", `sql-lsp${suffix}`);
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "oxide-file-query-lsp-"));
const evidence = { success: false, scope: "native-file-metadata-and-scoped-lsp", desktopIpcTested: false };
let driver, lsp;
try {
  const source = path.join(directory, "sales.csv");
  await fs.writeFile(source, "region,revenue\nAsia,120\nEurope,90\n");
  for (const [key, binary] of [["driverSha256", driverBinary], ["lspSha256", lspBinary]]) evidence[key] = createHash("sha256").update(await fs.readFile(binary)).digest("hex");
  driver = new JsonFixtureProcess(driverBinary);
  await driver.driver("handshake", { protocolVersion: "1.0", hostVersion: "0.1.18", packageId: "oxide.duckdb", driverId: "duckdb" });
  await driver.driver("connect", { connection_id: "file", config: { url: source, options: { readOnly: "true", fileQueryFormat: "csv", fileQueryCsvHeader: "auto" } } });
  const result = await driver.driver("query", { connection_id: "file", statement: "SELECT * FROM data LIMIT 0" });
  const columns = result.value[0].columns;
  assert.equal(result.value[0].rows.length, 0); assert.deepEqual(columns.map(c => c.name), ["region", "revenue"]);
  assert.deepEqual(columns.map(c => c.dataType), ["VARCHAR", "BIGINT"]);
  lsp = new FramedRpc(lspBinary);
  const initialized = await lsp.request("initialize", { processId: process.pid, rootUri: null, capabilities: {} });
  assert(initialized.capabilities.documentFormattingProvider);
  lsp.notify("initialized", {});
  const uri = "oxide-file-query://fixture/file.sql";
  const schemaId = "a1e2aab5-77bb-454b-9407-d2741b25241f";
  lsp.notify("workspace/didChangeConfiguration", { settings: { defaultDialect: "duckdb", fileSchemas: { [uri]: schemaId }, fileDialects: { [uri]: "duckdb" },
    schemas: [{ id: schemaId, database: "main", driver: "duckdb", source_uri: null, functions: [], tables: [{ name: "data", object_type: "view", comment: null, source_location: null, indexes: [], constraints: [],
      columns: columns.map(c => ({ name: c.name, data_type: c.dataType, nullable: true, primary_key: false, unique: false, indexed: false, comment: null, source_location: null })) }] }] } });
  lsp.notify("textDocument/didOpen", { textDocument: { uri, languageId: "duckdb", version: 1, text: "select d. from data d" } });
  const completion = await lsp.request("textDocument/completion", { textDocument: { uri }, position: { line: 0, character: 9 } });
  const labels = (Array.isArray(completion) ? completion : completion.items).map(item => item.label);
  assert(labels.includes("region") && labels.includes("revenue"), `Missing source columns: ${labels.join(", ")}`);
  const text = "select '雪' as label,9007199254740993 as amount from data";
  lsp.notify("textDocument/didChange", { textDocument: { uri, version: 2 }, contentChanges: [{ text }] });
  const edits = await lsp.request("textDocument/formatting", { textDocument: { uri }, options: { tabSize: 2, insertSpaces: true } });
  assert(edits.length > 0); assert(edits.some(edit => edit.newText.includes("雪") && edit.newText.includes("9007199254740993")));
  const secondSource=path.join(directory,"sales-next.csv");
  await fs.writeFile(secondSource,"region,revenue_new\nAsia,121\nEurope,91\n");
  await driver.driver("connect",{connection_id:"file-next",config:{url:secondSource,options:{readOnly:"true",fileQueryFormat:"csv",fileQueryCsvHeader:"auto"}}});
  const secondResult=await driver.driver("query",{connection_id:"file-next",statement:"SELECT * FROM data LIMIT 0"});
  const secondColumns=secondResult.value[0].columns;assert.deepEqual(secondColumns.map(column=>column.name),["region","revenue_new"]);
  lsp.notify("workspace/didChangeConfiguration",{settings:{defaultDialect:"duckdb",fileSchemas:{[uri]:schemaId},fileDialects:{[uri]:"duckdb"},schemas:[{id:schemaId,database:"main",driver:"duckdb",source_uri:null,functions:[],tables:[{name:"data",object_type:"view",indexes:[],constraints:[],columns:secondColumns.map(column=>({name:column.name,data_type:column.dataType,nullable:true,primary_key:false,unique:false,indexed:false}))}]}]}});
  lsp.notify("textDocument/didChange",{textDocument:{uri,version:3},contentChanges:[{text:"WITH q AS (SELECT d.* FROM data d) SELECT q.reveSuffix FROM q"}]});
  const next=await lsp.request("textDocument/completion",{textDocument:{uri},position:{line:0,character:46}});
  const secondLabels=(Array.isArray(next)?next:next.items).map(item=>item.label);assert(secondLabels.includes("revenue_new")&&!secondLabels.includes("revenue"),"replacement file metadata must not retain the old field");
  evidence.secondColumns=secondColumns;evidence.secondCompletionLabels=secondLabels;
  evidence.incompleteMemberHover=await lsp.request("textDocument/hover",{textDocument:{uri},position:{line:0,character:46}});
  const knownSql="WITH q AS (SELECT d.* FROM data d) SELECT q.revenue_new FROM q";
  lsp.notify("textDocument/didChange",{textDocument:{uri,version:4},contentChanges:[{text:knownSql}]});
  evidence.knownMemberHover=await lsp.request("textDocument/hover",{textDocument:{uri},position:{line:0,character:knownSql.indexOf("revenue_new")+3}});
  assert(JSON.stringify(evidence.knownMemberHover).toUpperCase().includes("BIGINT"),"known file field hover must retain the actual BIGINT source type");

  await driver.driver("disconnect",{connection_id:"file-next"});
  lsp.notify("textDocument/didClose", { textDocument: { uri } });
  await lsp.request("shutdown"); lsp.notify("exit"); lsp.child.stdin.end();
  assert.equal(await exitWithin(lsp.completion), 0);
  await driver.driver("disconnect", { connection_id: "file" }); driver.child.stdin.end(); assert.equal(await exitWithin(driver.completion), 0);
  evidence.columns = columns; evidence.completionLabels = labels; evidence.formattingEdits = edits; evidence.success = true;
} catch (error) { evidence.failure = error.message; process.exitCode = 1; }
finally {
  if (driver && driver.child.exitCode === null && !driver.failure) {
    await driver.driver("disconnect", { connection_id: "file" }).catch(() => undefined);
    driver.child.stdin.end();
  }
  for (const process of [lsp, driver]) if (process && process.child.exitCode === null) { process.child.kill(); await process.completion; }
  await fs.writeFile(path.join(directory, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ directory, ...evidence }, null, 2));
}
