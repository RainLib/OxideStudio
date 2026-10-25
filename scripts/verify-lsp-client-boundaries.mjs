import { readSourceText } from "./lib/source-text.mjs";

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertAcyclic,
  listTypeScriptModules,
  readRuntimeImports,
} from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readSourceText(path.join(root, relativePath));
const facadePath = "src/services/lsp/client.ts";
const base = "src/services/lsp/client";
const facade = read(facadePath);
const client = read(`${base}/LspClient.ts`);

for (const required of [
  'export type { LspCancellationToken } from "./client/contracts";',
  'export { LspClient } from "./client/LspClient";',
  "export const lspClient = new LspClient()",
]) {
  if (!facade.includes(required)) {
    throw new Error(`LSP client facade must retain ${required}.`);
  }
}
for (const required of [
  "export class LspClient",
  "async initialize(",
  "async shutdown(",
  "private async request<",
  "getLspCompletionList",
  "getLspHover",
  "updateLspConfiguration",
  "notifyLspDidOpen",
]) {
  if (!client.includes(required)) {
    throw new Error(`LSP client lifecycle facade must retain ${required}.`);
  }
}

const ownership = {
  completionSnapshot:["getLspCompletionSnapshot"],
  completionConstraints:["parseCompletionConstraints"],
  completionValueType:["parseCompletionValueType"],
  analysisConfiguration: ["confirmLspAnalysisConfiguration"],
  diagnostics:["getLspDiagnosticSnapshot"],
  documentStructure:["getLspDocumentStructure"],
  documentSemantics:["getLspDocumentSemantics"],
  documentCompletions:["getLspDocumentCompletions"],
  documentSemanticValidation:["validDocumentSemanticValue"],
  completion: ["getLspCompletionList", "resolveLspCompletionItem"],
  documents: [
    "getLspInlineCompletionContext",
    "updateLspConfiguration",
    "notifyLspDidOpen",
    "notifyLspDidChange",
    "notifyLspDidClose",
  ],
  navigation: [
    "getLspHover",
    "getLspDefinitions",
    "formatLspDocument",
    "getLspSemanticTokens",
    "searchLspWorkspaceSymbols",
  ],
  parsing: ["parseRange", "parseLocations", "parseTextEdits", "normalizeMarkup"],
  transport: [
    "requestSessionPayload",
    "commandSessionPayload",
    "invokeCancellableLspCommand",
  ],
};
for (const [module, symbols] of Object.entries(ownership)) {
  const source = read(`${base}/${module}.ts`);
  for (const symbol of symbols) {
    if (!source.includes(symbol)) {
      throw new Error(`LSP client ${module} owner must retain ${symbol}.`);
    }
  }
}
for (const module of ["completion", "documents", "navigation", "parsing", "diagnostics", "analysisConfiguration", "documentStructure", "documentSemantics", "documentCompletions", "documentSemanticValidation", "completionSnapshot", "completionConstraints"]) {
  const source = read(`${base}/${module}.ts`);
  if (source.includes("@tauri-apps/api/core")) {
    throw new Error(`LSP client ${module} must dispatch through its transport bridge.`);
  }
}
for(const module of ["parsing","documentSemanticValidation"]){if (read(`${base}/${module}.ts`).includes("LspClient")) {
  throw new Error("LSP response parsing must remain independent of the client lifecycle.");
}}

const files = listTypeScriptModules(root, base);
const graph = new Map();
for (const file of files) {
  const dependencies = new Set();
  for (const { specifier, resolved } of readRuntimeImports(root, file)) {
    if (resolved === facadePath) {
      throw new Error(
        `${file} imports ${specifier}; LSP client implementation must not depend on its compatibility facade.`,
      );
    }
    if (files.includes(resolved)) dependencies.add(resolved);
  }
  graph.set(file, dependencies);
}
assertAcyclic(graph, "LSP client");
console.log(
  `LSP client boundaries verified: stable facade, ${graph.size} scoped implementation modules, and acyclic transport dependencies are explicit.`,
);
