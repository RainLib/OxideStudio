import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const binaries = join(root, "src-tauri", "binaries");
const resources = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"))
  .bundle.resources;
for (const name of ["sql-lsp", "sql-lsp.exe"]) {
  for (const resource of [`binaries/${name}`, `binaries/${name}.manifest.json`]) {
    if (!resources[resource] || !existsSync(join(root, "src-tauri", resource)))
      throw new Error(`SQL LSP bundle resource is missing: ${resource}`);
  }
}
const binaryName = process.platform === "win32" ? "sql-lsp.exe" : "sql-lsp";
const binary = join(binaries, binaryName);
const manifest = JSON.parse(readFileSync(`${binary}.manifest.json`, "utf8"));
const sha256 = createHash("sha256").update(readFileSync(binary)).digest("hex");
if (
  manifest.schemaVersion !== 1 || manifest.platform !== process.platform ||
  manifest.architecture !== process.arch || manifest.profile !== "release" ||
  typeof manifest.sourceRevision !== "string" || manifest.sha256 !== sha256
) throw new Error(`Bundled ${binaryName} does not match its platform provenance manifest.`);
console.log(`SQL LSP bundle verified: ${binaryName}, ${manifest.sourceRevision}${manifest.sourceDirty ? "-dirty" : ""}, sha256 ${sha256}.`);
