import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const script = join(repositoryRoot, "scripts", "package-rqlite-driver.mjs");

test("RQLite package preparation produces a manifest-bound network sidecar", async (t) => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "oxide-rqlite-package-"));
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));
  const binary = join(temporaryDirectory, "oxide-driver-rqlite");
  const output = join(temporaryDirectory, "package");
  await writeFile(binary, "rqlite-sidecar-test-payload", "utf8");

  execFileSync(process.execPath, [script, "--target", "test-target", "--binary", binary, "--out", output, "--version", "9.9.9"], {
    cwd: repositoryRoot,
    stdio: "pipe",
  });

  const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
  assert.equal(manifest.packageId, "oxide.rqlite");
  assert.equal(manifest.packageVersion, "9.9.9");
  assert.equal(manifest.entrypoint, "oxide-driver-rqlite");
  assert.equal(manifest.capabilities.lspLanguageId, "sqlite");
  assert.equal(manifest.capabilities.connectionMode, "network");
  assert.equal(manifest.capabilities.defaultPort, 4001);
  assert.equal(manifest.capabilities.supportsConnectionDatabase, false);
  assert.equal(manifest.capabilities.supportsTableRowMutation, false);
  assert.deepEqual(manifest.capabilities.tableExportFormats, ["csv", "json", "jsonl", "sql", "tsv", "xlsx"]);
  assert.equal(manifest.capabilities.supportsForeignKeys, true);
  assert.equal(
    manifest.sha256,
    createHash("sha256").update(await readFile(join(output, manifest.entrypoint))).digest("hex"),
  );
});
