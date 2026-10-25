import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { matchesSqlLspSourceFingerprint, sqlLspCargoBuildArgs, sqlLspSourceFingerprint } from "./lib/sql-lsp-build-inputs.mjs";
const roots=[];
const files={"Cargo.toml":"[package]\nname='fixture'", "Cargo.lock":"locked", "build.rs":"fn main(){}", "src/main.rs":"fn main(){}", "src/nested/module.rs":"pub fn value(){}", "grammars/sql/grammar.js":"grammar({})", "grammars/sql/oxide-generated.json":"{}", "grammars/sql/oxide-upstream.json":"{}", "grammars/sql/oxide-grammar.patch":"patch", "grammars/sql/src/parser.c":"parser", "grammars/sql/src/scanner.c":"scanner", "grammars/sql/src/tree_sitter/parser.h":"header", "grammars/sql/src/node-types.json":"[]"};
function fixture(reverse=false) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"oxide-lsp-input-test-"));roots.push(root);
 for(const [name,body] of (reverse?Object.entries(files).reverse():Object.entries(files))){const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,body);}
 return root;
}
afterEach(()=>{for(const root of roots.splice(0)){const resolved=fs.realpathSync(root);assert.equal(path.dirname(resolved),fs.realpathSync(os.tmpdir()));assert(path.basename(resolved).startsWith("oxide-lsp-input-test-"));fs.rmSync(resolved,{recursive:true,force:true});}});
test("fingerprints are independent of checkout location and discovery order",()=>{
 assert.deepEqual(sqlLspSourceFingerprint(fixture()),sqlLspSourceFingerprint(fixture(true)));
});
test("new untracked Rust modules invalidate provenance without a Git index",()=>{
 const root=fixture();const before=sqlLspSourceFingerprint(root);fs.writeFileSync(path.join(root,"src/new_module.rs"),"pub fn newly_added(){}");assert(!matchesSqlLspSourceFingerprint(before,root));assert.equal(sqlLspSourceFingerprint(root).files,before.files+1);
});
test("grammar, lock and build-script bytes are all part of the source closure",()=>{
 for(const name of ["Cargo.lock","build.rs","grammars/sql/src/parser.c","grammars/sql/src/tree_sitter/parser.h"]){const root=fixture();const before=sqlLspSourceFingerprint(root);fs.appendFileSync(path.join(root,name)," changed");assert(!matchesSqlLspSourceFingerprint(before,root),name);}
});
test("generated target files and external test reports do not affect runtime provenance",()=>{
 const root=fixture();const before=sqlLspSourceFingerprint(root);for(const name of ["target/debug/generated.rs","tests/protocol.rs","src/notes.md"]){fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.writeFileSync(path.join(root,name),"not compiled runtime input");}assert(matchesSqlLspSourceFingerprint(before,root));
});
test("missing lockfiles and malformed source receipts fail verification",()=>{
 const root=fixture();assert(!matchesSqlLspSourceFingerprint({kind:"other",files:13,sha256:"0".repeat(64)},root));fs.unlinkSync(path.join(root,"Cargo.lock"));assert.throws(()=>sqlLspSourceFingerprint(root),/Cargo.lock/u);
});
test("production builds always lock dependencies and support explicit offline builds",()=>{
 assert.deepEqual(sqlLspCargoBuildArgs("source/Cargo.toml",true),["build","--release","--locked","--offline","--manifest-path","source/Cargo.toml"]);assert(!sqlLspCargoBuildArgs("source/Cargo.toml",false).includes("--offline"));
});
