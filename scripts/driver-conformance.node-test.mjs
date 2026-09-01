import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  evidenceReference,
  runDriverConformance,
  sha256Bytes,
} from "./lib/driver-conformance.mjs";

const MOCK_SIDECAR = String.raw`
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
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
  if (message.method === "handshake") return response(message.id, "ok", { kind: "handshake", value: { protocolVersion: "1.0", packageId: "oxide.mock", packageVersion: "1.0.0", driverId: "mockdb", capabilities: { metadata: true, query: true, transactions: true, databaseScopedQueries: true, semanticSchemaMigration: true } } });
  if (message.method === "connect" || message.method === "disconnect" || message.method === "beginTransaction" || message.method === "rollbackTransaction") return response(message.id, "ok", { kind: "empty", value: null });
  if (message.method === "ping") return response(message.id, "ok", { kind: "boolean", value: true });
  if (message.method === "serverVersion") return response(message.id, "ok", { kind: "serverVersion", value: "1.2.3" });
  if (message.method === "metadata") return response(message.id, "ok", { kind: "metadata", value: params.request.kind === "relations" ? [{ name: "oxide_conformance_items" }] : ["main"] });
  if (message.method === "planSchemaMigration") return response(message.id, "ok", { kind: "schemaMigrationPlan", value: { planId: "plan-1", planToken: "plan-token-1", targetFingerprint: params.request.target.fingerprint, mode: "transactional", changeCount: 1, blockedChangeCount: 0, requiresReview: false, requiresDestructive: false, preview: [{ id: "change-1", kind: "relationCreate", label: "widgets", risk: "safe", reversible: true, summary: "Create widgets" }], warnings: [] } });
  if (message.method === "preflightSchemaMigration") return response(message.id, "ok", { kind: "schemaMigrationPreflight", value: { planId: "plan-1", preflightToken: "preflight-token-1", targetFingerprint: params.request.targetFingerprint, ready: true, checks: [] } });
  if (message.method === "applySchemaMigration") return response(message.id, "ok", { kind: "schemaMigrationApply", value: { planId: "plan-1", applyToken: "apply-token-1", status: "applied", committedChangeCount: 1, warnings: [] } });
  if (message.method === "verifySchemaMigration") return response(message.id, "ok", { kind: "schemaMigrationVerify", value: { planId: "plan-1", matchesSource: true, targetFingerprintAfter: "source-fingerprint", remainingChangeCount: 0, warnings: [] } });
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

async function tempFixture() {
  const root = await mkdtemp(join(os.tmpdir(), "oxide-driver-conformance-"));
  const entrypoint = join(root, "mock-sidecar.js");
  const manifestPath = join(root, "manifest.json");
  const fixturePath = join(root, "fixture.json");
  await writeFile(entrypoint, MOCK_SIDECAR, "utf8");
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

test("driver conformance runner emits privacy-bounded catalog evidence", async (t) => {
  const fixture = await tempFixture();
  t.after(async () => rm(fixture.root, { recursive: true, force: true }));
  const { report } = await runDriverConformance({
    manifestPath: fixture.manifestPath,
    fixturePath: fixture.fixturePath,
    environment: { MOCKDB_URL: "mock://private-host/secret-db", MOCKDB_PASSWORD: "top-secret" },
    target: "x86_64-pc-windows-msvc",
    launchOverride: { command: process.execPath, args: [fixture.entrypoint] },
    now: () => new Date("2026-08-02T00:00:00.000Z"),
  });
  assert.equal(report.passed, true);
  assert.deepEqual(report.operations.map((item) => item.operation), ["connect", "query", "metadata", "transactions", "migration"]);
  const encoded = JSON.stringify(report);
  assert.equal(encoded.includes("private-host"), false);
  assert.equal(encoded.includes("top-secret"), false);
  assert.equal(encoded.includes("SELECT missing"), false);
  assert.equal(encoded.includes("bound_value"), false);

  const digest = sha256Bytes(Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8"));
  const reference = evidenceReference(report, "https://drivers.example.test/mockdb/1.0.0/evidence.json", digest);
  assert.deepEqual(reference.operations, ["connect", "query", "metadata", "migration"]);
  assert.equal(reference.serverVersion, "1.2.3");
});

test("driver conformance refuses fixtures without parameter binding", async (t) => {
  const fixture = await tempFixture();
  t.after(async () => rm(fixture.root, { recursive: true, force: true }));
  const document = JSON.parse(await readFile(fixture.fixturePath, "utf8"));
  document.query.parameters = [];
  await writeFile(fixture.fixturePath, `${JSON.stringify(document)}\n`, "utf8");
  await assert.rejects(
    runDriverConformance({
      manifestPath: fixture.manifestPath,
      fixturePath: fixture.fixturePath,
      environment: { MOCKDB_URL: "mock://private-host/secret-db", MOCKDB_PASSWORD: "top-secret" },
      launchOverride: { command: process.execPath, args: [fixture.entrypoint] },
    }),
    /bound parameter/,
  );
});

test("driver conformance requires executable database-scope evidence for catalog packages", async (t) => {
  const fixture = await tempFixture();
  t.after(async () => rm(fixture.root, { recursive: true, force: true }));
  const manifest = JSON.parse(await readFile(fixture.manifestPath, "utf8"));
  manifest.capabilities.supportsDatabaseCatalogs = true;
  await writeFile(fixture.manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");

  await assert.rejects(
    runDriverConformance({
      manifestPath: fixture.manifestPath,
      fixturePath: fixture.fixturePath,
      environment: { MOCKDB_URL: "mock://private-host/secret-db", MOCKDB_PASSWORD: "top-secret" },
      launchOverride: { command: process.execPath, args: [fixture.entrypoint] },
    }),
    /databaseScope query fixture/,
  );

  const document = JSON.parse(await readFile(fixture.fixturePath, "utf8"));
  document.databaseScope = {
    statement: "SELECT current_database",
    context: { database: "app", readOnly: true },
    expect: { minRows: 1, columns: ["database_name"], firstRow: ["app"] },
  };
  await writeFile(fixture.fixturePath, `${JSON.stringify(document)}\n`, "utf8");
  const { report } = await runDriverConformance({
    manifestPath: fixture.manifestPath,
    fixturePath: fixture.fixturePath,
    environment: { MOCKDB_URL: "mock://private-host/secret-db", MOCKDB_PASSWORD: "top-secret" },
    target: "x86_64-pc-windows-msvc",
    launchOverride: { command: process.execPath, args: [fixture.entrypoint] },
  });
  assert.equal(report.passed, true);
  assert.ok(report.operations.some((item) => item.operation === "databaseScope"));
});

test("driver conformance refuses Host SQL in semantic migration snapshots", async (t) => {
  const fixture = await tempFixture();
  t.after(async () => rm(fixture.root, { recursive: true, force: true }));
  const document = JSON.parse(await readFile(fixture.fixturePath, "utf8"));
  document.migration.source.descriptor.sql = "CREATE TABLE should_not_cross_the_boundary";
  await writeFile(fixture.fixturePath, `${JSON.stringify(document)}\n`, "utf8");
  await assert.rejects(
    runDriverConformance({
      manifestPath: fixture.manifestPath,
      fixturePath: fixture.fixturePath,
      environment: { MOCKDB_URL: "mock://private-host/secret-db", MOCKDB_PASSWORD: "top-secret" },
      launchOverride: { command: process.execPath, args: [fixture.entrypoint] },
    }),
    /must not contain Host SQL or DDL/,
  );
});

test("driver conformance refuses a substituted entrypoint before launch", async (t) => {
  const fixture = await tempFixture();
  t.after(async () => rm(fixture.root, { recursive: true, force: true }));
  await writeFile(fixture.entrypoint, "process.exit(0);\n", "utf8");
  await assert.rejects(
    runDriverConformance({
      manifestPath: fixture.manifestPath,
      fixturePath: fixture.fixturePath,
      environment: { MOCKDB_URL: "mock://private-host/secret-db", MOCKDB_PASSWORD: "top-secret" },
      launchOverride: { command: process.execPath, args: [fixture.entrypoint] },
    }),
    /SHA-256/,
  );
});
