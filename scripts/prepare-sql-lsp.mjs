import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lspSourceDir = join(repoRoot, "vendor", "sql-lsp");
const binariesDir = join(repoRoot, "src-tauri", "binaries");
const binaryName = process.platform === "win32" ? "sql-lsp.exe" : "sql-lsp";
const targetBinary = join(binariesDir, binaryName);

console.log("=== SQL LSP Build Preparation ===");
console.log(`Target: ${targetBinary}`);
mkdirSync(binariesDir, { recursive: true });

if (process.env.OXIDE_SKIP_SQL_LSP_PREPARE === "1" && existsSync(targetBinary)) {
  console.log("SQL LSP preparation skipped; existing target is present");
  process.exit(0);
}

let sourceBinary = process.env.OXIDE_SQL_LSP_BINARY;
if (sourceBinary) {
  sourceBinary = resolve(sourceBinary);
  if (!existsSync(sourceBinary)) {
    throw new Error(`OXIDE_SQL_LSP_BINARY does not exist: ${sourceBinary}`);
  }
  console.log(`Using override binary: ${sourceBinary}`);
} else {
  const manifest = join(lspSourceDir, "Cargo.toml");
  if (!existsSync(manifest)) {
    throw new Error(`SQL LSP submodule is missing at ${lspSourceDir}. Run: git submodule update --init --recursive`);
  }

  console.log(`Building SQL LSP from submodule: ${lspSourceDir}`);
  const cargo = spawnSync("cargo", ["build", "--release", "--manifest-path", manifest], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (cargo.status !== 0) {
    process.exit(cargo.status ?? 1);
  }
  sourceBinary = join(lspSourceDir, "target", "release", binaryName);
}

if (!existsSync(sourceBinary)) {
  throw new Error(`Built SQL LSP binary not found: ${sourceBinary}`);
}

const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
if (existsSync(targetBinary) && digest(sourceBinary) === digest(targetBinary)) {
  console.log("SQL LSP binary unchanged; keeping existing target");
} else {
  const temporaryBinary = `${targetBinary}.tmp`;
  rmSync(temporaryBinary, { force: true });
  copyFileSync(sourceBinary, temporaryBinary);
  renameSync(temporaryBinary, targetBinary);
}

console.log(`SQL LSP binary ready at ${targetBinary}`);
