import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readSourceText } from "./lib/source-text.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const folder = path.join(root, "vendor/sql-lsp/grammars/sql");
const read = (file) => readSourceText(path.join(folder, file)).replace(/^\uFEFF/, "");
const hash = (source) => createHash("sha256").update(source).digest("hex");
const upstream = JSON.parse(read("oxide-upstream.json"));
const generated = JSON.parse(read("oxide-generated.json"));
assert.equal(upstream.version, "0.3.11");
assert.equal(upstream.crateSha256, "9d198ad3c319c02e43c21efa1ec796b837afcb96ffaef1a40c1978fbdcec7d17");
assert.equal(generated.generator, "tree-sitter-cli@0.26.3");
assert.equal(generated.abi, 14);
for (const [file, expected] of Object.entries(generated.files)) {
  assert.equal(hash(read(file)), expected, `${file}: regenerate or review source provenance`);
}
assert.equal(hash(read("grammar.js")), upstream.patchedGrammarSha256);
// Reconstruct the published base from the checked-in narrow patch. This proves
// the patch matches both the current grammar and the recorded upstream text.
const current = read("grammar.js").split("\n");
const patch = read("oxide-grammar.patch").split("\n");
const original = [];
let cursor = 0;
let inHunk = false;
for (const line of patch) {
  const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
  if (hunk) {
    const start = Number(hunk[1]) - 1;
    original.push(...current.slice(cursor, start));
    cursor = start;
    inHunk = true;
  } else if (inHunk && line.startsWith("-")) {
    original.push(line.slice(1));
  } else if (inHunk && (line.startsWith("+") || line.startsWith(" "))) {
    assert.equal(current[cursor++], line.slice(1), "grammar patch/source mismatch");
    if (line.startsWith(" ")) original.push(line.slice(1));
  }
}
original.push(...current.slice(cursor));
assert.equal(hash(original.join("\n")), upstream.upstreamGrammarSha256);
assert(read("LICENSE").includes("Copyright (c) 2021 Derek Stride"));
assert(read("src/parser.c").includes("#define LANGUAGE_VERSION 14"));
assert.equal(JSON.parse(read("package.json")).type, "commonjs");
const cargo = readSourceText(path.join(root, "vendor/sql-lsp/Cargo.toml"));
assert(!/^tree-sitter-sequel\s*=/m.test(cargo));
assert(cargo.includes('tree-sitter-language = "0.1"'));
assert(cargo.includes('[build-dependencies]\ncc = "~1.2.1"'));
const lock = readSourceText(path.join(root, "vendor/sql-lsp/Cargo.lock"));
assert(!lock.includes('name = "tree-sitter-sequel"'));
const entry = lock.split('name = "sql-lsp"')[1]?.split("[[package]]")[0];
assert(entry?.includes(' "tree-sitter-language",') && entry.includes(' "cc",'));
const build = readSourceText(path.join(root, "vendor/sql-lsp/build.rs"));
assert(build.includes('"grammars/sql/src"') && build.includes('"parser.c"') && build.includes('"scanner.c"'));
assert(!fs.existsSync(path.join(folder, "Cargo.toml")), "Do not exclude grammar files as a nested Cargo package");
assert(fs.existsSync(path.join(folder, "OXIDE_PATCHES.md")));
console.log(`SQL grammar source verified: pinned upstream patch, ABI 14 and ${Object.keys(generated.files).length} text fingerprints.`);
