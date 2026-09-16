import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const facade = read("src/lib/queryEditorCachedCompletion.ts");
const lexical = read("src/features/query-editor/model/cached-completion/lexical.ts");
const syntax = read("src/features/query-editor/model/cached-completion/syntax.ts");
const relations = read("src/features/query-editor/model/cached-completion/relations.ts");
const projections = read("src/features/query-editor/model/cached-completion/projections.ts");

for (const required of [
  "Compatibility facade for cached SQL completion fallbacks",
  "cachedSqlJoinTargetContext",
  "cachedSqlProjectionSources",
  "sqlStatementBeforeCursor",
]) {
  if (!facade.includes(required)) throw new Error(`Cached completion facade must retain ${required}.`);
}
for (const required of [
  "maskSqlCommentsAndLiterals",
  "currentTopLevelStatementBeforeCursor",
  "splitQualifiedIdentifier",
  "sqlStatementBeforeCursor",
]) {
  if (!lexical.includes(required)) throw new Error(`Cached completion lexical owner must retain ${required}.`);
}
for (const required of [
  "RELATION_MATCHER",
  "CTE_DECLARATION_MATCHER",
  "COMPLETE_QUALIFIED_IDENTIFIER_MATCHER",
  "splitDelimitedIdentifiers",
]) {
  if (!syntax.includes(required)) throw new Error(`Cached completion syntax owner must retain ${required}.`);
}
for (const required of [
  "cachedSqlRelationsBeforeCursor",
  "cachedSqlJoinTargetContext",
  "cachedSqlRelationForFieldCompletion",
  'from "./lexical"',
  'from "./syntax"',
]) {
  if (!relations.includes(required)) throw new Error(`Cached completion relation owner must retain ${required}.`);
}
for (const required of [
  "cachedSqlProjectionSources",
  "cachedSqlRelationsBeforeCursor",
  "topLevelSelectList",
]) {
  if (!projections.includes(required)) throw new Error(`Cached completion projection owner must retain ${required}.`);
}
for (const source of [lexical, syntax, relations, projections]) {
  if (source.includes('queryEditorCachedCompletion"')) {
    throw new Error("Cached completion implementation must not import its compatibility facade.");
  }
}
console.log("Cached SQL completion boundaries verified: lexical, syntax, relation, and projection owners are acyclic.");
