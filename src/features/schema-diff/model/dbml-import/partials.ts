import { type ExtractedBlock } from "@/features/schema-diff/model/dbml-import/blocks";
import { parseIdentifierPath } from "@/features/schema-diff/model/dbml-import/lexical";
import { removeTrailingSettings } from "@/features/schema-diff/model/dbml-import/settings";

export const MAX_DBML_PARTIAL_DEPTH = 32;

export const MAX_DBML_PARTIAL_INJECTIONS = 256;

export const MAX_DBML_EXPANDED_TABLE_LENGTH = 2 * 1_024 * 1_024;

export const MAX_DBML_PARTIAL_CACHE_LENGTH = 8 * 1_024 * 1_024;

export type TablePartialDefinition = {
  name: string;
  body: string;
};

export function parseTablePartials(
  blocks: ExtractedBlock[],
  targetSchema: string,
  warnings: Set<string>,
) {
  const partials = new Map<string, TablePartialDefinition>();
  for (const block of blocks) {
    const bareHeader = removeTrailingSettings(block.header);
    const path = parseIdentifierPath(bareHeader);
    const name = path[path.length - 1] || "";
    const schemaName =
      path.length > 1 ? path[path.length - 2] || "" : targetSchema;
    if (!name || path.length > 2) {
      warnings.add(
        "A TablePartial block with an unsupported identifier was ignored.",
      );
      continue;
    }
    if (schemaName && targetSchema && schemaName !== targetSchema) {
      warnings.add(
        `${schemaName}.${name}: skipped because a schema snapshot can only contain ${targetSchema}.`,
      );
      continue;
    }
    if (partials.has(name)) {
      warnings.add(
        `Duplicate TablePartial ${name}; the later definition was ignored.`,
      );
      continue;
    }
    if (bareHeader !== block.header.trim()) {
      warnings.add(
        `${name}: TablePartial table settings are review-only and were omitted.`,
      );
    }
    partials.set(name, { name, body: block.body });
  }
  return partials;
}

export function createTablePartialExpander(
  partials: Map<string, TablePartialDefinition>,
  warnings: Set<string>,
) {
  const cache = new Map<string, string>();
  let cachedLength = 0;

  const expandPartial = (name: string, stack: string[]): string => {
    const cached = cache.get(name);
    if (cached != null) return cached;
    const partial = partials.get(name);
    if (!partial) return "";
    if (cachedLength >= MAX_DBML_PARTIAL_CACHE_LENGTH) {
      warnings.add(
        `TablePartial expansion cache was limited to ${MAX_DBML_PARTIAL_CACHE_LENGTH} characters.`,
      );
      cache.set(name, "");
      return "";
    }
    if (stack.includes(name)) {
      warnings.add(
        `TablePartial cycle was ignored: ${[...stack, name].join(" -> ")}.`,
      );
      return "";
    }
    if (stack.length >= MAX_DBML_PARTIAL_DEPTH) {
      warnings.add(
        `TablePartial ${name} exceeded the ${MAX_DBML_PARTIAL_DEPTH}-level expansion limit.`,
      );
      return "";
    }
    const expanded = expandBody(partial.body, partial.name, [...stack, name]);
    if (cachedLength + expanded.length > MAX_DBML_PARTIAL_CACHE_LENGTH) {
      warnings.add(
        `TablePartial ${name} exceeded the remaining bounded expansion cache and was ignored.`,
      );
      cache.set(name, "");
      return "";
    }
    cachedLength += expanded.length;
    cache.set(name, expanded);
    return expanded;
  };

  const expandBody = (body: string, owner: string, stack: string[]) => {
    const localLines: string[] = [];
    const injectedBodies: string[] = [];
    let injectionCount = 0;
    let expandedLength = body.length;
    for (const line of body.split(/\r?\n/u)) {
      const injection = parsePartialInjection(line);
      if (!injection) {
        localLines.push(line);
        continue;
      }
      injectionCount += 1;
      if (injectionCount > MAX_DBML_PARTIAL_INJECTIONS) {
        warnings.add(
          `${owner}: TablePartial injections were limited to ${MAX_DBML_PARTIAL_INJECTIONS}.`,
        );
        continue;
      }
      if (!partials.has(injection)) {
        warnings.add(`${owner}: TablePartial ${injection} was not found.`);
        continue;
      }
      const expanded = expandPartial(injection, stack);
      if (expandedLength + expanded.length > MAX_DBML_EXPANDED_TABLE_LENGTH) {
        warnings.add(
          `${owner}: expanded TablePartial content exceeded ${MAX_DBML_EXPANDED_TABLE_LENGTH} characters and was truncated.`,
        );
        continue;
      }
      expandedLength += expanded.length;
      injectedBodies.push(expanded);
    }
    // DBML conflict priority is independent of injection position: local table
    // definitions override every partial, and the last injected partial wins.
    return [...injectedBodies, localLines.join("\n")]
      .filter(Boolean)
      .join("\n");
  };

  return (body: string, tableName: string) => expandBody(body, tableName, []);
}

export function parsePartialInjection(line: string) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("~")) return "";
  const source = removeTrailingSettings(trimmed.slice(1).trim());
  const path = parseIdentifierPath(source);
  return path.length === 1 ? path[0] || "" : "";
}
