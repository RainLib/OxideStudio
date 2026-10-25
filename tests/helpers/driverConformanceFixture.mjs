import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, realpath } from "node:fs/promises";
import os from "node:os";
import { join, sep } from "node:path";
export async function removeFixture(root) {
  const target=await realpath(root),temporary=await realpath(os.tmpdir());
  assert(target.startsWith(temporary+sep+"oxide-driver-conformance-"));await rm(target,{recursive:true,force:true});
}
const MOCK_SIDECAR = String.raw`
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let currentDatabase = "main";
function response(id, status, result) { process.stdout.write(JSON.stringify({ id, status, result }) + "\n"); }
rl.on("line", (line) => {
  const message = JSON.parse(line);
  const params = message.params || {};
  if (["connect", "disconnect", "ping", "serverVersion", "query", "metadata", "beginTransaction", "rollbackTransaction", "planSchemaMigration", "preflightSchemaMigration", "applySchemaMigration", "verifySchemaMigration"].includes(message.method) && !params.connection_id) {
    return response(message.id, "error", { code: "INVALID_REQUEST", message: "connection_id must use the sidecar protocol casing", retryable: false, details: {} });
  }
  if (["beginTransaction", "rollbackTransaction"].includes(message.method) && !params.transaction_id) {
    return response(message.id, "error", { code: "INVALID_REQUEST", message: "transaction_id must use the sidecar protocol casing", retryable: false, details: {} });
  }
  if (message.method === "handshake") return response(message.id, "ok", { kind: "handshake", value: { protocolVersion: "1.0", packageId: "oxide.mock", packageVersion: "1.0.0", driverId: "mockdb", capabilities: { metadata: true, query: true, transactions: true, databaseScopedQueries: true, sqlLookupContext: OPTIONS.lookup === true, semanticSchemaMigration: true } } });
  if (message.method === "connect" || message.method === "disconnect" || message.method === "beginTransaction" || message.method === "rollbackTransaction") return response(message.id, "ok", { kind: "empty", value: null });
  if (message.method === "ping") return response(message.id, "ok", { kind: "boolean", value: true });
  if (message.method === "serverVersion") return response(message.id, "ok", { kind: "serverVersion", value: "1.2.3" });
  if (message.method === "metadata" && params.request.kind === "sqlLookupContext") {
    const database = params.request.database || (OPTIONS.leakQueryOnly ? "main" : currentDatabase);
    if ((OPTIONS.leakMetadata || OPTIONS.leakQueryOnly) && params.request.database) currentDatabase = database;
    return response(message.id, "ok", {kind:"metadata", value: OPTIONS.nullContext ? null : {database: OPTIONS.wrongDatabase ? "wrong" : database, defaultSchema: OPTIONS.wrongSchema ? "wrong" : database === "other" ? "sales" : "app"}});
  }
  if (message.method === "metadata") return response(message.id, "ok", { kind: "metadata", value: params.request.kind === "relations" ? [{ name: "oxide_conformance_items" }] : ["main"] });
  if (message.method === "planSchemaMigration") return response(message.id, "ok", { kind: "schemaMigrationPlan", value: { planId: "plan-1", planToken: "plan-token-1", targetFingerprint: params.request.target.fingerprint, mode: "transactional", changeCount: 1, blockedChangeCount: 0, requiresReview: false, requiresDestructive: false, preview: [{ id: "change-1", kind: "relationCreate", label: "widgets", risk: "safe", reversible: true, summary: "Create widgets" }], warnings: [] } });
  if (message.method === "preflightSchemaMigration") return response(message.id, "ok", { kind: "schemaMigrationPreflight", value: { planId: "plan-1", preflightToken: "preflight-token-1", targetFingerprint: params.request.targetFingerprint, ready: true, checks: [] } });
  if (message.method === "applySchemaMigration") return response(message.id, "ok", { kind: "schemaMigrationApply", value: { planId: "plan-1", applyToken: "apply-token-1", status: "applied", committedChangeCount: 1, warnings: [] } });
  if (message.method === "verifySchemaMigration") return response(message.id, "ok", { kind: "schemaMigrationVerify", value: { planId: "plan-1", matchesSource: true, targetFingerprintAfter: "source-fingerprint", remainingChangeCount: 0, warnings: [] } });
  if (message.method === "query" && params.statement === "SELECT current_lookup") return response(message.id,"ok",{kind:"query",value:[{columns:[{name:"database"},{name:"default_schema"}],rows:[[currentDatabase,currentDatabase === "other" ? "sales":"app"]]}]});
  if (message.method === "query") {
    if (params.statement === "SELECT missing") return response(message.id, "error", { code: "QUERY_FAILED", message: "private connection details must never leave the driver", retryable: false, details: {} });
    if (params.statement === "SELECT ?") return response(message.id, "ok", { kind: "query", value: [{ columns: [{ name: "bound_value", dataType: "INTEGER" }], rows: [[42]], truncated: false, rowLimit: null, rowsAffected: null, statementType: "select", message: null }] });
    if (params.statement === "SELECT current_database") return response(message.id, "ok", { kind: "query", value: [{ columns: [{ name: "database_name", dataType: "VARCHAR" }], rows: [[params.context && params.context.database]], truncated: false, rowLimit: null, rowsAffected: null, statementType: "select", message: null }] });
    if (params.statement === "SELECT count(*)") return response(message.id, "ok", { kind: "query", value: [{ columns: [{ name: "row_count", dataType: "INTEGER" }], rows: [[0]], truncated: false, rowLimit: null, rowsAffected: null, statementType: "select", message: null }] });
    return response(message.id, "ok", { kind: "query", value: [{ columns: [], rows: [], truncated: false, rowLimit: null, rowsAffected: 1, statementType: "mutation", message: null }] });
  }
  if (message.method === "shutdown") { response(message.id, "ok", { kind: "empty", value: null }); return setImmediate(() => process.exit(0)); }
  response(message.id, "error", { code: "UNSUPPORTED", message: "unsupported", retryable: false, details: {} });
});
`;

export async function tempFixture(options = {}) {
  const root = await mkdtemp(join(os.tmpdir(), "oxide-driver-conformance-"));
  const entrypoint = join(root, "mock-sidecar.js");
  const manifestPath = join(root, "manifest.json");
  const fixturePath = join(root, "fixture.json");
  await writeFile(entrypoint, "const OPTIONS = " + JSON.stringify(options) + ";\n" + MOCK_SIDECAR, "utf8");
  const entrypointSha256 = createHash("sha256").update(await readFile(entrypoint)).digest("hex");
  await writeFile(manifestPath, `${JSON.stringify({
    schemaVersion: 1,
    packageId: "oxide.mock",
    packageVersion: "1.0.0",
    protocolVersion: "1.0",
    driverId: "mockdb",
    displayName: "MockDB",
    clientLibrary: "mock",
    clientVersion: "1",
    entrypoint: "mock-sidecar.js",
    sha256: entrypointSha256,
    supportedTargets: ["x86_64-pc-windows-msvc"],
    capabilities: {
      driver: "mockdb", displayName: "MockDB", dataModel: "relational", lspLanguageId: "sql", namespaceLabel: "schema", identifierQuote: '"', defaultPort: 0,
      supportsSqlQuery: true, supportsTableBrowsing: true, supportsTableRowMutation: false, supportsTableDataTransfer: false,
      supportsTableDdl: true, supportsColumnAlteration: false, supportsIndexRename: false, supportsConstraintAlteration: false,
      supportsCollectionBrowsing: false, supportsKeyValueBrowsing: false, supportsSchemas: true, supportsCreateDatabase: false,
      supportsCreateDatabaseCharset: false, supportsColumnComments: false, supportsInlineColumnComments: false, supportsRenameDatabase: false,
      supportsViews: false, supportsReplaceView: false, supportsMaterializedViews: false, supportsTableIndexes: false,
      supportsTableConstraints: false, supportsForeignKeys: false, supportsCheckConstraints: false, supportsFunctions: false,
      supportsTransactions: true, supportsQueryCancellation: false, supportsExplainPlan: false, autoIncrementKeyword: null,
      defaultPrimaryKeyType: "INTEGER", commonDataTypes: ["INTEGER"]
    },
    schemaMigration: { snapshotVersion: 1, mode: "transactional" }
  }, null, 2)}\n`, "utf8");
  await writeFile(fixturePath, `${JSON.stringify({
    schemaVersion: 1,
    id: "mockdb-core-v1",
    driverId: "mockdb",
    connection: { urlEnv: "MOCKDB_URL", optionsEnv: { password: "MOCKDB_PASSWORD" } },
    serverVersionPattern: "^1\\.",
    ...(options.includeLookupFixture ? {sqlLookupContext: {
      current:{database:"main",defaultSchema:"app"}, databases:[{database:"other",defaultSchema:"sales"}],
      currentQuery:{statement:"SELECT current_lookup",context:{readOnly:true},expect:{minRows:1,firstRow:["main","app"]}}
    }} : {}),
    setup: [{ statement: "CREATE TABLE oxide_conformance_items" }],
    query: { statement: "SELECT ?", parameters: [42], expect: { minRows: 1, columns: ["bound_value"], firstRow: [42] } },
    errorMapping: { statement: "SELECT missing", expectedCodes: ["QUERY_FAILED"] },
    metadata: [
      { id: "schemas", request: { kind: "schemas" }, expect: { type: "array", contains: { equals: "main" } } },
      { id: "relations", request: { kind: "relations", namespace: "main" }, expect: { type: "array", contains: { path: ["name"], equals: "oxide_conformance_items" } } }
    ],
    transactionRollback: {
      mutation: { statement: "INSERT INTO oxide_conformance_items VALUES (?)", parameters: [7] },
      verify: { statement: "SELECT count(*)", parameters: [7], expect: { minRows: 1, columns: ["row_count"], firstRow: [0] } }
    },
    migration: {
      source: { snapshotVersion: 1, fingerprint: "source-fingerprint", namespace: "main", descriptor: { relations: [{ name: "widgets", columns: [{ name: "id", dataType: "INTEGER" }] }] } },
      target: { snapshotVersion: 1, fingerprint: "target-fingerprint", namespace: "main", descriptor: { relations: [] } }
    }
  }, null, 2)}\n`, "utf8");
  return { root, entrypoint, manifestPath, fixturePath };
}
