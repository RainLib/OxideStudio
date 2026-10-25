import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { readSourceText } from "./lib/source-text.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const baseline = JSON.parse(readSourceText(resolve(
  root, "src/features/database-drivers/model/__fixtures__/dbx-catalog-2026-10-21.json",
)));
const [sourceDirectory = resolve(root, "sources/dbx"), requestedRevision = "HEAD", ...extra] = process.argv.slice(2);
if (extra.length || !/^[a-zA-Z0-9][a-zA-Z0-9/_.-]{0,127}$/.test(requestedRevision)) {
  throw new Error("Usage: node scripts/audit-dbx-reference-catalog.mjs [repository] [revision]");
}
const git = (...args) => execFileSync("git", ["-C", sourceDirectory, ...args], {
  encoding: "utf8", timeout: 15_000, windowsHide: true,
});
const revision = git("rev-parse", "--verify", `${requestedRevision}^{commit}`).trim();
const content = git("show", `${revision}:${baseline.catalogPath}`);
const source = ts.createSourceFile("databaseTypes.ts", content, ts.ScriptTarget.Latest, true);
const declaration = source.statements
  .flatMap((statement) => ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : [])
  .find((entry) => ts.isIdentifier(entry.name) && entry.name.text === "DATABASE_TYPES");
let expression = declaration?.initializer;
while (expression && (ts.isAsExpression(expression) || ts.isParenthesizedExpression(expression))) {
  expression = expression.expression;
}
if (!expression || !ts.isArrayLiteralExpression(expression) ||
    !expression.elements.every(ts.isStringLiteral)) {
  throw new Error("Upstream DATABASE_TYPES is no longer a literal catalog; review the source format");
}
const ids = expression.elements.map((entry) => entry.text);
if (new Set(ids).size !== ids.length) throw new Error("Upstream catalog contains duplicate ids");
const addedTypes = ids.filter((id) => !baseline.databaseTypes.includes(id)).sort();
const removedTypes = baseline.databaseTypes.filter((id) => !ids.includes(id)).sort();
console.log(JSON.stringify({
  repository: baseline.repository,
  baselineRevision: baseline.revision,
  comparedRevision: revision,
  entryCount: ids.length,
  addedTypes,
  removedTypes,
}, null, 2));
process.exitCode = addedTypes.length || removedTypes.length ? 1 : 0;
