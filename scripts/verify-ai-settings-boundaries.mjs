import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertAcyclic,
  listTypeScriptModules,
  readRuntimeImports,
} from "./lib/runtime-import-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const uiPath = "src/features/settings/ui/AiSettings.tsx";
const hookPath = "src/features/settings/hooks/useAiCliSettings.ts";
const providerPath = "src/features/settings/ui/AiAssistantProviderSettingsSection.tsx";
const inlinePath = "src/features/settings/ui/AiInlineCompletionSettingsSection.tsx";
const safetyPath = "src/features/settings/ui/AiSafetyAndConversationSettingsSection.tsx";
const typesPath = "src/features/settings/ui/aiSettingsTypes.ts";
const ui = read(uiPath);
const hook = read(hookPath);
const provider = read(providerPath);
const inline = read(inlinePath);
const safety = read(safetyPath);
const types = read(typesPath);

for (const required of ["export interface AiSettingsProps", "export type UpdateAiSettings"]) {
  if (!types.includes(required)) {
    throw new Error(`AI settings contract must retain ${required}.`);
  }
}
for (const required of [
  'import { useAiCliSettings } from "@/features/settings/hooks/useAiCliSettings";',
  'import type { AiSettingsProps } from "@/features/settings/ui/aiSettingsTypes";',
  "useAiCliSettings({",
  'import { AiAssistantProviderSettingsSection } from "@/features/settings/ui/AiAssistantProviderSettingsSection";',
  "<AiAssistantProviderSettingsSection",
  'import { AiInlineCompletionSettingsSection } from "@/features/settings/ui/AiInlineCompletionSettingsSection";',
  "<AiInlineCompletionSettingsSection",
  'import { AiSafetyAndConversationSettingsSection } from "@/features/settings/ui/AiSafetyAndConversationSettingsSection";',
  "<AiSafetyAndConversationSettingsSection",
]) {
  if (!ui.includes(required)) {
    throw new Error(`AI settings UI must compose ${required}.`);
  }
}
for (const forbidden of ["aiService", "@tauri-apps/plugin-dialog", "useEffect", "useState"]) {
  if (ui.includes(forbidden)) {
    throw new Error(`AI settings UI must not own CLI lifecycle dependency ${forbidden}.`);
  }
}
for (const required of [
  "export function AiAssistantProviderSettingsSection",
  "ProviderHeadersEditor",
  "selectCliExecutable",
  "Model supports tool calling",
  "Test Provider",
]) {
  if (!provider.includes(required)) {
    throw new Error(`Assistant provider settings owner must retain ${required}.`);
  }
}
for (const forbidden of ["ProviderHeadersEditor", "Model supports tool calling", "Test Provider"]) {
  if (ui.includes(forbidden)) {
    throw new Error(`AI settings UI must not retain provider presentation ${forbidden}.`);
  }
}
for (const required of [
  "export function AiInlineCompletionSettingsSection",
  "updateInlineCompletion",
  "Include schema metadata",
  "Include project context",
  "ProviderHeadersEditor",
]) {
  if (!inline.includes(required)) {
    throw new Error(`Inline completion settings owner must retain ${required}.`);
  }
}
for (const forbidden of ["inlineCompletion = settings.editor.inlineCompletion", "updateInlineCompletion"]) {
  if (ui.includes(forbidden)) {
    throw new Error(`AI settings UI must not retain inline completion state ${forbidden}.`);
  }
}
for (const required of [
  "export function AiSafetyAndConversationSettingsSection",
  "settings.openJson",
  "Conversation Data",
  "Clear data for",
]) {
  if (!safety.includes(required)) {
    throw new Error(`AI safety owner must retain ${required}.`);
  }
}
for (const forbidden of ["settings.openJson", "Conversation Data"]) {
  if (ui.includes(forbidden)) {
    throw new Error(`AI settings UI must not retain safety presentation ${forbidden}.`);
  }
}
for (const required of [
  "export function useAiCliSettings",
  "aiService.setCliEnvironment",
  "aiService.detectCliProvider",
  "aiService.listCliModels",
  'import("@tauri-apps/plugin-dialog")',
  "useEffect",
]) {
  if (!hook.includes(required)) {
    throw new Error(`AI CLI lifecycle owner must retain ${required}.`);
  }
}
if (hook.includes("AiSettings.tsx") || types.includes("AiSettings.tsx")) {
  throw new Error("AI settings lifecycle and contracts must not depend on their UI facade.");
}

const base = "src/features/settings";
const files = listTypeScriptModules(root, base);
const graph = new Map();
for (const file of files) {
  const dependencies = new Set();
  for (const { specifier, resolved } of readRuntimeImports(root, file)) {
    if (resolved === uiPath && file !== uiPath) {
      throw new Error(
        `${file} imports ${specifier}; settings owners must not depend on the AI settings UI facade.`,
      );
    }
    if (files.includes(resolved)) dependencies.add(resolved);
  }
  graph.set(file, dependencies);
}
assertAcyclic(graph, "AI settings");
console.log(
  `AI settings boundaries verified: public contract, CLI lifecycle, and ${graph.size} settings modules are acyclic.`,
);
