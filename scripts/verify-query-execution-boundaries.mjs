import { readSourceText } from "./lib/source-text.mjs";

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertAcyclic,
  listTypeScriptModules,
  readRuntimeImports,
} from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) =>
  readSourceText(path.join(root, relativePath));
const compositionPath = "src/features/workspace-tabs/state/queryExecutionSlice.ts";
const base = "src/features/workspace-tabs/state/query-execution";
const composition = read(compositionPath);

for (const required of [
  'import { createCancelQueryAction } from "./query-execution/cancelQuery";',
  'import { createExplainPlanAction } from "./query-execution/explainPlan";',
  'import { createRunQueryAction } from "./query-execution/runQuery";',
  "...createRunQueryAction(set, get),",
  "...createExplainPlanAction(set, get),",
  "...createCancelQueryAction(set, get),",
]) {
  if (!composition.includes(required)) {
    throw new Error(`Query execution composition must retain ${required}.`);
  }
}
if (composition.includes("queryService") || composition.includes("useTaskStore")) {
  throw new Error("Query execution composition must not own transport or task lifecycle.");
}

const ownership = {
  runQuery: [
    'createRunQueryAction: TabSlice<"runTabQuery">',
    "restoreConnectionSession",
    "boundedQueryResultRuns",
    "recordExecution",
  ],
  explainPlan: [
    'createExplainPlanAction: TabSlice<"runExplainPlan">',
    "explainQuery",
    "queryOutputView: \"plan\"",
  ],
  cancelQuery: [
    'createCancelQueryAction: TabSlice<"cancelTabQuery">',
    "cancelQuery(queryId)",
  ],
};
for (const [module, symbols] of Object.entries(ownership)) {
  const source = read(`${base}/${module}.ts`);
  for (const symbol of symbols) {
    if (!source.includes(symbol)) {
      throw new Error(`Query execution ${module} owner must retain ${symbol}.`);
    }
  }
}
for (const [module, forbidden] of Object.entries({
  runQuery: ["runExplainPlan:", "cancelTabQuery:"],
  explainPlan: ["runTabQuery:", "cancelTabQuery:"],
  cancelQuery: ["runTabQuery:", "runExplainPlan:"],
})) {
  const source = read(`${base}/${module}.ts`);
  for (const symbol of forbidden) {
    if (source.includes(symbol)) {
      throw new Error(`Query execution ${module} must not absorb ${symbol}.`);
    }
  }
}

const files = listTypeScriptModules(root, base);
const graph = new Map();
for (const file of files) {
  const dependencies = new Set();
  for (const { specifier, resolved } of readRuntimeImports(root, file)) {
    if (resolved === compositionPath) {
      throw new Error(
        `${file} imports ${specifier}; query execution owners must not depend on their composition slice.`,
      );
    }
    if (files.includes(resolved)) dependencies.add(resolved);
  }
  graph.set(file, dependencies);
}
assertAcyclic(graph, "Query execution actions");
console.log(
  `Query execution boundaries verified: ${files.length} query, plan, and cancellation action modules with an acyclic composition.`,
);
