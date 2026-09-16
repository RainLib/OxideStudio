import { maskElasticsearchConsoleComments } from "@/features/query-languages/elasticsearch/comments";

export function prepareElasticsearchConsoleExecution(source: string) {
  return maskElasticsearchConsoleComments(source).trim();
}

export function elasticsearchConsoleVariableNames(source: string) {
  const names: string[] = [];
  for (const match of source.matchAll(/\$\{([\w.-]+)\}/g)) {
    const name = match[1]!;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

function parsedConsoleVariable(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function isInsideJsonString(source: string, offset: number) {
  let inString = false;
  let escaped = false;
  for (let index = 0; index < offset; index += 1) {
    const character = source[index]!;
    if (escaped) {
      escaped = false;
    } else if (character === "\\") {
      escaped = inString;
    } else if (character === '"') {
      inString = !inString;
    }
  }
  return inString;
}

/**
 * Applies Kibana-compatible variable coercion. A quoted, standalone variable
 * may become a JSON scalar/object; triple quotes always force a string.
 */
export function substituteElasticsearchConsoleVariables(
  source: string,
  variables: Record<string, string> = {},
) {
  const missingVariable = elasticsearchConsoleVariableNames(source).find(
    (name) => !Object.prototype.hasOwnProperty.call(variables, name),
  );
  if (missingVariable) {
    throw new Error(
      `Elasticsearch Console variable "\${${missingVariable}}" needs a value.`,
    );
  }

  const resolve = (name: string) => {
    if (!Object.prototype.hasOwnProperty.call(variables, name)) {
      throw new Error(
        `Elasticsearch Console variable "\${${name}}" needs a value.`,
      );
    }
    return parsedConsoleVariable(variables[name]!);
  };

  let substituted = source.replace(
    /"""\s*\$\{([\w.-]+)\}\s*"""/g,
    (_match, name: string) => JSON.stringify(String(resolve(name))),
  );
  substituted = substituted.replace(
    /"\$\{([\w.-]+)\}"/g,
    (_match, name: string) => JSON.stringify(resolve(name)),
  );
  substituted = substituted.replace(
    /\$\{([\w.-]+)\}/g,
    (_match, name: string, offset: number) => {
      const value = resolve(name);
      if (isInsideJsonString(substituted, offset)) {
        return JSON.stringify(String(value)).slice(1, -1);
      }
      const lineStart = substituted.lastIndexOf("\n", offset - 1) + 1;
      const linePrefix = substituted.slice(lineStart, offset);
      if (/^\s*(?:GET|POST|PUT|PATCH|DELETE|HEAD)\s+\S*$/i.test(linePrefix)) {
        return String(value);
      }
      return JSON.stringify(value);
    },
  );
  return substituted;
}

export function compileElasticsearchConsoleExecution(
  source: string,
  variables: Record<string, string> = {},
) {
  return substituteElasticsearchConsoleVariables(
    prepareElasticsearchConsoleExecution(source),
    variables,
  );
}
