import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const script = join(repositoryRoot, "scripts", "package-clickhouse-driver.mjs");

test("ClickHouse package preparation produces a manifest-bound OLAP sidecar", async (t) => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "oxide-clickhouse-package-"));
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));
  const binary = join(temporaryDirectory, "oxide-driver-clickhouse"); const output = join(temporaryDirectory, "package");
  await writeFile(binary, "clickhouse-sidecar-test-payload", "utf8");
  execFileSync(process.execPath, [script, "--target", "test-target", "--binary", binary, "--out", output, "--version", "9.9.9"], { cwd: repositoryRoot, stdio: "pipe" });
  const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
  assert.equal(manifest.packageId, "oxide.clickhouse"); assert.equal(manifest.capabilities.lspLanguageId, "clickhouse");
  assert.equal(manifest.capabilities.defaultPort, 8123); assert.equal(manifest.capabilities.identifierQuote, '"'); assert.equal(manifest.capabilities.supportsDatabaseCatalogs, true);
  assert.equal(manifest.capabilities.supportsTableRowMutation, false); assert.equal(manifest.capabilities.supportsTransactions, false); assert.deepEqual(manifest.capabilities.tableExportFormats, []);
  assert.equal(manifest.sha256, createHash("sha256").update(await readFile(join(output, manifest.entrypoint))).digest("hex"));
});
