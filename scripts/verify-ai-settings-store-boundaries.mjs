import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const facade = read("src/store/useAiSettingsStore.ts");
const moduleRoot = "src/store/ai-settings";
const contracts = read(`${moduleRoot}/contracts.ts`);
const defaults = read(`${moduleRoot}/defaults.ts`);
const cliPreferences = read(`${moduleRoot}/cliPreferences.ts`);
const providerConfig = read(`${moduleRoot}/providerConfig.ts`);
const actions = read(`${moduleRoot}/actions.ts`);
const persistence = read(`${moduleRoot}/persistence.ts`);
const factory = read(`${moduleRoot}/createAiSettingsStore.ts`);

for (const required of [
  "createAiSettingsStore",
  "AiSettingsState",
  "AiSettingsValues",
  "migratePersistedAiSettings",
]) {
  if (!facade.includes(required)) {
    throw new Error(`AI settings facade must retain ${required}.`);
  }
}

for (const source of [
  contracts,
  defaults,
  cliPreferences,
  providerConfig,
  actions,
  persistence,
  factory,
]) {
  if (source.includes("useAiSettingsStore")) {
    throw new Error("AI settings owners cannot import their compatibility facade.");
  }
}
if (contracts.includes("aiService") || defaults.includes("aiService")) {
  throw new Error("AI settings contracts and defaults must stay independent from IPC.");
}
if (
  !cliPreferences.includes("withCliReasoningPreferences") ||
  cliPreferences.includes("persist(")
) {
  throw new Error("CLI preference owner must retain model-scoped preference rules only.");
}
if (
  !providerConfig.includes("assistantProviderConfigForState") ||
  !providerConfig.includes("inlineProviderConfigForState") ||
  providerConfig.includes("aiService")
) {
  throw new Error("Provider-config owner must stay a pure state projection.");
}
if (
  !persistence.includes("migratePersistedAiSettings") ||
  !persistence.includes("migrateLegacyAiSecrets") ||
  persistence.includes("createAiSettingsStore")
) {
  throw new Error("AI settings persistence must own migration without composing the store.");
}
if (
  !factory.includes("persist(") ||
  !factory.includes("createAiSettingsActions") ||
  !factory.includes("assistantProviderConfigForState")
) {
  throw new Error("AI settings factory must compose persistence, actions, and projections.");
}

console.log(
  "AI settings store boundaries verified: contract, defaults, CLI preferences, provider projections, persistence, and actions are explicit.",
);
