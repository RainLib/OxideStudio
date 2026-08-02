#!/usr/bin/env node

/**
 * Creates a reviewable Java runtime payload for JDBC sidecars. The package is
 * unsigned until runtime.json is signed with the same trusted release key used
 * for database driver packages. Symlinks are deliberately dereferenced so the
 * importer's package-boundary validation remains applicable to the JRE too.
 */
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

function option(name, required = false) {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? null : process.argv[index + 1];
  if (index >= 0 && (!value || value.startsWith("--"))) {
    throw new Error(`${name} requires a value`);
  }
  if (required && !value) throw new Error(`${name} is required`);
  return value;
}

function defaultTarget() {
  const os = process.platform === "darwin" ? "macos" : process.platform;
  return `${os}-${process.arch}`;
}

async function digest(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: node scripts/package-managed-java-runtime.mjs --runtime-home <jre-directory> --version <21.x> --out <directory> [--target macos-arm64]");
    return;
  }
  const runtimeHome = resolve(option("--runtime-home", true));
  const runtimeVersion = option("--version", true);
  const output = resolve(option("--out", true));
  const target = option("--target") || defaultTarget();
  if (!/^[A-Za-z0-9._-]{1,96}$/.test(runtimeVersion)) {
    throw new Error("--version must contain only letters, digits, dot, underscore, or hyphen");
  }
  if (!/^[A-Za-z0-9._-]{1,96}$/.test(target)) {
    throw new Error("--target must be a safe target token");
  }
  if (!(await stat(runtimeHome).catch(() => null))?.isDirectory()) {
    throw new Error(`Java runtime directory was not found: ${runtimeHome}`);
  }
  if (await stat(output).catch(() => null)) {
    throw new Error(`Refusing to overwrite an existing Java runtime package: ${output}`);
  }
  const executable = process.platform === "win32" ? "java.exe" : "java";
  const entrypoint = join(runtimeHome, "bin", executable);
  if (!(await stat(entrypoint).catch(() => null))?.isFile()) {
    throw new Error(`Java runtime does not contain bin/${executable}`);
  }

  await mkdir(dirname(output), { recursive: true });
  await cp(runtimeHome, output, {
    recursive: true,
    dereference: true,
    filter: (path) => !path.endsWith("/.DS_Store"),
  });
  const packagedEntrypoint = join(output, "bin", executable);
  const manifest = {
    schemaVersion: 1,
    runtimeKind: "java",
    javaMajor: 21,
    runtimeVersion,
    entrypoint: `bin/${executable}`,
    sha256: await digest(packagedEntrypoint),
    supportedTargets: [target],
  };
  await writeFile(
    join(output, "runtime.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  console.log(`Unsigned managed Java runtime prepared at ${output}`);
  console.log("Sign exactly runtime.json as runtime.json.minisig before importing it in Driver Manager.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
