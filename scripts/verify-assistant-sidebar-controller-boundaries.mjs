import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const facade = read("src/components/workspace/AssistantSidebar.tsx");
const controller = read("src/features/assistant-panel/hooks/useAssistantSidebarController.ts");
const workspaceState = read(
  "src/features/assistant-panel/hooks/useAssistantSidebarWorkspaceState.ts",
);
const view = read("src/features/assistant-panel/ui/AssistantSidebarView.tsx");
for (const required of ["useAssistantSidebarController", "AssistantSidebarView", "export function AssistantSidebar"]) {
  if (!facade.includes(required)) throw new Error(`Assistant facade must retain ${required}.`);
}
for (const required of [
  "export function useAssistantSidebarController",
  "useAssistantSidebarWorkspaceState(",
  "useAssistantAgentSession(",
  "useAssistantProviderLifecycle(",
  "createAssistantComposerActions({",
  "useAssistantPanelFileReview({",
  "createWorkspaceAiToolRegistry(",
]) {
  if (!controller.includes(required)) throw new Error(`Assistant controller must retain ${required}.`);
}
for (const required of [
  "export function useAssistantSidebarWorkspaceState",
  "useAiSettingsStore",
  "useAssistantComposerStore",
  "useAssistantCliSetupStore",
  "useConnectionStore",
  "useProjectStore",
  "useSchemaStore",
  "useTabStore",
  "useWorkbenchLayoutStore",
]) {
  if (!workspaceState.includes(required)) {
    throw new Error(`Assistant workspace state owner must retain ${required}.`);
  }
}
for (const forbidden of [
  "useAiSettingsStore(",
  "useAssistantComposerStore(",
  "useAssistantCliSetupStore(",
  "useConnectionStore(",
  "useProjectStore(",
  "useSchemaStore(",
  "useTabStore(",
  "useWorkbenchLayoutStore(",
]) {
  if (controller.includes(forbidden)) {
    throw new Error(`Assistant controller must inject ${forbidden} through workspace state.`);
  }
}
for (const required of ["AssistantConversation", "AssistantPromptBox", "AssistantProviderControl", "AssistantPendingChangesPanel"]) {
  if (!view.includes(required)) throw new Error(`Assistant view must retain ${required}.`);
}
for (const forbidden of ["useAiSettingsStore(", "useAssistantComposerStore(", "useProjectStore("]) {
  if (view.includes(forbidden)) throw new Error(`Assistant view must not select global state through ${forbidden}.`);
}
if (view.includes('components/workspace/AssistantSidebar')) throw new Error("Assistant view must not import its compatibility facade.");
console.log("Assistant sidebar controller boundaries verified: workspace selection, lifecycle orchestration, and presentation are explicit.");
