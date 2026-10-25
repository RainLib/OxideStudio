// Exercise production SQL drivers against private Windows servers, without Docker/services.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arguments_ = process.argv.slice(2);
assert.ok(
  arguments_.length === 0 ||
    (arguments_.length === 1 &&
      ["--transfers-only", "--postgres-million", "--mysql-contract", "--mysql-transfers", "--mysql-million", "--compare-only"].includes(arguments_[0])),
  "Usage: node scripts/test-native-sql-databases.mjs [--transfers-only|--postgres-million|--mysql-contract|--mysql-transfers|--mysql-million|--compare-only]",
);
const comparisonOnly = arguments_[0] === "--compare-only";
const transfersOnly = arguments_[0] === "--transfers-only";
const millionOnly = arguments_[0] === "--postgres-million";
const mysqlContractOnly = arguments_[0] === "--mysql-contract";
const mysqlTransfersOnly = arguments_[0] === "--mysql-transfers";
const mysqlMillionOnly = arguments_[0] === "--mysql-million";
const mysqlOnly = mysqlContractOnly || mysqlTransfersOnly || mysqlMillionOnly;
const mysqlLabel = mysqlContractOnly ? "mysql-contract" : mysqlMillionOnly ? "mysql-million" : "mysql-transfers";
assert.equal(
  process.platform,
  "win32",
  "This native fixture currently supports Windows; use the Docker fixture on Linux",
);
const binDirectories = {};
for (const [engine, variable, names] of [
  [
    "postgres",
    "OXIDE_POSTGRES_BIN",
    ["postgres.exe", "initdb.exe", "pg_ctl.exe", "psql.exe"],
  ],
  ["mysql", "OXIDE_MYSQL_BIN", ["mysqld.exe", "mysql.exe", "mysqladmin.exe"]],
]) {
  assert.ok(
    process.env[variable]?.trim(),
    `Set ${variable} to the extracted native server bin directory`,
  );
  binDirectories[engine] = await fs.realpath(process.env[variable]);
  for (const name of names) {
    assert.ok(
      (await fs.stat(path.join(binDirectories[engine], name))).isFile(),
      `Missing ${engine} executable: ${name}`,
    );
  }
}

const directory = await fs.mkdtemp(
  path.join(os.tmpdir(), "oxide-native-sql-acceptance-"),
);
const password = randomBytes(32).toString("hex");
const user = "oxide_fixture";
const servers = [];
const commands = new Set();
const controller = new AbortController();
const evidence = {
  version: 1,
  platform: process.platform,
  arch: process.arch,
  createdAt: new Date().toISOString(),
  servers: {},
  tests: {},
  success: false,
  scope: comparisonOnly ? "sampled-comparisons" : mysqlMillionOnly ? "mysql-million" : mysqlTransfersOnly ? "mysql-transfers" : mysqlContractOnly
    ? "mysql-engine-contract"
    : millionOnly
      ? "postgres-million"
      : transfersOnly
        ? "postgres-transfers"
        : "sql-and-durable-transfers",
};
const executable = (engine, name) =>
  path.join(binDirectories[engine], `${name}.exe`);
const redact = (text) => text.replaceAll(password, "[fixture password]");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForServerExit(server, milliseconds) {
  let timer;
  try {
    await Promise.race([
      server.completion,
      new Promise((resolve) => { timer = setTimeout(resolve, milliseconds); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
const interrupt = () => controller.abort();
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function run(
  command,
  args,
  {
    env = process.env,
    input,
    name = "command",
    timeout = 120_000,
    echo = false,
    cleanup = false,
    stdoutOnly = false,
  } = {},
) {
  if (!cleanup) controller.signal.throwIfAborted();
  const child = spawn(command, args, {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  commands.add(child);
  let output = "",
    stdout = "",
    size = 0;
  const append = (chunk, isStdout) => {
    size += chunk.length;
    if (size <= 4 * 1024 * 1024) {
      output += chunk.toString();
      if (stdoutOnly && isStdout) stdout += chunk.toString();
    } else child.kill();
  };
  child.stdout.on("data", (chunk) => append(chunk, true));
  child.stderr.on("data", (chunk) => append(chunk, false));
  if (echo) {
    for (const stream of [child.stdout, child.stderr]) {
      createInterface({ input: stream, crlfDelay: Infinity }).on(
        "line",
        (line) => process.stdout.write(`${redact(line)}\n`),
      );
    }
  }
  child.stdin.on("error", () => {});
  child.stdin.end(input);
  const abort = () => child.kill();
  if (!cleanup)
    controller.signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeout);
  let code;
  try {
    code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener("abort", abort);
    commands.delete(child);
  }
  output = redact(output);
  await fs.writeFile(path.join(directory, `${name}.log`), output, {
    mode: 0o600,
  });
  assert.ok(size <= 4 * 1024 * 1024, `${name} output exceeded its budget`);
  assert.equal(
    code,
    0,
    `${name} failed (${code}); inspect its private acceptance log`,
  );
  return stdoutOnly ? redact(stdout) : output;
}

async function port() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const result = listener.address().port;
  await new Promise((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  return result;
}

function start(engine, command, args) {
  const log = createWriteStream(path.join(directory, `${engine}-server.log`), {
    flags: "wx",
    mode: 0o600,
  });
  const child = spawn(command, args, {
    cwd: directory,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const server = { engine, child, exited: false, error: null };
  server.completion = new Promise((resolve) => {
    child.once("error", (error) => {
      server.error = error;
    });
    child.once("close", (code, signal) => {
      server.exited = true;
      server.code = code;
      server.signal = signal;
      log.end(resolve);
    });
  });
  servers.push(server);
  return server;
}

async function ready(server, probe) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    controller.signal.throwIfAborted();
    assert.ok(
      !server.exited && !server.error,
      `${server.engine} exited before becoming ready`,
    );
    try {
      return await probe();
    } catch {
      /* An authenticated query, not an open TCP port, establishes readiness. */
    }
    await delay(500);
  }
  throw new Error(
    `${server.engine} did not become ready; inspect its private server log`,
  );
}

function passed(output, expected, label) {
  const results = [
    ...output.matchAll(
      /test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored;/g,
    ),
  ];
  assert.equal(
    results.length,
    1,
    `${label} must run exactly one selected test binary`,
  );
  assert.equal(
    Number(results[0][1]),
    expected,
    `${label} did not execute the required scenarios`,
  );
  assert.equal(Number(results[0][2]), 0);
  assert.equal(
    Number(results[0][3]),
    0,
    `${label} must execute, rather than ignore, every selected scenario`,
  );
  assert.doesNotMatch(
    output,
    /skipping live/i,
    `${label} cannot count a skipped connection as a passed test`,
  );
  return { passed: expected, failed: 0, ignored: 0 };
}

try {
  process.stdout.write(`Native SQL acceptance directory: ${directory}\n`);
  const pgVersion = (
    await run(executable("postgres", "postgres"), ["--version"], {
      name: "postgres-binary-version",
    })
  ).trim();
  const mysqlVersion = (
    await run(executable("mysql", "mysqld"), ["--no-defaults", "--version"], {
      name: "mysql-binary-version",
    })
  ).trim();
  const pgData = path.join(directory, "postgres-data");
  const mysqlData = path.join(directory, "mysql-data");
  const pgPassword = path.join(directory, "postgres-password");
  const mysqlInit = path.join(directory, "mysql-init.sql");
  await fs.writeFile(pgPassword, `${password}\n`, { flag: "wx", mode: 0o600 });
  await run(
    executable("postgres", "initdb"),
    [
      "--pgdata",
      pgData,
      "--username",
      user,
      "--pwfile",
      pgPassword,
      "--auth=scram-sha-256",
      "--encoding=UTF8",
      "--locale=C",
      "--no-instructions",
    ],
    { name: "postgres-initialize" },
  );
  await fs.unlink(pgPassword);
  await run(
    executable("mysql", "mysqld"),
    [
      "--no-defaults",
      "--initialize-insecure",
      `--basedir=${path.dirname(binDirectories.mysql)}`,
      `--datadir=${mysqlData}`,
      "--skip-networking",
    ],
    { name: "mysql-initialize" },
  );
  // Initialization never listens. The account password is set before the first network startup finishes.
  await fs.writeFile(
    mysqlInit,
    `ALTER USER 'root'@'localhost' IDENTIFIED BY '${password}';\nCREATE USER '${user}'@'127.0.0.1' IDENTIFIED BY '${password}';\nGRANT ALL PRIVILEGES ON *.* TO '${user}'@'127.0.0.1' WITH GRANT OPTION;\nCREATE DATABASE oxide;\n`,
    { flag: "wx", mode: 0o600 },
  );
  const pgPort = await port(),
    mysqlPort = await port();
  assert.notEqual(
    pgPort,
    mysqlPort,
    "OS returned a duplicate private port; rerun the fixture",
  );
  const pg = start("postgres", executable("postgres", "postgres"), [
    "-D",
    pgData,
    "-h",
    "127.0.0.1",
    "-p",
    String(pgPort),
    "-c",
    "ssl=off",
    "-c",
    "max_connections=30",
  ]);
  const mysql = start("mysql", executable("mysql", "mysqld"), [
    "--no-defaults",
    // Keep the owned PID as the actual server. The Windows RESTART monitor
    // would otherwise leave its fork alive if startup/cleanup must be killed.
    "--no-monitor",
    `--basedir=${path.dirname(binDirectories.mysql)}`,
    `--datadir=${mysqlData}`,
    "--bind-address=127.0.0.1",
    `--port=${mysqlPort}`,
    "--mysqlx=0",
    "--skip-name-resolve",
    `--init-file=${mysqlInit}`,
    "--max-connections=30",
    "--innodb-buffer-pool-size=67108864",
    "--innodb-redo-log-capacity=67108864",
    "--console",
  ]);
  const pgEnv = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)),
    ),
    PGPASSWORD: password,
    PGSSLMODE: "disable",
  };
  // MySQL 8.0 still reads .mylogin.cnf with --no-defaults and does not
  // understand the newer --no-login-paths flag. Override its login file with
  // a private, absent path for both versions; never consult the user's file
  // or inherited MYSQL_* connection/login settings.
  const mysqlEnv = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !/^MYSQL/i.test(key)),
    ),
    MYSQL_PWD: password,
    MYSQL_TEST_LOGIN_FILE: path.join(directory, "unused-mysql-login.cnf"),
  };
  const pgArgs = [
    "--no-psqlrc",
    "--no-password",
    "--host=127.0.0.1",
    `--port=${pgPort}`,
    `--username=${user}`,
    "--dbname=postgres",
    "--tuples-only",
    "--no-align",
    "--set=ON_ERROR_STOP=1",
  ];
  const mysqlConnectionArgs = [
    "--no-defaults",
    "--protocol=TCP",
    "--host=127.0.0.1",
    `--port=${mysqlPort}`,
    `--user=${user}`,
  ];
  const mysqlArgs = [
    ...mysqlConnectionArgs,
    "--batch",
    "--skip-column-names",
    "--connect-timeout=2",
  ];
  pg.stop = () =>
    run(
      executable("postgres", "pg_ctl"),
      ["-D", pgData, "-m", "fast", "-w", "-t", "30", "stop"],
      { name: "postgres-stop", timeout: 35_000, cleanup: true },
    );
  mysql.stop = () =>
    run(
      executable("mysql", "mysqladmin"),
      [...mysqlConnectionArgs, "--connect-timeout=5", "shutdown"],
      { env: mysqlEnv, name: "mysql-stop", timeout: 35_000, cleanup: true },
    );
  const pgServerVersion = (
    await ready(pg, () =>
      run(
        executable("postgres", "psql"),
        [...pgArgs, "--command=SHOW server_version;"],
        { env: pgEnv, name: "postgres-ready", timeout: 5_000 },
      ),
    )
  ).trim();
  const mysqlServerVersion = (
    await ready(mysql, () =>
      run(
        executable("mysql", "mysql"),
        [...mysqlArgs, "--execute=SELECT VERSION();"],
        { env: mysqlEnv, name: "mysql-ready", timeout: 5_000 },
      ),
    )
  ).trim();
  await fs.unlink(mysqlInit);
  await run(
    executable("postgres", "psql"),
    [...pgArgs, "--command=CREATE DATABASE oxide;"],
    { env: pgEnv, name: "postgres-create-fixture-database" },
  );
  for (const [engine, binaryVersion, serverVersion, binary, server] of [
    [
      "postgres",
      pgVersion,
      pgServerVersion,
      executable("postgres", "postgres"),
      pg,
    ],
    [
      "mysql",
      mysqlVersion,
      mysqlServerVersion,
      executable("mysql", "mysqld"),
      mysql,
    ],
  ]) {
    evidence.servers[engine] = {
      binaryVersion,
      serverVersion,
      binarySha256: await sha256(binary),
      pid: server.child.pid,
      bindAddress: "127.0.0.1",
      serviceInstalled: false,
    };
    process.stdout.write(
      `${engine} authenticated server version: ${serverVersion}\n`,
    );
  }
  const env = {
    ...process.env,
    OXIDE_LIVE_DB_TESTS: "1",
    TEST_POSTGRES_URL: `postgresql://${user}:${password}@127.0.0.1:${pgPort}/oxide?sslmode=disable`,
    TEST_MYSQL_URL: `mysql://${user}:${password}@127.0.0.1:${mysqlPort}/oxide?ssl-mode=DISABLED`,
    CARGO_INCREMENTAL: "0",
    CARGO_PROFILE_DEV_DEBUG: "0",
    CARGO_PROFILE_TEST_DEBUG: "0",
    CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS || "4",
    TAURI_CONFIG: JSON.stringify({ bundle: { externalBin: [] } }),
    OXIDE_POSTGRES_TRANSFER_EVIDENCE: path.join(
      directory,
      "postgres-million.json",
    ),
    OXIDE_MYSQL_TRANSFER_EVIDENCE: path.join(directory, "mysql-million.json"),
  };
  if (mysqlOnly) {
    env.PROTOC = "C:/oxide-mysql-contract-must-not-require-protoc.exe";
    delete env.TAURI_CONFIG;
  } else {
    delete env.PROTOC;
  }
  const selectedTargets = mysqlOnly
    ? ["--no-default-features", "--test", "large_transfer_jobs"]
    : comparisonOnly ? ["--lib"] : ["--lib", "--test", "live_database", "--test", "large_transfer_jobs"];
  // Execute the compiled tests directly, so cancellation/timeout owns the actual
  // test process rather than leaving it behind a terminated Cargo parent.
  const compiled = await run(
    "cargo.exe",
    [
      "test",
      "--locked",
      "--offline",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      ...selectedTargets,
      "--no-run",
      "--message-format=json",
    ],
    { env, name: "compile", timeout: 20 * 60_000, stdoutOnly: true },
  );
  const artifacts = compiled
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter(
      (entry) =>
        entry.reason === "compiler-artifact" &&
        entry.profile.test &&
        entry.executable,
    );
  const testBinaries = {};
  evidence.artifacts = {};
  const artifactNames = mysqlOnly
    ? ["large_transfer_jobs"]
    : comparisonOnly ? ["oxide_studio_lib"] : ["oxide_studio_lib", "live_database", "large_transfer_jobs"];
  for (const name of artifactNames) {
    const candidates = artifacts.filter((entry) => entry.target.name === name);
    assert.equal(
      candidates.length,
      1,
      `Expected one compiled ${name} test executable`,
    );
    testBinaries[name] = candidates[0].executable;
    evidence.artifacts[name] = {
      packageId: candidates[0].package_id,
      features: candidates[0].features,
      executable: path.basename(testBinaries[name]),
      sha256: await sha256(testBinaries[name]),
    };
  }
  for (const [label, args, expected] of [
    ["postgres-live", ["postgres_live_", "--nocapture", "--test-threads=1"], 2],
    ["mysql-live", ["mysql_live_", "--nocapture", "--test-threads=1"], 3],
    ["mysql-contract", ["mysql::mysql_transfer_engine_contract", "--exact", "--ignored", "--nocapture"], 1],
    ["mysql-transfers", ["mysql_transfer_", "--skip", "mysql::mysql_transfer_engine_contract", "--ignored", "--nocapture", "--test-threads=1"], 12],
    ["mysql-million", ["mysql::jobs::process::mysql_million_row_transfer_survives_process_kill", "--exact", "--ignored", "--nocapture"], 1],
    [
      "postgres-transfers",
      ["postgres_transfer_", "--ignored", "--nocapture", "--test-threads=1"],
      8,
    ],
    [
      "postgres-million",
      [
        "postgres::process::postgres_million_row_transfer_survives_process_kill",
        "--exact",
        "--ignored",
        "--nocapture",
      ],
      1,
    ],
    ["sampled-comparisons", ["sampled_compare_live_", "--ignored", "--nocapture", "--test-threads=1"], 2],
    [
      "driver-smoke",
      ["test_get_schemas", "--ignored", "--nocapture", "--test-threads=1"],
      2,
    ],
  ]) {
    if (mysqlOnly ? label !== mysqlLabel : ["mysql-contract", "mysql-million"].includes(label)) continue;
    if (!mysqlOnly && (
      millionOnly ? label !== "postgres-million" : label === "postgres-million"
    ))
      continue;
    if (transfersOnly && label !== "postgres-transfers") continue;
    if (comparisonOnly && label !== "sampled-comparisons") continue;
    process.stdout.write(`Running ${label}\n`);
    const output = await run(
      testBinaries[
        ["driver-smoke", "sampled-comparisons"].includes(label)
          ? "oxide_studio_lib"
          : ["postgres-transfers", "postgres-million", "mysql-contract", "mysql-transfers", "mysql-million"].includes(label)
            ? "large_transfer_jobs"
            : "live_database"
      ],
      args,
      {
        env,
        name: label,
        timeout:
          ["postgres-million", "mysql-million"].includes(label)
            ? 20 * 60_000
            : label === "postgres-transfers"
              ? 600_000
              : 120_000,
        echo: true,
      },
    );
    evidence.tests[label] = passed(output, expected, label);
  }
  evidence.success = true;
} catch (error) {
  evidence.failure = redact(error.message);
  process.exitCode = 1;
  process.stderr.write(`${evidence.failure}\n`);
} finally {
  for (const command of commands) command.kill();
  for (const server of servers.reverse()) {
    if (!server.exited) {
      try {
        if (server.stop) await server.stop();
      } catch (error) {
        server.stopError = redact(error.message);
      }
      // mysqladmin can acknowledge SHUTDOWN before InnoDB has flushed its
      // buffers and the Windows monitor process exits. Keep a bounded grace
      // period; a forced stop never counts as a successful clean shutdown.
      if (!server.exited) await waitForServerExit(server, 45_000);
      if (!server.exited) {
        server.forcedStop = true;
        server.child.kill();
      }
    }
    await waitForServerExit(server, 10_000);
    evidence.servers[server.engine] ??= { pid: server.child.pid };
    evidence.servers[server.engine].exited = server.exited;
    evidence.servers[server.engine].exitCode = server.code ?? null;
    evidence.servers[server.engine].signal = server.signal ?? null;
    evidence.servers[server.engine].forcedStop = server.forcedStop === true;
    if (server.stopError) evidence.servers[server.engine].stopError = server.stopError;
    if (!server.exited || server.code !== 0 || server.forcedStop) {
      evidence.success = false;
      process.exitCode = 1;
      evidence.failure ??= `${server.engine} did not exit cleanly (code=${server.code ?? "none"}, signal=${server.signal ?? "none"}, forcedStop=${server.forcedStop === true})`;
    }
  }
  for (const name of ["postgres-password", "mysql-init.sql"]) {
    await fs.unlink(path.join(directory, name)).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  evidence.finishedAt = new Date().toISOString();
  await fs.writeFile(
    path.join(directory, "evidence.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    { mode: 0o600 },
  );
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
  process.stdout.write(
    `Native SQL acceptance ${evidence.success ? "passed" : "failed"}; evidence: ${path.join(directory, "evidence.json")}\n`,
  );
}
