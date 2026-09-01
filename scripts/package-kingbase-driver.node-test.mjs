import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const script = join(repositoryRoot, "scripts", "package-kingbase-driver.mjs");

test("Kingbase package preparation produces a manifest-bound native Agent", async (t) => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "oxide-kingbase-package-"));
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));
  const binary = join(temporaryDirectory, "oxide-driver-kingbase"); const output = join(temporaryDirectory, "package");
  await writeFile(binary, "kingbase-sidecar-test-payload", "utf8");
  execFileSync(process.execPath, [script, "--target", "test-target", "--binary", binary, "--out", output, "--version", "9.9.9"], { cwd: repositoryRoot, stdio: "pipe" });
  const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
  assert.equal(manifest.packageId, "oxide.kingbase"); assert.equal(manifest.driverId, "kingbase");
  assert.equal(manifest.capabilities.lspLanguageId, "sql"); assert.equal(manifest.capabilities.defaultPort, 54321);
  assert.equal(manifest.capabilities.identifierQuote, '"'); assert.equal(manifest.capabilities.supportsTransactions, false);
  assert.equal(manifest.sha256, createHash("sha256").update(await readFile(join(output, manifest.entrypoint))).digest("hex"));
});
