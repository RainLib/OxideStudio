import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("packages a dereferenced Java 21 runtime manifest", async () => {
  const root = await mkdtemp(join(tmpdir(), "oxide-java-runtime-"));
  try {
    const runtime = join(root, "runtime");
    const output = join(root, "package");
    await mkdir(join(runtime, "bin"), { recursive: true });
    const executable = process.platform === "win32" ? "java.exe" : "java";
    const contents = Buffer.from("fixture-java-runtime");
    await writeFile(join(runtime, "bin", executable), contents);
    const result = spawnSync(
      process.execPath,
      ["scripts/package-managed-java-runtime.mjs", "--runtime-home", runtime, "--version", "21.0.3-fixture", "--out", output],
      { cwd: resolve("."), encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(await readFile(join(output, "runtime.json"), "utf8"));
    assert.equal(manifest.runtimeKind, "java");
    assert.equal(manifest.javaMajor, 21);
    assert.equal(manifest.entrypoint, `bin/${executable}`);
    assert.equal(manifest.sha256, createHash("sha256").update(contents).digest("hex"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
