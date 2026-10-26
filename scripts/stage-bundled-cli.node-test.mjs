import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import { stageBundledCli } from "./stage-bundled-cli.mjs";

test("the separately prepared CLI wins over Cargo's Desktop-linked auxiliary binary", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "oxide-bundle-cli-"));
  const target = "x86_64-pc-windows-msvc", targetDirectory = join(root, "target");
  await mkdir(join(root, "src-tauri/binaries"), { recursive: true });
  await writeFile(join(root, "src-tauri/binaries", `oxide-agent-${target}.exe`), "prepared-headless");
  for (const directory of [join(targetDirectory, "release"), join(targetDirectory, target, "release")]) {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "oxide-studio.exe"), "desktop");
    await writeFile(join(directory, "oxide-agent.exe"), "desktop-linked-cli");
  }
  const staged = await stageBundledCli({ root, target, targetDirectory });
  assert.equal(staged.length, 2);
  for (const file of staged) assert.equal(await readFile(file, "utf8"), "prepared-headless");
});

test("staging fails before a prepared CLI or Desktop output exists", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "oxide-bundle-cli-"));
  const options = { root, target: "x86_64-pc-windows-msvc", targetDirectory: join(root, "target") };
  await assert.rejects(stageBundledCli(options), /Prepare/);
  await mkdir(join(root, "src-tauri/binaries"), { recursive: true });
  await writeFile(join(root, "src-tauri/binaries/oxide-agent-x86_64-pc-windows-msvc.exe"), "headless");
  await assert.rejects(stageBundledCli(options), /Build/);
});
