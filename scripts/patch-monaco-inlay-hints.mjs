import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export const monacoInlayPatch = Object.freeze({
  version: "0.55.1",
  relativePath: "esm/vs/editor/contrib/inlayHints/browser/inlayHintsController.js",
  originalSha256: "f3343cae3778782f91afff55a1e92b32b8397ac3a900261a66204192ffdae1d8",
  patchedSha256: "fbb97d01300b69a11f64fbe2c58fb6b6b348b837d774e3b7053632bfdc180be1",
});
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

/** Provider watches live for the model session, not a single request. The
 * request store is reset on every fetch while watchedProviders is retained. */
export async function patchInstalledMonacoInlayHints(root = repoRoot) {
  const directory = join(root, "node_modules", "monaco-editor");
  const pkg = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  if (pkg.version !== monacoInlayPatch.version) {
    throw new Error(`Review the Monaco inlay patch for installed version ${pkg.version}.`);
  }
  const target = join(directory, monacoInlayPatch.relativePath);
  const bytes = await readFile(target), before = digest(bytes);
  if (before === monacoInlayPatch.patchedSha256) {
    return { ...monacoInlayPatch, changed: false, installedSha256: before };
  }
  if (before !== monacoInlayPatch.originalSha256) {
    throw new Error("Monaco inlay controller differs from the reviewed 0.55.1 bytes; refusing to patch it.");
  }
  const source = bytes.toString("utf8");
  const patched = source.replace(
    "store.add(provider.onDidChangeInlayHints(() => {",
    "this._sessionDisposables.add(provider.onDidChangeInlayHints(() => {",
  );
  if (digest(patched) !== monacoInlayPatch.patchedSha256) throw new Error("Monaco inlay patch output digest mismatch.");
  await writeFile(target, patched, "utf8");
  return { ...monacoInlayPatch, changed: true, installedSha256: digest(patched) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await patchInstalledMonacoInlayHints()));
}
