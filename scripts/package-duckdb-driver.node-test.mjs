import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const script = join(repositoryRoot, "scripts", "package-duckdb-driver.mjs");

test("DuckDB package preparation produces a manifest-bound sidecar payload", async (t) => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "oxide-duckdb-package-"));
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));
  const binary = join(temporaryDirectory, "oxide-driver-duckdb");
  const output = join(temporaryDirectory, "package");
  await writeFile(binary, "duckdb-sidecar-test-payload", "utf8");

  execFileSync(process.execPath, [script, "--target", "test-target", "--binary", binary, "--out", output, "--version", "9.9.9"], {
    cwd: repositoryRoot,
    stdio: "pipe",
  });

  const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
  assert.equal(manifest.packageId, "oxide.duckdb");
  assert.equal(manifest.packageVersion, "9.9.9");
  // The repository lockfile is CRLF on Windows. This assertion exercises the
  // lockfile parser through the packaging command and prevents a line-ending
  // regression from producing an unsigned/incomplete release payload.
  assert.equal(manifest.clientVersion, "1.10505.0");
  assert.equal(manifest.entrypoint, "oxide-driver-duckdb");
  assert.deepEqual(manifest.supportedTargets, ["test-target"]);
  assert.equal(manifest.capabilities.lspLanguageId, "duckdb");
  assert.equal(manifest.capabilities.connectionMode, "file");
  assert.equal(manifest.capabilities.supportsDatabaseCatalogs, true);
  assert.equal(manifest.capabilities.supportsTableRowMutation, false);
  assert.equal(manifest.capabilities.supportsTableDataTransfer, true);
  assert.equal(manifest.capabilities.supportsColumnAlteration, false);
  assert.equal(manifest.capabilities.supportsIndexRename, false);
  assert.equal(
    manifest.sha256,
    createHash("sha256").update(await readFile(join(output, manifest.entrypoint))).digest("hex"),
  );
});
