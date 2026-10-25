import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const facade = path.join(root, "src/services/documentMetadataCache.ts");
const verifier = path.join(root, "scripts/verify-document-metadata-cache-boundaries.mjs");

function runVerifier(newline, removeExport = false) {
  // Supply alternate checkout bytes without modifying the shared worktree.
  const preload = `
    import fs from "node:fs";
    import path from "node:path";
    import { syncBuiltinESMExports } from "node:module";
    const read = fs.readFileSync;
    fs.readFileSync = function(file, ...options) {
      const value = read.call(this, file, ...options);
      if (typeof file !== "string" || path.resolve(file) !== ${JSON.stringify(facade)} || typeof value !== "string") return value;
      let source = value.replace(/\\r\\n?/g, "\\n");
      if (${removeExport}) source = source.replace(/^export \\{ DocumentMetadataCache \\} from[^\\n]*\\n?/m, "");
      return source.replace(/\\n/g, ${JSON.stringify(newline)});
    };
    syncBuiltinESMExports();
  `;
  return spawnSync(process.execPath, [
    "--import",
    `data:text/javascript;base64,${Buffer.from(preload).toString("base64")}`,
    verifier,
  ], { cwd: root, encoding: "utf8", timeout: 30_000, windowsHide: true });
}

for (const [name, newline] of [["LF", "\n"], ["CRLF", "\r\n"]]) {
  test(`document metadata architecture checks accept ${name} checkouts`, () => {
    const result = runVerifier(newline);
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /Document metadata cache boundaries verified/);
  });
}

test("line-ending normalization still rejects a missing compatibility export", () => {
  const result = runVerifier("\r\n", true);
  assert.ifError(result.error);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Document metadata cache facade must retain export \{ DocumentMetadataCache \}/);
});
