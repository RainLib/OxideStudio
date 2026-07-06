import type { AiToolRegistry } from "./registry";
import type { AiToolAdapters, AiToolDefinition } from "./types";

export type AiToolFactory = (adapters: AiToolAdapters) => AiToolDefinition;
export type AiToolAdapterName = keyof AiToolAdapters;

export type AiToolFamily = {
  name: string;
  priority?: number;
  requiredAdapters?: AiToolAdapterName[];
  enabled?: (adapters: AiToolAdapters) => boolean;
  tools: AiToolFactory[];
};

export type AiToolFamilyAvailability = {
  name: string;
  enabled: boolean;
  toolCount: number;
  requiredAdapters: AiToolAdapterName[];
  missingAdapters: AiToolAdapterName[];
};

const registeredAiToolFamilies: AiToolFamily[] = [];

export function registerAiToolFamily(family: AiToolFamily) {
  const name = family.name.trim();
  if (!name) {
    throw new Error("AI tool family name is required");
  }

  const normalizedFamily = { ...family, name };
  const existingIndex = registeredAiToolFamilies.findIndex(
    (candidate) => candidate.name === name
  );

  if (existingIndex >= 0) {
    registeredAiToolFamilies.splice(existingIndex, 1, normalizedFamily);
  } else {
    registeredAiToolFamilies.push(normalizedFamily);
  }

  registeredAiToolFamilies.sort(compareAiToolFamilies);
}

export function unregisterAiToolFamily(name: string) {
  const normalized = name.trim();
  const existingIndex = registeredAiToolFamilies.findIndex(
    (candidate) => candidate.name === normalized
  );
  if (existingIndex < 0) return false;
  registeredAiToolFamilies.splice(existingIndex, 1);
  return true;
}

export function listRegisteredAiToolFamilies() {
  return [...registeredAiToolFamilies].sort(compareAiToolFamilies);
}

export function mergeAiToolFamilies(
  baseFamilies: AiToolFamily[],
  extensionFamilies: AiToolFamily[] = registeredAiToolFamilies
) {
  const families = new Map<string, AiToolFamily>();

  for (const family of baseFamilies) {
    families.set(family.name, family);
  }
  for (const family of extensionFamilies) {
    families.set(family.name, family);
  }

  return Array.from(families.values()).sort(compareAiToolFamilies);
}

export function registerAiToolFamilies(
  registry: AiToolRegistry,
  adapters: AiToolAdapters,
  families: AiToolFamily[]
) {
  for (const family of families) {
    if (!isAiToolFamilyEnabled(family, adapters)) {
      continue;
    }
    for (const createTool of family.tools) {
      registry.register(createTool(adapters));
    }
  }

  return registry;
}

export function describeAiToolFamilyAvailability(
  families: AiToolFamily[],
  adapters: AiToolAdapters
): AiToolFamilyAvailability[] {
  return families.map((family) => {
    const requiredAdapters = family.requiredAdapters ?? [];
    const missingAdapters = missingAiToolAdapters(requiredAdapters, adapters);
    const enabled =
      missingAdapters.length === 0 && (!family.enabled || family.enabled(adapters));

    return {
      name: family.name,
      enabled,
      toolCount: family.tools.length,
      requiredAdapters,
      missingAdapters,
    };
  });
}

export function isAiToolFamilyEnabled(
  family: AiToolFamily,
  adapters: AiToolAdapters
) {
  return (
    missingAiToolAdapters(family.requiredAdapters ?? [], adapters).length === 0 &&
    (!family.enabled || family.enabled(adapters))
  );
}

function missingAiToolAdapters(
  requiredAdapters: AiToolAdapterName[],
  adapters: AiToolAdapters
) {
  return requiredAdapters.filter((adapterName) => !adapters[adapterName]);
}

function compareAiToolFamilies(left: AiToolFamily, right: AiToolFamily) {
  const priorityDelta = (right.priority ?? 0) - (left.priority ?? 0);
  if (priorityDelta !== 0) return priorityDelta;
  return left.name.localeCompare(right.name);
}
