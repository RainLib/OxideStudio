import { readSourceText } from "./lib/source-text.mjs";

import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = "src-tauri/src/core/driver";
const facade = readSourceText(path.join(root, `${base}.rs`));

for (const required of [
  "mod contract;",
  "mod models;",
  "#[cfg(test)]\nmod tests;",
  "pub use contract::DatabaseDriver;",
  "pub use models::*;",
]) {
  if (!facade.includes(required)) {
    throw new Error(`Core driver facade must retain ${required}.`);
  }
}

if (/\btrait\s+DatabaseDriver\b|\bstruct\s+DocumentPageRequest\b/.test(facade)) {
  throw new Error("Core driver facade must not regain contract or model ownership.");
}

const ownership = {
  contract: ["fn unsupported_driver_feature", "pub trait DatabaseDriver", "async fn connect"],
  models: ["pub struct DocumentPageRequest", "pub struct LocalDatabaseBackupControl", "pub struct SqliteRebuildReceipt"],
  tests: ["minimal_driver_can_rely_on_non_relational_defaults", "default_collection_pages_filter_before_paginating"],
};

for (const [module, symbols] of Object.entries(ownership)) {
  const source = readSourceText(path.join(root, `${base}/${module}.rs`));
  if (symbols.some((symbol) => !source.includes(symbol))) {
    throw new Error(`${module} must retain its Core driver ownership.`);
  }
}

const contract = readSourceText(path.join(root, `${base}/contract.rs`));
if (!contract.includes("use super::models::*;") || !/use super::super::\s*\{[\s\S]*?\bprotocol::/.test(contract)) {
  throw new Error("Core driver contract must depend on models and core protocol directly.");
}

console.log("Rust Core driver boundaries verified: facade, contract, models, and tests are explicit.");
