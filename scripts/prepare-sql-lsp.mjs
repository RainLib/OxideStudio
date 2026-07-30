import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lspSourceDir = join(repoRoot, "vendor", "sql-lsp");
const binariesDir = join(repoRoot, "src-tauri", "binaries");
const binaryName = process.platform === "win32" ? "sql-lsp.exe" : "sql-lsp";
const targetBinary = join(binariesDir, binaryName);
const targetManifest = join(binariesDir, "sql-lsp.manifest.json");
const digest = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

function targetIntegrityIsValid() {
  if (!existsSync(targetBinary) || !existsSync(targetManifest)) return false;
  try {
    const manifest = JSON.parse(readFileSync(targetManifest, "utf8"));
    return (
      typeof manifest.sha256 === "string" &&
      manifest.sha256.toLowerCase() === digest(targetBinary).toLowerCase()
    );
  } catch {
    return false;
  }
}

console.log("=== SQL LSP Build Preparation ===");
console.log(`Target: ${targetBinary}`);
mkdirSync(binariesDir, { recursive: true });

if (process.env.OXIDE_SKIP_SQL_LSP_PREPARE === "1") {
  if (!targetIntegrityIsValid()) {
    throw new Error(
      "SQL LSP preparation was skipped, but the bundled binary and provenance manifest do not match. Run: make lsp-build",
    );
  }
  console.log("SQL LSP preparation skipped; existing target integrity is valid");
  process.exit(0);
}

let sourceBinary = process.env.OXIDE_SQL_LSP_BINARY;
let sourceRevision = "override";
let sourceDirty = null;
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
  const revision = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: lspSourceDir,
    encoding: "utf8",
  });
  if (revision.status === 0) {
    sourceRevision = revision.stdout.trim();
  }
  const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], {
    cwd: lspSourceDir,
    encoding: "utf8",
  });
  sourceDirty = status.status === 0 ? status.stdout.trim().length > 0 : null;
}

if (!existsSync(sourceBinary)) {
  throw new Error(`Built SQL LSP binary not found: ${sourceBinary}`);
}

if (existsSync(targetBinary) && digest(sourceBinary) === digest(targetBinary)) {
  console.log("SQL LSP binary unchanged; keeping existing target");
} else {
  const temporaryBinary = `${targetBinary}.tmp`;
  rmSync(temporaryBinary, { force: true });
  copyFileSync(sourceBinary, temporaryBinary);
  renameSync(temporaryBinary, targetBinary);
}

const sha256 = digest(targetBinary);
const manifestContents = `${JSON.stringify(
  {
    schemaVersion: 1,
    sourceRevision,
    sourceDirty,
    sha256,
    platform: process.platform,
    architecture: process.arch,
    profile: "release",
  },
  null,
  2,
)}\n`;
const temporaryManifest = `${targetManifest}.tmp`;
rmSync(temporaryManifest, { force: true });
writeFileSync(temporaryManifest, manifestContents);
renameSync(temporaryManifest, targetManifest);

console.log(`SQL LSP binary ready at ${targetBinary}`);
console.log(`SQL LSP provenance: ${sourceRevision}${sourceDirty ? "-dirty" : ""} (${sha256})`);
