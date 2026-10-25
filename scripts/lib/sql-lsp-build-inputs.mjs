import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// Explicit runtime source closure, including new/untracked Rust modules and
// checked-in grammar outputs. Target directories and external test runs are
// excluded. Hash raw bytes and relative paths; no Git-index dependence.
export function sqlLspSourceFingerprint(directory) {
  const files = ["Cargo.toml", "Cargo.lock", "build.rs", "grammars/sql/grammar.js",
    "grammars/sql/oxide-generated.json", "grammars/sql/oxide-upstream.json", "grammars/sql/oxide-grammar.patch"];
  const visit = (relative, extensions) => {
    for (const entry of readdirSync(path.join(directory, relative), { withFileTypes: true })) {
      const name = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`LSP build input must be a regular file/directory: ${name}`);
      if (entry.isDirectory()) visit(name, extensions);
      else if (entry.isFile() && extensions.has(path.extname(entry.name))) files.push(name);
    }
  };
  visit("src", new Set([".rs"]));
  visit("grammars/sql/src", new Set([".c", ".h", ".json"]));
  const hash = createHash("sha256");
  for (const name of files.sort()) {
    const bytes = readFileSync(path.join(directory, name));
    hash.update(`${Buffer.byteLength(name)}:${name}:${bytes.length}:`);
    hash.update(bytes);
  }
  return { kind: "sql-lsp-runtime-inputs-v1", files: files.length, sha256: hash.digest("hex") };
}

export function sqlLspCargoBuildArgs(manifest, offline) {
  return ["build", "--release", "--locked", ...(offline ? ["--offline"] : []), "--manifest-path", manifest];
}

export function matchesSqlLspSourceFingerprint(expected, directory) {
  if (expected?.kind !== "sql-lsp-runtime-inputs-v1" || !Number.isSafeInteger(expected.files) || !/^[a-f0-9]{64}$/u.test(expected.sha256 ?? "")) return false;
  const current = sqlLspSourceFingerprint(directory);
  return current.files === expected.files && current.sha256 === expected.sha256;
}
