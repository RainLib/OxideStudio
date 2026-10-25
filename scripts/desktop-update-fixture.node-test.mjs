import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { nsisExecutableSha256, ownedBackupPath, sha256, waitOwnedProcessExit } from "./lib/desktop-update-fixture.mjs";

async function scratch(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "oxide-updater-guard-"));
  assert.equal(path.dirname(path.resolve(directory)).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
  assert.ok(path.basename(directory).startsWith("oxide-updater-guard-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test("NSIS executable verification accounts only for the documented bundle marker", async (t) => {
  const directory = await scratch(t), file = path.join(directory, "compiled.exe");
  const input = Buffer.from("PE fixture\0__TAURI_BUNDLE_TYPE_VAR_UNK\0payload");
  const installed = Buffer.from("PE fixture\0__TAURI_BUNDLE_TYPE_VAR_NSS\0payload");
  await fs.writeFile(file, input);
  assert.equal(await nsisExecutableSha256(file), createHash("sha256").update(installed).digest("hex"));
  assert.deepEqual(await fs.readFile(file), input, "verification must not patch the source image");
});

test("unrecognized or ambiguous bundle markers do not weaken executable verification", async (t) => {
  const directory = await scratch(t), file = path.join(directory, "compiled.exe");
  for (const bytes of ["no marker", "__TAURI_BUNDLE_TYPE_VAR_UNK__TAURI_BUNDLE_TYPE_VAR_UNK"]) {
    await fs.writeFile(file, bytes);
    await assert.rejects(nsisExecutableSha256(file), /Expected one Tauri bundle marker/);
  }
});

test("backup scope accepts Windows namespace paths and rejects canonical escapes", async (t) => {
  const directory = await scratch(t), backups = path.join(directory, "backups"), outside = path.join(directory, "outside");
  await fs.mkdir(backups); await fs.mkdir(outside);
  const good = path.join(backups, "backup.sqlite"), other = path.join(outside, "other.sqlite");
  await fs.writeFile(good, "owned"); await fs.writeFile(other, "outside");
  assert.equal(await ownedBackupPath(backups, good), path.toNamespacedPath(await fs.realpath(good)));
  assert.equal(await ownedBackupPath(backups, path.toNamespacedPath(good)), path.toNamespacedPath(await fs.realpath(good)));
  await assert.rejects(ownedBackupPath(backups, other), /escaped/);
  if (process.platform !== "win32") {
    const differentCase = path.join(directory, "BACKUPS");
    await fs.mkdir(differentCase); await fs.writeFile(path.join(differentCase, "other.sqlite"), "outside");
    await assert.rejects(ownedBackupPath(backups, path.join(differentCase, "other.sqlite")), /escaped/);
  }
  const alias = path.join(backups, "link");
  await fs.symlink(outside, alias, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(ownedBackupPath(backups, path.join(alias, "other.sqlite")), /escaped/);
});

test("process observation refuses a production image name even with a matching file hash", async (t) => {
  const directory = await scratch(t), file = path.join(directory, "oxide-studio.exe");
  await fs.writeFile(file, "owned fixture bytes");
  await assert.rejects(waitOwnedProcessExit(file, await sha256(file), 1), /Only uniquely named updater fixture processes/);
});
