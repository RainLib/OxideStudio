import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";
import { monacoInlayPatch, patchInstalledMonacoInlayHints } from "./patch-monaco-inlay-hints.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const installed = await fs.readFile(path.join("node_modules/monaco-editor", monacoInlayPatch.relativePath));
const original = hash(installed) === monacoInlayPatch.patchedSha256
  ? Buffer.from(installed.toString("utf8").replace("this._sessionDisposables.add(provider.onDidChangeInlayHints(() => {", "store.add(provider.onDidChangeInlayHints(() => {"))
  : installed;
assert.equal(hash(original), monacoInlayPatch.originalSha256);
async function fixture(t) {
  const parent = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, "oxide-monaco-inlay-test-"));
  t.after(async () => {
    const resolved = await fs.realpath(root);
    assert.equal(path.dirname(resolved), parent);
    assert(path.basename(resolved).startsWith("oxide-monaco-inlay-test-"));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  const directory = path.join(root, "node_modules/monaco-editor");
  const target = path.join(directory, monacoInlayPatch.relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(path.join(directory, "package.json"), JSON.stringify({ version: "0.55.1" }));
  await fs.writeFile(target, original);
  return { root, directory, target };
}
test("patches the reviewed installed controller bytes", async t => {
  const f = await fixture(t), receipt = await patchInstalledMonacoInlayHints(f.root);
  assert.equal(receipt.changed, true);
  assert.equal(hash(await fs.readFile(f.target)), monacoInlayPatch.patchedSha256);
});
test("repeated installation leaves patched bytes and modification time unchanged", async t => {
  const f = await fixture(t); await patchInstalledMonacoInlayHints(f.root);
  const before = await fs.stat(f.target), receipt = await patchInstalledMonacoInlayHints(f.root);
  assert.equal(receipt.changed, false); assert.equal((await fs.stat(f.target)).mtimeMs, before.mtimeMs);
});
test("rejects another package version without touching its controller", async t => {
  const f = await fixture(t); await fs.writeFile(path.join(f.directory, "package.json"), JSON.stringify({ version: "0.55.2" }));
  await assert.rejects(patchInstalledMonacoInlayHints(f.root), /Review the Monaco inlay patch/);
  assert.deepEqual(await fs.readFile(f.target), original);
});
test("rejects unexpected bytes in the pinned version instead of overwriting them", async t => {
  const f = await fixture(t), modified = Buffer.concat([original, Buffer.from("\n// another change\n")]);
  await fs.writeFile(f.target, modified);
  await assert.rejects(patchInstalledMonacoInlayHints(f.root), /differs from the reviewed/);
  assert.deepEqual(await fs.readFile(f.target), modified);
});
test("pins the patched package and preserves the existing install patch chain", async () => {
  const pkg = JSON.parse(await fs.readFile("package.json", "utf8")), lock = JSON.parse(await fs.readFile("package-lock.json", "utf8"));
  assert.equal(pkg.dependencies["monaco-editor"], "0.55.1");
  assert.equal(lock.packages[""].dependencies["monaco-editor"], "0.55.1");
  assert.equal(lock.packages["node_modules/monaco-editor"].version, "0.55.1");
  assert.match(pkg.scripts.postinstall, /patch-monaco-react\.mjs.*patch-monaco-inlay-hints\.mjs/);
  assert.equal(hash(installed), monacoInlayPatch.patchedSha256);
});
