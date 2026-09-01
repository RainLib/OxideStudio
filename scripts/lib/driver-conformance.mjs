import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { delimiter, dirname, isAbsolute, relative, resolve } from "node:path";

export const DRIVER_CONFORMANCE_RUNNER_VERSION = "1.2.0";
export const CATALOG_CONFORMANCE_OPERATIONS = Object.freeze([
  "connect",
  "metadata",
  "query",
  "databaseScope",
  "cancellation",
  "mutations",
  "migration",
  "dataTransfer",
]);

const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const SAFE_TOKEN = /^[A-Za-z0-9._-]{1,96}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const FORBIDDEN_MIGRATION_DESCRIPTOR_KEYS = new Set([
  "ddl",
  "sql",
  "sourcesql",
  "statement",
  "statements",
]);

export class DriverProtocolResponseError extends Error {
  constructor(code) {
    super(`Driver protocol request failed with ${code || "UNKNOWN"}`);
    this.name = "DriverProtocolResponseError";
    this.code = code || "UNKNOWN";
  }
}

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function sha256File(path) {
  return sha256Bytes(await readFile(path));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function packageFile(packageRoot, value, label) {
  assert(typeof value === "string" && value.length > 0, `${label} is required`);
  assert(!isAbsolute(value), `${label} must be package-relative`);
  const path = resolve(packageRoot, value);
  const boundary = relative(packageRoot, path);
  assert(
    boundary && boundary !== ".." && !boundary.startsWith(`..${delimiter}`) && !isAbsolute(boundary),
    `${label} escapes the package root`,
  );
  return path;
}

function safeChildEnvironment(extra = {}) {
  const names = [
    "PATH",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "TEMP",
    "TMP",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
  ];
  const env = {};
  for (const name of names) {
    if (process.env[name] != null) env[name] = process.env[name];
  }
  return { ...env, ...extra };
}

async function packageLaunch(manifest, packageRoot, javaBinary) {
  const entrypoint = packageFile(packageRoot, manifest.entrypoint, "Driver entrypoint");
  assert((await stat(entrypoint).catch(() => null))?.isFile(), "Driver entrypoint is missing");
  assert(
    (await sha256File(entrypoint)).toLowerCase() === String(manifest.sha256 || "").toLowerCase(),
    "Driver entrypoint SHA-256 does not match the package manifest",
  );

  if (manifest.runtime?.kind === "java") {
    assert(javaBinary, "Java driver conformance requires --java <managed-java-binary>");
    const classpath = [entrypoint];
    for (const item of manifest.runtime.classpath || []) {
      const path = packageFile(packageRoot, item.path, "Java classpath entry");
      assert((await stat(path).catch(() => null))?.isFile(), "Java classpath entry is missing");
      assert(
        (await sha256File(path)).toLowerCase() === String(item.sha256 || "").toLowerCase(),
        "Java classpath SHA-256 does not match the package manifest",
      );
      classpath.push(path);
    }
    return {
      command: resolve(javaBinary),
      args: ["-cp", classpath.join(delimiter), manifest.runtime.mainClass],
      entrypoint,
    };
  }
  assert(!manifest.runtime || manifest.runtime.kind === "native", "Unsupported driver runtime kind");
  return { command: entrypoint, args: [], entrypoint };
}

class SidecarClient {
  constructor(command, args, cwd, env, timeoutMs = DEFAULT_TIMEOUT_MS) {
    this.nextId = 1;
    this.pending = new Map();
    this.timeoutMs = timeoutMs;
    this.terminalError = null;
    this.child = spawn(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    });
    const lines = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => this.#onLine(line));
    this.child.once("error", () => this.#close("Driver sidecar could not be started"));
    this.child.once("exit", (code, signal) => this.#close(
      `Driver sidecar stopped before responding (${signal || `exit ${code ?? "unknown"}`})`,
    ));
  }

  #onLine(line) {
    if (Buffer.byteLength(line, "utf8") > MAX_MESSAGE_BYTES) {
      this.#close("Driver sidecar response exceeded the message limit");
      this.child.kill();
      return;
    }
    let envelope;
    try {
      envelope = JSON.parse(line);
    } catch {
      this.#close("Driver sidecar returned invalid JSON");
      this.child.kill();
      return;
    }
    const pending = this.pending.get(envelope.id);
    if (!pending) {
      // Protocol implementations return id=0 when deserializing a request
      // fails. Surface that immediately instead of reporting a misleading
      // per-request timeout and leaving the actual compatibility failure
      // hidden on stdout.
      if (envelope.id === 0 && envelope.status === "error") {
        this.#close(`Driver sidecar rejected a protocol envelope (${envelope.result?.code || "INVALID_REQUEST"})`);
      }
      return;
    }
    this.pending.delete(envelope.id);
    clearTimeout(pending.timer);
    if (envelope.status === "error") {
      pending.reject(new DriverProtocolResponseError(envelope.result?.code));
    } else if (envelope.status === "ok") {
      pending.resolve(envelope.result);
    } else {
      pending.reject(new Error("Driver sidecar returned an invalid response status"));
    }
  }

  #close(message) {
    if (this.terminalError) return;
    this.terminalError = message;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    this.pending.clear();
  }

  request(method, params = undefined, timeoutMs = this.timeoutMs) {
    if (this.terminalError) return Promise.reject(new Error(this.terminalError));
    const id = this.nextId++;
    const envelope = params === undefined ? { id, method } : { id, method, params };
    const line = `${JSON.stringify(envelope)}\n`;
    assert(Buffer.byteLength(line, "utf8") <= MAX_MESSAGE_BYTES, "Driver request exceeds the message limit");
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectPromise(new Error(`Driver ${method} request timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer });
      this.child.stdin.write(line, "utf8", (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        clearTimeout(timer);
        rejectPromise(new Error(`Driver ${method} request could not be sent`));
      });
    });
  }

  async terminate() {
    if (!this.terminalError) {
      await this.request("shutdown", undefined, 2_000).catch(() => undefined);
    }
    if (this.child.exitCode == null) this.child.kill();
    if (this.child.exitCode == null) {
      await new Promise((resolveExit) => {
        const timer = setTimeout(resolveExit, 2_000);
        this.child.once("close", () => {
          clearTimeout(timer);
          resolveExit();
        });
      });
    }
  }
}

function resolveConnection(fixture, environment) {
  const connection = fixture.connection || {};
  const urlEnv = connection.urlEnv || "OXIDE_DRIVER_CONFORMANCE_URL";
  assert(ENV_NAME.test(urlEnv), "Fixture connection.urlEnv is invalid");
  const url = environment[urlEnv] || connection.defaultUrl;
  assert(typeof url === "string" && url.trim(), `Conformance connection URL is missing (${urlEnv})`);
  const options = {};
  for (const [name, envName] of Object.entries(connection.optionsEnv || {})) {
    assert(SAFE_TOKEN.test(name), "Fixture connection option name is invalid");
    assert(typeof envName === "string" && ENV_NAME.test(envName), "Fixture connection option environment name is invalid");
    assert(environment[envName] != null, `Conformance connection option is missing (${envName})`);
    options[name] = environment[envName];
  }
  return { url, options };
}

function queryParams(connectionId, query, transactionId = null) {
  return {
    // `DriverRequest` is a tagged Rust enum. Its variant fields intentionally
    // retain their serde names (snake_case), while nested protocol structs
    // such as `DriverQueryContext` use camelCase. Keep this boundary explicit:
    // using host/UI casing here makes a sidecar return INVALID_REQUEST.
    connection_id: connectionId,
    statement: query.statement,
    parameters: (query.parameters || []).map((parameter) =>
      parameter && typeof parameter === "object" && Object.hasOwn(parameter, "value")
        ? parameter
        : { value: parameter },
    ),
    context: {
      database: query.context?.database ?? null,
      schema: query.context?.schema ?? null,
      transactionId: transactionId ?? query.context?.transactionId ?? null,
      readOnly: query.context?.readOnly === true,
    },
    query_id: query.queryId ?? null,
  };
}

function assertResultKind(result, kind) {
  assert(result?.kind === kind, `Driver returned ${result?.kind || "no"} result instead of ${kind}`);
  return result.value;
}

function valueAtPath(value, path = []) {
  let current = value;
  for (const part of path) current = current?.[part];
  return current;
}

function assertValue(value, expectation = {}) {
  if (expectation.type) {
    const actual = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
    assert(actual === expectation.type, `Expected ${expectation.type} response value`);
  }
  if (expectation.minItems != null) {
    assert(Array.isArray(value) && value.length >= expectation.minItems, "Response contained too few items");
  }
  if (Object.hasOwn(expectation, "equals")) {
    assert(JSON.stringify(value) === JSON.stringify(expectation.equals), "Response value did not match fixture expectation");
  }
  if (Object.hasOwn(expectation, "contains")) {
    assert(Array.isArray(value), "Contains expectation requires an array response");
    const contains = expectation.contains;
    const found = value.some((item) => {
      const candidate = contains.path ? valueAtPath(item, contains.path) : item;
      return JSON.stringify(candidate) === JSON.stringify(contains.equals);
    });
    assert(found, "Response did not contain the required fixture value");
  }
}

function assertQueryResult(value, expectation = {}) {
  assert(Array.isArray(value), "Query result must be an array");
  assert(value.length >= (expectation.minResultSets ?? 1), "Query returned too few result sets");
  const first = value[0];
  assert(Array.isArray(first?.columns), "Query result columns are missing");
  assert(Array.isArray(first?.rows), "Query result rows are missing");
  if (expectation.minRows != null) assert(first.rows.length >= expectation.minRows, "Query returned too few rows");
  if (expectation.columns) {
    const names = first.columns.map((column) => column.name);
    for (const name of expectation.columns) assert(names.includes(name), `Query result column ${name} is missing`);
  }
  if (expectation.firstRow) {
    assert(JSON.stringify(first.rows[0]) === JSON.stringify(expectation.firstRow), "Query first row did not match fixture expectation");
  }
}

function validateMigrationDescriptor(value, path = "descriptor") {
  if (Array.isArray(value)) {
    assert(value.length <= 20_000, `${path} contains too many items`);
    value.forEach((item, index) => validateMigrationDescriptor(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    assert(
      !FORBIDDEN_MIGRATION_DESCRIPTOR_KEYS.has(key.replaceAll("_", "").toLowerCase()),
      `${path} must not contain Host SQL or DDL`,
    );
    validateMigrationDescriptor(item, `${path}.${key}`);
  }
}

function validateSemanticSnapshot(snapshot, label) {
  assert(snapshot?.snapshotVersion === 1, `${label} snapshotVersion must be 1`);
  assert(typeof snapshot.fingerprint === "string" && snapshot.fingerprint.length <= 256, `${label} fingerprint is invalid`);
  assert(typeof snapshot.namespace === "string" && snapshot.namespace.length > 0 && snapshot.namespace.length <= 256, `${label} namespace is invalid`);
  assert(snapshot.descriptor && typeof snapshot.descriptor === "object" && !Array.isArray(snapshot.descriptor), `${label} descriptor must be an object`);
  assert(JSON.stringify(snapshot).length <= 2 * 1024 * 1024, `${label} snapshot exceeds the conformance limit`);
  validateMigrationDescriptor(snapshot.descriptor, `${label}.descriptor`);
}

function assertOpaqueToken(value, label) {
  assert(typeof value === "string" && value.length > 0 && value.length <= 4096, `${label} is invalid`);
}

function operationRecorder() {
  const operations = [];
  return {
    async run(operation, checks, action) {
      const item = { operation, status: "running", checks: [...checks] };
      operations.push(item);
      try {
        const value = await action();
        item.status = "passed";
        return value;
      } catch (error) {
        item.status = "failed";
        item.failureCode = error instanceof DriverProtocolResponseError ? error.code : "CONFORMANCE_CHECK_FAILED";
        throw error;
      }
    },
    operations,
  };
}

function validateManifestFixture(manifest, fixture) {
  assert(manifest?.schemaVersion === 1, "Driver package manifest schemaVersion must be 1");
  for (const [label, value] of [
    ["packageId", manifest.packageId],
    ["packageVersion", manifest.packageVersion],
    ["driverId", manifest.driverId],
  ]) assert(typeof value === "string" && SAFE_TOKEN.test(value), `Driver manifest ${label} is invalid`);
  assert(fixture?.schemaVersion === 1, "Conformance fixture schemaVersion must be 1");
  assert(typeof fixture.id === "string" && SAFE_TOKEN.test(fixture.id), "Conformance fixture id is invalid");
  assert(fixture.driverId === manifest.driverId, "Conformance fixture driverId does not match the package");
  assert(fixture.query?.statement, "Conformance fixture must include a parameterized query check");
  assert((fixture.query.parameters || []).length > 0, "Query conformance requires at least one bound parameter");
  assert(fixture.errorMapping?.statement, "Conformance fixture must include an error-mapping check");
  assert((fixture.errorMapping.expectedCodes || []).length > 0, "Error-mapping check requires expectedCodes");
  const declaresDatabaseCatalogs = manifest.capabilities?.supportsDatabaseCatalogs === true;
  if (declaresDatabaseCatalogs) {
    assert(fixture.databaseScope?.statement, "Database-catalog packages require a databaseScope query fixture");
    assert(
      typeof fixture.databaseScope.context?.database === "string" && fixture.databaseScope.context.database.trim(),
      "Database-scope conformance requires an explicit database context",
    );
    assert(
      Array.isArray(fixture.databaseScope.expect?.firstRow) && fixture.databaseScope.expect.firstRow.length > 0,
      "Database-scope conformance requires an exact first-row proof",
    );
  } else {
    assert(!fixture.databaseScope, "A databaseScope fixture requires signed database-catalog capability");
  }
  if (fixture.migration) {
    assert(manifest.schemaMigration?.snapshotVersion === 1, "Migration fixture requires a signed schemaMigration contract");
    assert(["transactional", "nonTransactional"].includes(manifest.schemaMigration.mode), "Migration contract mode is invalid");
    assert(manifest.capabilities?.supportsTableDdl === true, "Migration fixture requires table DDL capability");
    if (manifest.schemaMigration.mode === "transactional") {
      assert(manifest.capabilities?.supportsTransactions === true, "Transactional migration requires transaction capability");
    }
    validateSemanticSnapshot(fixture.migration.source, "migration source");
    validateSemanticSnapshot(fixture.migration.target, "migration target");
  }
}

export async function runDriverConformance({
  manifestPath,
  fixturePath,
  environment = process.env,
  target,
  javaBinary = null,
  launchOverride = null,
  now = () => new Date(),
}) {
  const manifestBytes = await readFile(manifestPath);
  const fixtureBytes = await readFile(fixturePath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const fixture = JSON.parse(fixtureBytes.toString("utf8"));
  validateManifestFixture(manifest, fixture);
  const packageRoot = dirname(resolve(manifestPath));
  const launch = launchOverride || await packageLaunch(manifest, packageRoot, javaBinary);
  const entrypoint = packageFile(packageRoot, manifest.entrypoint, "Driver entrypoint");
  assert((await sha256File(entrypoint)).toLowerCase() === String(manifest.sha256).toLowerCase(), "Driver entrypoint SHA-256 does not match the package manifest");
  const connection = resolveConnection(fixture, environment);
  const connectionId = `conformance-${createHash("sha256").update(`${manifest.driverId}:${fixture.id}`).digest("hex").slice(0, 16)}`;
  const recorder = operationRecorder();
  const startedAt = now().toISOString();
  const client = new SidecarClient(
    launch.command,
    launch.args || [],
    packageRoot,
    safeChildEnvironment({
      OXIDE_DRIVER_PACKAGE_ID: manifest.packageId,
      OXIDE_DRIVER_PACKAGE_VERSION: manifest.packageVersion,
      OXIDE_DRIVER_ID: manifest.driverId,
    }),
    fixture.timeoutMs || DEFAULT_TIMEOUT_MS,
  );
  let serverVersion;
  try {
    await recorder.run("connect", ["handshake", "connect", "ping", "serverVersion"], async () => {
      const handshake = assertResultKind(await client.request("handshake", {
        protocolVersion: manifest.protocolVersion,
        hostVersion: "driver-conformance-runner",
        packageId: manifest.packageId,
        driverId: manifest.driverId,
      }), "handshake");
      assert(handshake.packageId === manifest.packageId, "Handshake packageId mismatch");
      assert(handshake.packageVersion === manifest.packageVersion, "Handshake packageVersion mismatch");
      assert(handshake.driverId === manifest.driverId, "Handshake driverId mismatch");
      assert(String(handshake.protocolVersion).split(".")[0] === String(manifest.protocolVersion).split(".")[0], "Handshake protocol major mismatch");
      const declared = manifest.capabilities || {};
      const runtime = handshake.capabilities || {};
      if (declared.supportsSqlQuery) assert(runtime.query === true, "Runtime did not prove query capability");
      if (declared.supportsTableBrowsing) assert(runtime.metadata === true, "Runtime did not prove metadata capability");
      if (declared.supportsQueryCancellation) assert(runtime.cancellation === true, "Runtime did not prove cancellation capability");
      if (declared.supportsDatabaseCatalogs) assert(runtime.databaseScopedQueries === true, "Runtime did not prove database-scoped query capability");
      if (declared.supportsTransactions || declared.supportsTableRowMutation || declared.supportsTableDataTransfer) {
        assert(runtime.transactions === true, "Runtime did not prove transaction capability");
      }
      if (manifest.schemaMigration) {
        assert(runtime.semanticSchemaMigration === true, "Runtime did not prove semantic schema migration capability");
      }
      assertResultKind(await client.request("connect", { connection_id: connectionId, config: connection }), "empty");
      const ping = await client.request("ping", { connection_id: connectionId });
      if (ping.kind === "boolean") assert(ping.value === true, "Driver ping returned false");
      else assertResultKind(ping, "empty");
      serverVersion = assertResultKind(await client.request("serverVersion", { connection_id: connectionId }), "serverVersion");
      assert(typeof serverVersion === "string" && serverVersion.trim(), "Driver did not report a server version");
      if (fixture.serverVersionPattern) {
        assert(new RegExp(fixture.serverVersionPattern).test(serverVersion), "Server version did not match fixture pattern");
      }
    });

    for (const setup of fixture.setup || []) {
      assertResultKind(await client.request("query", queryParams(connectionId, setup)), "query");
    }

    await recorder.run("query", ["parameterBinding", "resultShape", "errorMapping"], async () => {
      const results = assertResultKind(await client.request("query", queryParams(connectionId, fixture.query)), "query");
      assertQueryResult(results, fixture.query.expect);
      try {
        await client.request("query", queryParams(connectionId, fixture.errorMapping));
        throw new Error("Invalid query unexpectedly succeeded");
      } catch (error) {
        if (!(error instanceof DriverProtocolResponseError)) throw error;
        assert(fixture.errorMapping.expectedCodes.includes(error.code), "Driver returned an unclassified query error code");
      }
    });

    if (fixture.databaseScope) {
      await recorder.run("databaseScope", ["explicitDatabaseContext", "resultShape"], async () => {
        const results = assertResultKind(
          await client.request("query", queryParams(connectionId, fixture.databaseScope)),
          "query",
        );
        assertQueryResult(results, fixture.databaseScope.expect);
      });
    }

    if ((fixture.metadata || []).length > 0) {
      await recorder.run("metadata", fixture.metadata.map((item) => item.id), async () => {
        for (const item of fixture.metadata) {
          const value = assertResultKind(await client.request("metadata", {
            connection_id: connectionId,
            request: item.request,
          }), "metadata");
          assertValue(value, item.expect);
        }
      });
    }

    if (fixture.transactionRollback) {
      await recorder.run("transactions", ["begin", "parameterizedMutation", "rollback", "postRollbackVerify"], async () => {
        const transactionId = `tx-${createHash("sha256").update(fixture.id).digest("hex").slice(0, 12)}`;
        assertResultKind(await client.request("beginTransaction", {
          connection_id: connectionId,
          transaction_id: transactionId,
          context: fixture.transactionRollback.context || {},
        }), "empty");
        const mutation = assertResultKind(await client.request("query", queryParams(
          connectionId,
          fixture.transactionRollback.mutation,
          transactionId,
        )), "query");
        assertQueryResult(mutation, fixture.transactionRollback.mutation.expect || { minResultSets: 1 });
        assertResultKind(await client.request("rollbackTransaction", {
          connection_id: connectionId,
          transaction_id: transactionId,
        }), "empty");
        const verification = assertResultKind(await client.request("query", queryParams(
          connectionId,
          fixture.transactionRollback.verify,
        )), "query");
        assertQueryResult(verification, fixture.transactionRollback.verify.expect);
      });
    }

    if (fixture.migration) {
      await recorder.run("migration", ["semanticPlan", "preflight", "tokenBoundApply", "postApplyVerify"], async () => {
        const planned = assertResultKind(await client.request("planSchemaMigration", {
          connection_id: connectionId,
          request: {
            source: fixture.migration.source,
            target: fixture.migration.target,
          },
        }), "schemaMigrationPlan");
        assertOpaqueToken(planned.planId, "Migration plan id");
        assertOpaqueToken(planned.planToken, "Migration plan token");
        assert(planned.targetFingerprint === fixture.migration.target.fingerprint, "Migration plan target fingerprint mismatch");
        assert(planned.mode === manifest.schemaMigration.mode, "Migration plan mode does not match the signed contract");
        assert(Number.isInteger(planned.changeCount) && planned.changeCount > 0, "Migration plan must contain a change");
        assert(planned.blockedChangeCount === 0, "Migration conformance plan contains blocked changes");
        assert(Array.isArray(planned.preview) && planned.preview.length <= 10_000, "Migration preview is invalid");

        const preflight = assertResultKind(await client.request("preflightSchemaMigration", {
          connection_id: connectionId,
          request: {
            planToken: planned.planToken,
            targetFingerprint: planned.targetFingerprint,
          },
        }), "schemaMigrationPreflight");
        assert(preflight.planId === planned.planId, "Migration preflight plan mismatch");
        assert(preflight.targetFingerprint === planned.targetFingerprint, "Migration preflight target mismatch");
        assertOpaqueToken(preflight.preflightToken, "Migration preflight token");
        assert(preflight.ready === true, "Migration preflight did not pass");
        assert(Array.isArray(preflight.checks) && preflight.checks.every((check) => !check.blocksExecution), "Migration preflight contains a blocking check");

        const applied = assertResultKind(await client.request("applySchemaMigration", {
          connection_id: connectionId,
          request: {
            planToken: planned.planToken,
            preflightToken: preflight.preflightToken,
            targetFingerprint: planned.targetFingerprint,
            allowReview: fixture.migration.allowReview === true,
            allowDestructive: fixture.migration.allowDestructive === true,
            allowNonTransactional: fixture.migration.allowNonTransactional === true,
          },
        }), "schemaMigrationApply");
        assert(applied.planId === planned.planId, "Migration apply plan mismatch");
        assert(applied.status === "applied", "Migration was only partially applied");
        assert(applied.committedChangeCount === planned.changeCount, "Migration apply count mismatch");
        assertOpaqueToken(applied.applyToken, "Migration apply token");

        const verified = assertResultKind(await client.request("verifySchemaMigration", {
          connection_id: connectionId,
          request: {
            planToken: planned.planToken,
            applyToken: applied.applyToken,
            expectedSourceFingerprint: fixture.migration.source.fingerprint,
          },
        }), "schemaMigrationVerify");
        assert(verified.planId === planned.planId, "Migration verification plan mismatch");
        assert(verified.matchesSource === true, "Migration verification did not match the source snapshot");
        assert(verified.remainingChangeCount === 0, "Migration verification found remaining changes");
      });
    }

    for (const cleanup of fixture.cleanup || []) {
      await client.request("query", queryParams(connectionId, cleanup)).catch(() => undefined);
    }
    await client.request("disconnect", { connection_id: connectionId });
  } finally {
    await client.terminate();
  }

  const completedAt = now().toISOString();
  return {
    report: {
      schemaVersion: 1,
      runnerVersion: DRIVER_CONFORMANCE_RUNNER_VERSION,
      passed: recorder.operations.every((operation) => operation.status === "passed"),
      startedAt,
      completedAt,
      target: target || defaultTargetTriple(),
      package: {
        packageId: manifest.packageId,
        packageVersion: manifest.packageVersion,
        driverId: manifest.driverId,
        protocolVersion: manifest.protocolVersion,
        manifestSha256: sha256Bytes(manifestBytes),
        entrypointSha256: String(manifest.sha256).toLowerCase(),
      },
      fixture: { id: fixture.id, sha256: sha256Bytes(fixtureBytes) },
      serverVersion,
      operations: recorder.operations,
      privacy: {
        containsConnectionUrl: false,
        containsCredentials: false,
        containsStatements: false,
        containsResultValues: false,
      },
    },
    manifest,
  };
}

export function evidenceReference(report, reportUrl, reportSha256) {
  assert(report?.passed === true, "Only a passing conformance report can become catalog evidence");
  const url = new URL(reportUrl);
  assert(url.protocol === "https:", "Conformance report URL must use HTTPS");
  assert(/^[a-f0-9]{64}$/i.test(reportSha256), "Conformance report SHA-256 is invalid");
  const operations = report.operations
    .filter((item) => item.status === "passed" && CATALOG_CONFORMANCE_OPERATIONS.includes(item.operation))
    .map((item) => item.operation);
  assert(operations.includes("connect"), "Catalog evidence must include connect conformance");
  return {
    schemaVersion: 1,
    runnerVersion: report.runnerVersion,
    driverId: report.package.driverId,
    packageVersion: report.package.packageVersion,
    entrypointSha256: report.package.entrypointSha256,
    target: report.target,
    serverVersion: report.serverVersion,
    fixtureId: report.fixture.id,
    fixtureSha256: report.fixture.sha256,
    reportUrl: url.toString(),
    reportSha256: reportSha256.toLowerCase(),
    operations,
  };
}

export function defaultTargetTriple() {
  if (process.platform === "win32") return process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  if (process.platform === "darwin") return process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  return process.arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";
}
