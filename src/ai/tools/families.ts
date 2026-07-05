import type { AiToolRegistry } from "./registry";
import type { AiToolAdapters, AiToolDefinition } from "./types";

export type AiToolFactory = (adapters: AiToolAdapters) => AiToolDefinition;

export type AiToolFamily = {
  name: string;
  enabled?: (adapters: AiToolAdapters) => boolean;
  tools: AiToolFactory[];
};

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
