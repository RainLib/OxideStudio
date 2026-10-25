import { readSourceText } from "./lib/source-text.mjs";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { matchesSqlLspSourceFingerprint } from "./lib/sql-lsp-build-inputs.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const binaries = join(root, "src-tauri", "binaries");
const resources = JSON.parse(readSourceText(join(root, "src-tauri", "tauri.conf.json")))
  .bundle.resources;
for (const name of ["sql-lsp", "sql-lsp.exe"]) {
  for (const resource of [`binaries/${name}`, `binaries/${name}.manifest.json`]) {
    if (!resources[resource] || !existsSync(join(root, "src-tauri", resource)))
      throw new Error(`SQL LSP bundle resource is missing: ${resource}`);
  }
}
const binaryName = process.platform === "win32" ? "sql-lsp.exe" : "sql-lsp";
const binary = join(binaries, binaryName);
const manifest = JSON.parse(readSourceText(`${binary}.manifest.json`));
const sha256 = createHash("sha256").update(readFileSync(binary)).digest("hex");
if (
  manifest.schemaVersion !== 1 || manifest.platform !== process.platform ||
  manifest.architecture !== process.arch || manifest.profile !== "release" ||
  typeof manifest.sourceRevision !== "string" || manifest.sha256 !== sha256
) throw new Error(`Bundled ${binaryName} does not match its platform provenance manifest.`);
if (manifest.sourceFingerprint != null && !matchesSqlLspSourceFingerprint(manifest.sourceFingerprint, join(root,"vendor","sql-lsp"))) {
  throw new Error(`Bundled ${binaryName} was built from different SQL LSP sources. Run: node scripts/prepare-sql-lsp.mjs`);
}
console.log(`SQL LSP bundle verified: ${binaryName}, ${manifest.sourceRevision}${manifest.sourceDirty ? "-dirty" : ""}, sha256 ${sha256}.`);
