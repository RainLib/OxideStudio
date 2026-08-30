import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const script = join(repositoryRoot, "scripts", "package-sqlite-worker.mjs");

test("SQLite worker packaging binds protocol, platform and binary digest", async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "oxide-sqlite-worker-package-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const binary = join(temporary, "oxide-sqlite-worker");
  const output = join(temporary, "package");
  const cargoToml = await readFile(
    join(repositoryRoot, "src-tauri", "crates", "oxide-sqlite-worker", "Cargo.toml"),
    "utf8",
  );
  const version = cargoToml.match(/^version\s*=\s*"([^"]+)"/mu)?.[1];
  assert.ok(version, "worker crate version is declared");
  await writeFile(binary, "sqlite-worker-fixture", "utf8");

  execFileSync(process.execPath, [
    script,
    "--target", "x86_64-unknown-linux-musl",
    "--binary", binary,
    "--out", output,
    "--version", version,
  ], { cwd: repositoryRoot, stdio: "pipe" });

  const manifest = JSON.parse(await readFile(join(output, "manifest.json"), "utf8"));
  assert.equal(manifest.artifactKind, "sqlite-ssh-worker");
  assert.equal(manifest.packageId, "oxide.sqlite-ssh-worker");
  assert.equal(manifest.packageVersion, version);
  assert.equal(manifest.protocolVersion, 1);
  assert.equal(manifest.platform, "linux-x64");
  assert.equal(manifest.rustTarget, "x86_64-unknown-linux-musl");
  assert.deepEqual(manifest.supportedRemoteOs, ["linux"]);
  assert.ok(manifest.capabilities.includes("interrupt"));
  assert.equal(
    manifest.sha256,
    createHash("sha256").update(await readFile(join(output, manifest.entrypoint))).digest("hex"),
  );
});

test("SQLite worker packaging rejects non-musl and unsafe versions", async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "oxide-sqlite-worker-package-invalid-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const binary = join(temporary, "oxide-sqlite-worker");
  await writeFile(binary, "fixture", "utf8");
  assert.throws(
    () => execFileSync(process.execPath, [script, "--target", "x86_64-unknown-linux-gnu", "--binary", binary], { cwd: repositoryRoot, stdio: "pipe" }),
    /--target must be one of/u,
  );
  assert.throws(
    () => execFileSync(process.execPath, [script, "--target", "x86_64-unknown-linux-musl", "--binary", binary, "--version", "../bad"], { cwd: repositoryRoot, stdio: "pipe" }),
    /unsafe characters/u,
  );
  assert.throws(
    () => execFileSync(process.execPath, [script, "--target", "x86_64-unknown-linux-musl", "--binary", binary, "--version", "9.9.9"], { cwd: repositoryRoot, stdio: "pipe" }),
    /must match the worker crate version/u,
  );
});

test("release workflows preserve worker version and desktop trust binding", async () => {
  const workerWorkflow = await readFile(
    join(repositoryRoot, ".github", "workflows", "publish-sqlite-worker.yml"),
    "utf8",
  );
  const desktopWorkflow = await readFile(
    join(repositoryRoot, ".github", "workflows", "release.yml"),
    "utf8",
  );
  assert.match(workerWorkflow, /actions\/checkout@v6/u);
  assert.match(workerWorkflow, /test "\$WORKER_PACKAGE_VERSION" = "\$CRATE_VERSION"/u);
  assert.match(desktopWorkflow, /DRIVER_MINISIGN_PUBLIC_KEY_B64 is required/u);
  assert.match(desktopWorkflow, /OXIDE_DRIVER_SIGNING_PUBLIC_KEY<<OXIDE_DRIVER_TRUST_EOF/u);
});
