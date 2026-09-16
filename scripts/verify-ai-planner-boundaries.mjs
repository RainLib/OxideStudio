import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const facade = read("src/ai/assistant/planner.ts");
const classifier = read("src/ai/assistant/planner/classifyAssistantIntent.ts");
const signals = read("src/ai/assistant/planner/intentSignals.ts");
const extraction = read("src/ai/assistant/planner/inputExtraction.ts");
const structuredMutation = read("src/ai/assistant/planner/structuredMutation.ts");
const structuredRead = read("src/ai/assistant/planner/structuredRead.ts");
const suggestedPlan = read("src/ai/assistant/planner/suggestedPlan.ts");
const structuredPlanTypes = read("src/ai/assistant/planner/types.ts");

for (const required of [
  "export class DefaultAssistantPlanner",
  "export function createDefaultAssistantPlanner",
  "export { classifyAssistantIntent }",
  "buildSuggestedPlan(",
]) {
  if (!facade.includes(required)) {
    throw new Error(`AI planner facade must retain ${required}.`);
  }
}

for (const required of [
  "export function classifyAssistantIntent",
  "hasExplainIntent",
  "hasWriteIntent",
  "hasQueryIntent",
]) {
  if (!classifier.includes(required)) {
    throw new Error(`AI planner intent classifier must retain ${required}.`);
  }
}
for (const forbidden of ["buildSuggestedPlan", "defaultDatabaseCapabilities", "classifyAiQuerySafety"]) {
  if (classifier.includes(forbidden)) {
    throw new Error(`AI planner intent classifier must not own ${forbidden}.`);
  }
}

for (const required of [
  "export function parseSelectedRecordArray",
  "export function extractTargetName",
  "export function extractInlineJsonObject",
]) {
  if (!extraction.includes(required)) {
    throw new Error(`AI planner input extraction must retain ${required}.`);
  }
}
for (const forbidden of ["defaultDatabaseCapabilities", "buildSuggestedPlan", "selectedStructured"]) {
  if (extraction.includes(forbidden)) {
    throw new Error(`AI planner input extraction must not own ${forbidden}.`);
  }
}

for (const required of [
  "export function hasWriteIntent",
  "export function hasQueryPlanIntent",
  "export function hasIndexWriteIntent",
]) {
  if (!signals.includes(required)) {
    throw new Error(`AI planner intent signals must retain ${required}.`);
  }
}
if (/^import /m.test(signals)) {
  throw new Error("AI planner intent signals must remain a dependency-free rule module.");
}

for (const [name, source, required] of [
  [
    "structured mutation",
    structuredMutation,
    "export function selectedStructuredMutationPlan",
  ],
  [
    "structured read",
    structuredRead,
    "export function selectedStructuredReadPlan",
  ],
  ["suggested plan", suggestedPlan, "export function buildSuggestedPlan"],
]) {
  if (!source.includes(required)) {
    throw new Error(`AI planner ${name} must retain ${required}.`);
  }
  if (source.includes('"@/ai/assistant/planner"')) {
    throw new Error(`AI planner ${name} must not import its compatibility facade.`);
  }
}

if (!structuredPlanTypes.includes("export type AssistantStructuredPlan")) {
  throw new Error("AI planner structured-plan contract must remain independently owned.");
}
if (structuredRead.includes('planner/structuredMutation')) {
  throw new Error("AI planner structured reads must use the shared plan contract, not mutation ownership.");
}
for (const required of [
  "selectedStructuredMutationPlan",
  "selectedStructuredReadPlan",
  "selectedMutationTool",
  "classifyAiQuerySafety",
]) {
  if (!suggestedPlan.includes(required)) {
    throw new Error(`AI planner suggested-plan owner must retain ${required}.`);
  }
}

console.log("AI planner boundaries verified: stable planner facade, rules, input parsing, structured plans, and policy-aware plan assembly are explicit.");
