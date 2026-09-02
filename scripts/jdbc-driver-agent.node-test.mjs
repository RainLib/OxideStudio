import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const javaHome = process.env.OXIDE_JAVA_HOME?.trim() || process.env.JAVA_HOME?.trim();
const javaTool = (name) => javaHome
  ? join(resolve(javaHome), "bin", process.platform === "win32" ? `${name}.exe` : name)
  : name;

async function commandAvailable(command) {
  const child = spawn(command, ["-version"], { cwd: root, stdio: "ignore" });
  const [code] = await once(child, "close").catch(() => [null]);
  return code === 0;
}

async function requireJdk(t) {
  if (await commandAvailable(javaTool("java")) && await commandAvailable(javaTool("javac"))) return true;
  t.skip("JDK fixture is not available on this runner");
  return false;
}

test("JDBC Agent advertises cancellable queries and responds to a bounded cancel", async (t) => {
  if (!(await requireJdk(t))) return;
  const temporary = await mkdtemp(join(tmpdir(), "oxide-jdbc-agent-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const build = spawn(process.execPath, ["scripts/build-jdbc-driver-agent.mjs", temporary], {
    cwd: root,
    stdio: "pipe",
  });
  const [buildCode] = await once(build, "close");
  assert.equal(buildCode, 0, "JDBC Agent should compile");

  const agent = spawn(javaTool("java"), ["-jar", join(temporary, "oxide-jdbc-agent.jar")], {
    cwd: root,
    env: {
      ...process.env,
      OXIDE_DRIVER_PACKAGE_ID: "oxide.jdbc.fixture",
      OXIDE_DRIVER_PACKAGE_VERSION: "1.0.0",
      OXIDE_DRIVER_ID: "fixture",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  agent.stdout.setEncoding("utf8");
  agent.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  agent.stdin.write(`${JSON.stringify({ id: 1, method: "handshake", params: {} })}\n`);
  agent.stdin.write(`${JSON.stringify({ id: 2, method: "cancel", params: { connection_id: "missing", query_id: "q1" } })}\n`);
  agent.stdin.end();
  const [code] = await once(agent, "close");
  assert.equal(code, 0);

  const responses = stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const handshake = responses.find((response) => response.id === 1);
  const cancel = responses.find((response) => response.id === 2);
  assert.equal(handshake?.status, "ok");
  assert.equal(handshake?.result?.value?.capabilities?.cancellation, true);
  assert.deepEqual(cancel, { id: 2, status: "ok", result: { kind: "boolean", value: false } });
});

test("JDBC Agent scopes schema metadata to the requested catalog", async (t) => {
  if (!(await requireJdk(t))) return;
  const temporary = await mkdtemp(join(tmpdir(), "oxide-jdbc-catalog-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const build = spawn(process.execPath, ["scripts/build-jdbc-driver-agent.mjs", temporary], {
    cwd: root,
    stdio: "pipe",
  });
  const [buildCode] = await once(build, "close");
  assert.equal(buildCode, 0, "JDBC Agent should compile");

  const sourceDirectory = join(temporary, "fixture");
  const classesDirectory = join(temporary, "classes");
  await mkdir(sourceDirectory, { recursive: true });
  await writeFile(
    join(sourceDirectory, "CatalogDriver.java"),
    `package fixture;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.Driver;
import java.sql.DriverManager;
import java.sql.DriverPropertyInfo;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Properties;
import java.util.logging.Logger;

public final class CatalogDriver implements Driver {
  static { try { DriverManager.registerDriver(new CatalogDriver()); } catch (SQLException error) { throw new RuntimeException(error); } }
  public boolean acceptsURL(String url) { return url != null && url.startsWith("jdbc:oxide-catalog:"); }
  public Connection connect(String url, Properties properties) {
    if (!acceptsURL(url)) return null;
    return (Connection) Proxy.newProxyInstance(CatalogDriver.class.getClassLoader(), new Class<?>[] { Connection.class }, connectionHandler());
  }
  public int getMajorVersion() { return 1; }
  public int getMinorVersion() { return 0; }
  public boolean jdbcCompliant() { return false; }
  public Logger getParentLogger() { return Logger.getGlobal(); }
  public DriverPropertyInfo[] getPropertyInfo(String url, Properties properties) { return new DriverPropertyInfo[0]; }

  private static InvocationHandler connectionHandler() {
    return (proxy, method, args) -> switch (method.getName()) {
      case "getMetaData" -> Proxy.newProxyInstance(CatalogDriver.class.getClassLoader(), new Class<?>[] { DatabaseMetaData.class }, metadataHandler());
      case "isValid" -> true;
      case "isClosed" -> false;
      case "close", "setAutoCommit", "commit", "rollback" -> null;
      case "unwrap" -> null;
      case "isWrapperFor" -> false;
      default -> defaultValue(method.getReturnType());
    };
  }

  private static InvocationHandler metadataHandler() {
    return (proxy, method, args) -> {
      if ("getSchemas".equals(method.getName())) {
        String catalog = args == null || args.length == 0 || args[0] == null ? "default" : String.valueOf(args[0]);
        return resultSet("TABLE_SCHEM", List.of(catalog + "_schema"));
      }
      if ("getCatalogs".equals(method.getName())) return resultSet("TABLE_CAT", List.of("first", "second"));
      if ("getIdentifierQuoteString".equals(method.getName())) return "\\\"";
      return defaultValue(method.getReturnType());
    };
  }

  private static ResultSet resultSet(String column, List<String> values) {
    final int[] index = new int[] { -1 };
    return (ResultSet) Proxy.newProxyInstance(CatalogDriver.class.getClassLoader(), new Class<?>[] { ResultSet.class }, (proxy, method, args) -> {
      if ("next".equals(method.getName())) return ++index[0] < values.size();
      if ("getString".equals(method.getName())) return values.get(index[0]);
      if ("close".equals(method.getName())) return null;
      if ("wasNull".equals(method.getName())) return false;
      return defaultValue(method.getReturnType());
    });
  }

  private static Object defaultValue(Class<?> type) {
    if (!type.isPrimitive()) return null;
    if (type == boolean.class) return false;
    if (type == byte.class) return (byte) 0;
    if (type == short.class) return (short) 0;
    if (type == int.class) return 0;
    if (type == long.class) return 0L;
    if (type == float.class) return 0f;
    if (type == double.class) return 0d;
    if (type == char.class) return (char) 0;
    return null;
  }
}
`,
  );
  const compileFixture = spawn(javaTool("javac"), ["-d", classesDirectory, join(sourceDirectory, "CatalogDriver.java")], {
    cwd: root,
    stdio: "pipe",
  });
  const [compileCode] = await once(compileFixture, "close");
  assert.equal(compileCode, 0, "Catalog fixture should compile");

  const agent = spawn(
    javaTool("java"),
    [
      "-Djdbc.drivers=fixture.CatalogDriver",
      "-cp",
      `${join(temporary, "oxide-jdbc-agent.jar")}${delimiter}${classesDirectory}`,
      "studio.oxide.jdbc.DriverMain",
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        OXIDE_DRIVER_PACKAGE_ID: "oxide.jdbc.fixture",
        OXIDE_DRIVER_PACKAGE_VERSION: "1.0.0",
        OXIDE_DRIVER_ID: "fixture",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let responseBuffer = "";
  let resolveMetadata;
  const metadataResponse = new Promise((resolveResponse) => {
    resolveMetadata = resolveResponse;
  });
  agent.stdout.setEncoding("utf8");
  agent.stdout.on("data", (chunk) => {
    stdout += chunk;
    responseBuffer += chunk;
    const lines = responseBuffer.split("\n");
    responseBuffer = lines.pop() || "";
    for (const line of lines.filter(Boolean)) {
      const response = JSON.parse(line);
      if (response.id === 2) resolveMetadata(response);
    }
  });
  agent.stdin.write(`${JSON.stringify({
    id: 1,
    method: "connect",
    params: { connection_id: "catalog", config: { url: "jdbc:oxide-catalog:test" } },
  })}\n`);
  agent.stdin.write(`${JSON.stringify({
    id: 2,
    method: "metadata",
    params: {
      connection_id: "catalog",
      request: { kind: "schemas", database: "second" },
    },
  })}\n`);
  const response = await metadataResponse;
  agent.stdin.end();
  const [code] = await once(agent, "close");
  assert.equal(code, 0);
  assert.deepEqual(response, {
    id: 2,
    status: "ok",
    result: { kind: "metadata", value: ["second_schema"] },
  });
});

test("JDBC Agent keeps Oracle SDE geometry rows readable when vendor object decoding fails", async (t) => {
  if (!(await requireJdk(t))) return;
  const temporary = await mkdtemp(join(tmpdir(), "oxide-jdbc-oracle-sde-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const build = spawn(process.execPath, ["scripts/build-jdbc-driver-agent.mjs", temporary], {
    cwd: root,
    stdio: "pipe",
  });
  const [buildCode] = await once(build, "close");
  assert.equal(buildCode, 0, "JDBC Agent should compile");

  const sourceDirectory = join(temporary, "fixture");
  const classesDirectory = join(temporary, "classes");
  await mkdir(sourceDirectory, { recursive: true });
  await writeFile(
    join(sourceDirectory, "OracleSdeDriver.java"),
    `package fixture;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Proxy;
import java.io.StringReader;
import java.sql.Connection;
import java.sql.Driver;
import java.sql.DriverManager;
import java.sql.DriverPropertyInfo;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.util.Properties;
import java.util.logging.Logger;

public final class OracleSdeDriver implements Driver {
  static { try { DriverManager.registerDriver(new OracleSdeDriver()); } catch (SQLException error) { throw new RuntimeException(error); } }
  public boolean acceptsURL(String url) { return url != null && url.startsWith("jdbc:oxide-oracle-sde:"); }
  public Connection connect(String url, Properties properties) {
    if (!acceptsURL(url)) return null;
    return (Connection) Proxy.newProxyInstance(OracleSdeDriver.class.getClassLoader(), new Class<?>[] { Connection.class }, (proxy, method, args) -> {
      if ("prepareStatement".equals(method.getName())) return statement((String) args[0]);
      if ("isValid".equals(method.getName())) return true;
      if ("isClosed".equals(method.getName())) return false;
      if ("close".equals(method.getName())) return null;
      return defaultValue(method.getReturnType());
    });
  }
  public int getMajorVersion() { return 1; }
  public int getMinorVersion() { return 0; }
  public boolean jdbcCompliant() { return false; }
  public Logger getParentLogger() { return Logger.getGlobal(); }
  public DriverPropertyInfo[] getPropertyInfo(String url, Properties properties) { return new DriverPropertyInfo[0]; }

  private static PreparedStatement statement(String sql) {
    return (PreparedStatement) Proxy.newProxyInstance(OracleSdeDriver.class.getClassLoader(), new Class<?>[] { PreparedStatement.class }, (proxy, method, args) -> {
      if ("execute".equals(method.getName())) return true;
      if ("getResultSet".equals(method.getName())) return resultSet();
      if ("executeQuery".equals(method.getName())) return objectSourceResultSet(sql);
      if ("close".equals(method.getName()) || "setQueryTimeout".equals(method.getName()) || "setFetchSize".equals(method.getName())) return null;
      return defaultValue(method.getReturnType());
    });
  }

  private static ResultSet objectSourceResultSet(String sql) {
    final boolean metadataQuery = sql.contains("DBMS_METADATA.GET_DDL");
    final int[] row = new int[] { -1 };
    return (ResultSet) Proxy.newProxyInstance(OracleSdeDriver.class.getClassLoader(), new Class<?>[] { ResultSet.class }, (proxy, method, args) -> {
      if ("next".equals(method.getName())) return metadataQuery && ++row[0] == 0;
      if ("getCharacterStream".equals(method.getName())) return new StringReader("CREATE MATERIALIZED VIEW \\\"HR\\\".\\\"SALES_MV\\\" AS SELECT 1");
      if ("getString".equals(method.getName())) return "CREATE MATERIALIZED VIEW \\\"HR\\\".\\\"SALES_MV\\\" AS SELECT 1";
      if ("close".equals(method.getName())) return null;
      return defaultValue(method.getReturnType());
    });
  }

  private static ResultSet resultSet() {
    final int[] row = new int[] { -1 };
    return (ResultSet) Proxy.newProxyInstance(OracleSdeDriver.class.getClassLoader(), new Class<?>[] { ResultSet.class }, (proxy, method, args) -> {
      if ("next".equals(method.getName())) return ++row[0] < 2;
      if ("getMetaData".equals(method.getName())) return metadata();
      if ("getObject".equals(method.getName())) {
        if (((Integer) args[0]) == 2) throw new SQLException("SDE object decoding is unavailable");
        return row[0] + 41;
      }
      if ("getString".equals(method.getName())) {
        if (((Integer) args[0]) == 2 && row[0] == 1) throw new SQLException("SDE text conversion is unavailable");
        return ((Integer) args[0]) == 2 ? "POINT (1 2)" : String.valueOf(row[0] + 41);
      }
      if ("wasNull".equals(method.getName())) return false;
      if ("close".equals(method.getName())) return null;
      return defaultValue(method.getReturnType());
    });
  }

  private static ResultSetMetaData metadata() {
    return (ResultSetMetaData) Proxy.newProxyInstance(OracleSdeDriver.class.getClassLoader(), new Class<?>[] { ResultSetMetaData.class }, (proxy, method, args) -> {
      if ("getColumnCount".equals(method.getName())) return 2;
      if ("getColumnLabel".equals(method.getName())) return ((Integer) args[0]) == 1 ? "ID" : "SHAPE";
      if ("getColumnTypeName".equals(method.getName())) return ((Integer) args[0]) == 1 ? "NUMBER" : "SDE.ST_GEOMETRY";
      return defaultValue(method.getReturnType());
    });
  }

  private static Object defaultValue(Class<?> type) {
    if (!type.isPrimitive()) return null;
    if (type == boolean.class) return false;
    if (type == byte.class) return (byte) 0;
    if (type == short.class) return (short) 0;
    if (type == int.class) return 0;
    if (type == long.class) return 0L;
    if (type == float.class) return 0f;
    if (type == double.class) return 0d;
    if (type == char.class) return (char) 0;
    return null;
  }
}
`,
  );
  const compileFixture = spawn(javaTool("javac"), ["-d", classesDirectory, join(sourceDirectory, "OracleSdeDriver.java")], {
    cwd: root,
    stdio: "pipe",
  });
  const [compileCode] = await once(compileFixture, "close");
  assert.equal(compileCode, 0, "Oracle SDE fixture should compile");

  const agent = spawn(
    javaTool("java"),
    [
      "-Djdbc.drivers=fixture.OracleSdeDriver",
      "-cp",
      `${join(temporary, "oxide-jdbc-agent.jar")}${delimiter}${classesDirectory}`,
      "studio.oxide.jdbc.DriverMain",
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        OXIDE_DRIVER_PACKAGE_ID: "oxide.jdbc.oracle.fixture",
        OXIDE_DRIVER_PACKAGE_VERSION: "1.0.0",
        OXIDE_DRIVER_ID: "oracle",
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let responseBuffer = "";
  let resolveQuery;
  let resolveMetadata;
  const queryResponse = new Promise((resolveResponse) => {
    resolveQuery = resolveResponse;
  });
  const metadataResponse = new Promise((resolveResponse) => {
    resolveMetadata = resolveResponse;
  });
  agent.stdout.setEncoding("utf8");
  agent.stdout.on("data", (chunk) => {
    responseBuffer += chunk;
    const lines = responseBuffer.split("\n");
    responseBuffer = lines.pop() || "";
    for (const line of lines.filter(Boolean)) {
      const response = JSON.parse(line);
      if (response.id === 2) resolveQuery(response);
      if (response.id === 3) resolveMetadata(response);
    }
  });
  agent.stdin.write(`${JSON.stringify({
    id: 1,
    method: "connect",
    params: { connection_id: "oracle", config: { url: "jdbc:oxide-oracle-sde:test" } },
  })}\n`);
  agent.stdin.write(`${JSON.stringify({
    id: 2,
    method: "query",
    params: { connection_id: "oracle", statement: "SELECT id, shape FROM parcels", parameters: [], context: {} },
  })}\n`);
  agent.stdin.write(`${JSON.stringify({
    id: 3,
    method: "metadata",
    params: {
      connection_id: "oracle",
      request: { kind: "objectSource", namespace: "HR", object_name: "SALES_MV", object_type: "MATERIALIZED_VIEW" },
    },
  })}\n`);
  const [response, sourceResponse] = await Promise.all([queryResponse, metadataResponse]);
  agent.stdin.end();
  const [code] = await once(agent, "close");
  assert.equal(code, 0);
  assert.deepEqual(response?.result?.value?.[0]?.rows, [
    [41, "POINT (1 2)"],
    [42, "<SDE.ST_GEOMETRY unavailable in generic JDBC Agent>"],
  ]);
  assert.deepEqual(sourceResponse?.result?.value, [
    'CREATE MATERIALIZED VIEW "HR"."SALES_MV" AS SELECT 1',
  ]);
});
