import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const h2Jar = process.env.OXIDE_H2_JAR?.trim()
  ? resolve(process.env.OXIDE_H2_JAR.trim())
  : join(homedir(), ".m2", "repository", "com", "h2database", "h2", "2.3.232", "h2-2.3.232.jar");
const javaHome = process.env.OXIDE_JAVA_HOME?.trim() || process.env.JAVA_HOME?.trim();
const javaTool = (name) => javaHome
  ? join(resolve(javaHome), "bin", process.platform === "win32" ? `${name}.exe` : name)
  : name;

async function request(process, output, id, method, params) {
  process.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  for (;;) {
    const line = await output.next();
    const response = JSON.parse(line.value);
    if (response.id === id) return response;
  }
}

function lineReader(stream) {
  let buffered = "";
  const pending = [];
  const values = [];
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffered += chunk;
    const lines = buffered.split("\n");
    buffered = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const waiter = pending.shift();
      if (waiter) waiter({ value: line }); else values.push(line);
    }
  });
  return {
    next() {
      const value = values.shift();
      if (value) return Promise.resolve({ value });
      return new Promise((resolve) => pending.push(resolve));
    },
  };
}

async function runNodeScript(args) {
  const child = spawn(process.execPath, args, { cwd: root, stdio: "pipe" });
  const [code] = await once(child, "close");
  assert.equal(code, 0, `${args[0]} should succeed`);
}

test("generic JDBC Agent executes and discovers H2 through the driver protocol", async (t) => {
  try {
    await stat(h2Jar);
  } catch {
    t.skip("H2 JDBC fixture is not present in the local Maven cache");
    return;
  }
  const temporary = await mkdtemp(join(tmpdir(), "oxide-jdbc-h2-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  await runNodeScript(["scripts/build-jdbc-driver-agent.mjs", temporary]);

  const capabilitiesPath = join(temporary, "h2-capabilities.json");
  const packageDirectory = join(temporary, "h2-package");
  await runNodeScript([
    "scripts/create-jdbc-driver-capabilities.mjs",
    "--driver", "h2",
    "--display-name", "H2",
    "--out", capabilitiesPath,
    "--dialect-profile", "h2",
    "--supports-table-constraints",
    "--supports-create-namespace",
  ]);
  await runNodeScript([
    "scripts/package-jdbc-driver.mjs",
    "--driver", "h2",
    "--display-name", "H2",
    "--client-library", "h2",
    "--client-version", "2.3.232",
    "--agent", join(temporary, "oxide-jdbc-agent.jar"),
    "--classpath", h2Jar,
    "--capabilities", capabilitiesPath,
    "--out", packageDirectory,
    "--version", "2.3.232-fixture",
    "--server-version-range", ">= 2.3.232 < 2.4.0",
    "--connection-url-template", "jdbc:h2:mem:{database};DB_CLOSE_DELAY=-1",
  ]);
  const manifest = JSON.parse(await readFile(join(packageDirectory, "manifest.json"), "utf8"));
  assert.equal(manifest.driverId, "h2");
  assert.equal(manifest.runtime.kind, "java");
  assert.equal(manifest.runtime.classpath.length, 1);
  assert.equal(manifest.serverVersionRange, ">= 2.3.232 < 2.4.0");
  assert.equal(manifest.capabilities.supportsTableDataTransfer, false);
  assert.equal(manifest.capabilities.supportsTableConstraints, true);
  assert.equal(manifest.capabilities.supportsCreateDatabase, true);

  const classpathSeparator = process.platform === "win32" ? ";" : ":";
  const agent = spawn(javaTool("java"), ["-cp", `${join(packageDirectory, manifest.entrypoint)}${classpathSeparator}${join(packageDirectory, manifest.runtime.classpath[0].path)}`, "studio.oxide.jdbc.DriverMain"], {
    cwd: root,
    env: {
      ...process.env,
      OXIDE_DRIVER_PACKAGE_ID: "oxide.jdbc.h2.fixture",
      OXIDE_DRIVER_PACKAGE_VERSION: "2.3.232",
      OXIDE_DRIVER_ID: "h2",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const output = lineReader(agent.stdout);

  const handshake = await request(agent, output, 1, "handshake", {});
  assert.equal(handshake.status, "ok");
  assert.equal(handshake.result.value.driverId, "h2");
  assert.equal(handshake.result.value.capabilities.metadata, true);
  assert.equal(handshake.result.value.capabilities.databaseScopedQueries, true);

  assert.equal((await request(agent, output, 2, "connect", {
    connection_id: "h2",
    config: { url: "jdbc:h2:mem:oxide_fixture;DB_CLOSE_DELAY=-1" },
  })).status, "ok");
  assert.equal((await request(agent, output, 3, "query", {
    connection_id: "h2",
    statement: "CREATE TABLE widgets (id INT PRIMARY KEY, name VARCHAR(40))",
    parameters: [],
  })).status, "ok");
  assert.equal((await request(agent, output, 4, "query", {
    connection_id: "h2",
    statement: "INSERT INTO widgets (id, name) VALUES (?, ?)",
    parameters: [{ value: 1 }, { value: "H2" }],
  })).status, "ok");
  assert.equal((await request(agent, output, 5, "query", {
    connection_id: "h2",
    statement: "CREATE UNIQUE INDEX widgets_name_unique ON widgets(name)",
    parameters: [],
  })).status, "ok");
  assert.equal((await request(agent, output, 6, "query", {
    connection_id: "h2",
    statement: "CREATE TABLE widget_notes (id INT PRIMARY KEY, widget_id INT NOT NULL, CONSTRAINT widget_notes_widget_fk FOREIGN KEY (widget_id) REFERENCES widgets(id))",
    parameters: [],
  })).status, "ok");
  const query = await request(agent, output, 13, "query", {
    connection_id: "h2",
    statement: "SELECT id, name, TRUE AS enabled, CAST(1.25 AS DECIMAL(4, 2)) AS score FROM widgets",
    parameters: [],
  });
  assert.deepEqual(query.result.value[0].rows, [[1, "H2", true, 1.25]]);
  const invalidQuery = await request(agent, output, 14, "query", {
    connection_id: "h2",
    statement: "SELECT * FROM oxide_fixture_missing_table",
    parameters: [],
  });
  assert.equal(invalidQuery.status, "error");
  assert.equal(invalidQuery.result.code, "QUERY_FAILED");
  assert.equal(JSON.stringify(invalidQuery).includes("jdbc:h2:mem:oxide_fixture"), false);

  const currentCatalog = await request(agent, output, 15, "query", {
    connection_id: "h2",
    statement: "SELECT CURRENT_CATALOG AS catalog_name, CURRENT_SCHEMA AS schema_name",
    parameters: [],
  });
  assert.equal(currentCatalog.status, "ok");
  const [catalogName, schemaName] = currentCatalog.result.value[0].rows[0];
  const scopedQuery = await request(agent, output, 16, "query", {
    connection_id: "h2",
    statement: "SELECT CURRENT_CATALOG AS catalog_name, CURRENT_SCHEMA AS schema_name",
    parameters: [],
    context: { database: catalogName, schema: schemaName },
  });
  assert.deepEqual(scopedQuery.result.value[0].rows[0], [catalogName, schemaName]);

  const rejectedCatalog = await request(agent, output, 17, "query", {
    connection_id: "h2",
    statement: "SELECT CURRENT_CATALOG",
    parameters: [],
    context: { database: "OXIDE_MISSING_CATALOG" },
  });
  assert.equal(rejectedCatalog.status, "error");
  assert.equal(rejectedCatalog.result.code, "QUERY_FAILED");

  const restoredContext = await request(agent, output, 18, "query", {
    connection_id: "h2",
    statement: "SELECT CURRENT_CATALOG AS catalog_name, CURRENT_SCHEMA AS schema_name",
    parameters: [],
  });
  assert.deepEqual(restoredContext.result.value[0].rows[0], [catalogName, schemaName]);

  const invalidContext = await request(agent, output, 19, "query", {
    connection_id: "h2",
    statement: "SELECT 1",
    parameters: [],
    context: { database: "bad\ncontext" },
  });
  assert.equal(invalidContext.status, "error");
  assert.equal(invalidContext.result.code, "QUERY_FAILED");

  assert.equal((await request(agent, output, 7, "createDatabase", {
    connection_id: "h2",
    request: { name: "fixture_schema", namespaceKind: "schema" },
  })).status, "ok");

  const relations = await request(agent, output, 8, "metadata", {
    connection_id: "h2",
    request: { kind: "relations", namespace: "PUBLIC" },
  });
  assert.ok(relations.result.value.some((relation) => relation.name === "WIDGETS"));
  const columns = await request(agent, output, 9, "metadata", {
    connection_id: "h2",
    request: { kind: "columns", namespace: "PUBLIC", relation: "WIDGETS" },
  });
  assert.ok(columns.result.value.some((column) => column.name === "ID" && column.is_primary_key));
  assert.ok(columns.result.value.some((column) => column.name === "NAME" && column.is_unique));
  const indexes = await request(agent, output, 10, "metadata", {
    connection_id: "h2",
    request: { kind: "indexes", namespace: "PUBLIC", relation: "WIDGETS" },
  });
  assert.ok(indexes.result.value.some((index) => index.name === "WIDGETS_NAME_UNIQUE" && index.is_unique));
  const constraints = await request(agent, output, 11, "metadata", {
    connection_id: "h2",
    request: { kind: "constraints", namespace: "PUBLIC", relation: "WIDGET_NOTES" },
  });
  assert.ok(constraints.result.value.some((constraint) => constraint.constraint_type === "FOREIGN KEY" && constraint.referenced_table === "WIDGETS"));
  const references = await request(agent, output, 12, "metadata", {
    connection_id: "h2",
    request: { kind: "referencingForeignKeys", namespace: "PUBLIC", relation: "WIDGETS" },
  });
  assert.ok(references.result.value.some((reference) => reference.table === "WIDGET_NOTES" && reference.referenced_table === "WIDGETS"));

  agent.stdin.end();
  await once(agent, "close");
});
