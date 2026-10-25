import { readSourceText } from "./lib/source-text.mjs";

import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readSourceText(path.join(root, relativePath));
const facade = read("src/lib/queryEditorCachedCompletion.ts");
const lexical = read("src/features/query-editor/model/cached-completion/lexical.ts");
const syntax = read("src/features/query-editor/model/cached-completion/syntax.ts");
const relations = read("src/features/query-editor/model/cached-completion/relations.ts");
const projections = read("src/features/query-editor/model/cached-completion/projections.ts");
const queryScopes = read("src/features/query-editor/model/cached-completion/queryScopes.ts");
const metadataSearch = read("src/features/query-editor/model/cached-completion/metadataSearch.ts");
const identifierEdits = read("src/features/query-editor/model/cached-completion/identifierEdits.ts");
const fieldCache = read("src/features/query-editor/model/cached-completion/fieldCache.ts");
const identifierFragments = read("src/features/query-editor/model/cached-completion/identifierFragments.ts");
const documentContext = read("src/features/query-editor/model/cached-completion/documentContext.ts");
const localMetadata = read("src/features/query-editor/model/cached-completion/localMetadata.ts");
const localDeclarations = read("src/features/query-editor/model/cached-completion/localDeclarations.ts");
const structure = read("src/features/query-editor/model/cached-completion/structure.ts");
const columnIdentity = read("src/features/query-editor/model/cached-completion/columnIdentity.ts");
const uniqueColumn = read("src/features/query-editor/model/cached-completion/uniqueColumn.ts");
const namespace = read("src/features/query-editor/model/cached-completion/namespace.ts");

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
for (const [source, symbols] of [
  [queryScopes, ["cachedQueryScopes", "relationAt", "declarationAt"]],
  [metadataSearch, ["searchCachedColumns", "MAX_CACHED_FIELD_COMPLETIONS", "boundedCachedComment"]],
  [identifierEdits, ["cachedIdentifierRange", "cachedIdentifierInsertion"]],
  [fieldCache, ["cachedMetadataKey", "rememberCachedFields", "CACHED_FIELDS_MAX_ESTIMATED_BYTES"]],
  [identifierFragments, ["plainIdentifierSuffix", "cachedIdentifierFragment", "cachedIdentifierQualifier"]],
  [documentContext, ["cachedSqlDocumentContext", "MAX_CACHED_SQL_DOCUMENT_CODE_UNITS", "currentTopLevelStatementAtCursor"]],
  [localMetadata, ["createCachedLocalMetadataResolver", "cachedSqlFieldBindings", "cachedColumnMatches"]],
  [columnIdentity, ["cachedColumnMatches"]],
  [uniqueColumn, ["uniqueCachedColumn", "MAX_UNQUALIFIED_CACHED_INPUTS"]],
  [namespace, ["cachedPhysicalNamespaceSupported", "cachedCatalogNamespaceMatches"]],
  [localDeclarations, ["cachedLocalDeclarations", "localColumnList", "matchingSqlParenthesis"]],
  [structure, ["matchingSqlParenthesis", "quotedSqlIdentifierEnd", "topLevelSqlWords", "isSqlComparisonFrom"]],
]) for (const symbol of symbols) if (!source.includes(symbol))
  throw new Error(`Cached completion owner must retain ${symbol}.`);
if (!relations.includes('from "./queryScopes"')) throw new Error("Cached relation binding must use explicit query ownership.");
for (const source of [lexical, syntax, relations, projections, queryScopes, metadataSearch, identifierEdits, fieldCache, identifierFragments, documentContext, localMetadata, localDeclarations, structure, columnIdentity, uniqueColumn, namespace]) {
  if (source.includes('queryEditorCachedCompletion"')) {
    throw new Error("Cached completion implementation must not import its compatibility facade.");
  }
}
console.log("Cached SQL completion boundaries verified: lexical, syntax, relation, projection, query ownership, metadata search, identifier edits, and bounded field-cache owners are explicit.");
