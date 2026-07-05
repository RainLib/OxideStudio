import type { AiToolRegistry } from "./registry";
import type { AiToolAdapters, AiToolDefinition } from "./types";

export type AiToolFactory = (adapters: AiToolAdapters) => AiToolDefinition;

export type AiToolFamily = {
  name: string;
  priority?: number;
  enabled?: (adapters: AiToolAdapters) => boolean;
  tools: AiToolFactory[];
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
    if (family.enabled && !family.enabled(adapters)) {
      continue;
    }
    for (const createTool of family.tools) {
      registry.register(createTool(adapters));
    }
  }

  return registry;
}

function compareAiToolFamilies(left: AiToolFamily, right: AiToolFamily) {
  const priorityDelta = (right.priority ?? 0) - (left.priority ?? 0);
  if (priorityDelta !== 0) return priorityDelta;
  return left.name.localeCompare(right.name);
}
