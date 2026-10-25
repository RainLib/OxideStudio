import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import {
  evidenceReference,
  runDriverConformance,
  sha256Bytes,
} from "./lib/driver-conformance.mjs";

import {tempFixture,removeFixture} from "../tests/helpers/driverConformanceFixture.mjs";

test("driver conformance runner emits privacy-bounded catalog evidence", async (t) => {
  const fixture = await tempFixture();
  t.after(() => removeFixture(fixture.root));
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
  t.after(() => removeFixture(fixture.root));
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
  t.after(() => removeFixture(fixture.root));
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
  t.after(() => removeFixture(fixture.root));
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
  t.after(() => removeFixture(fixture.root));
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
