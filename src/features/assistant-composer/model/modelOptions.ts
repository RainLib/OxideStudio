import type { AiCliModelInfo } from "@/services/tauri/ai.service";

export const MODEL_SEARCH_THRESHOLD = 10;

export const MAX_RENDERED_MODEL_OPTIONS = 100;

export function normalizeModelOptions(
  modelOptions?: readonly AiCliModelInfo[],
) {
  if (!modelOptions?.length) return [];
  if (modelOptions.some((option) => option.id === "default")) {
    return modelOptions;
  }
  return [
    {
      id: "default",
      label: "Provider default",
      isDefault: true,
      reasoningEfforts: modelOptions.find((option) => option.isProviderDefault)
        ?.reasoningEfforts,
      serviceTiers: modelOptions.find((option) => option.isProviderDefault)
        ?.serviceTiers,
    },
    ...modelOptions,
  ];
}

export function findSelectedModel(
  options: readonly AiCliModelInfo[],
  model: string,
) {
  return options.find((option) => option.id === model);
}

export function displayModelLabel(
  selected: AiCliModelInfo | undefined,
  model: string,
  defaultLabel: string,
) {
  if (model === "default") return defaultLabel;
  return selected?.label || model || defaultLabel;
}

export function displayEffectiveModelLabel(
  options: readonly AiCliModelInfo[],
  selected: AiCliModelInfo | undefined,
  model: string,
  defaultLabel: string,
) {
  if (model !== "default") return selected?.label || model || defaultLabel;
  const concreteDefault = options.find(
    (option) => option.id !== "default" && option.isProviderDefault,
  );
  return concreteDefault?.label || defaultLabel;
}
