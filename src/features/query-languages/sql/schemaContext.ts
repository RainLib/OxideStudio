import {
  splitSqlStatements,
  stripLeadingSqlComments,
} from "@/features/query-languages/sql/statements";

function firstMatchedGroup(match: RegExpMatchArray | null) {
  return (
    match
      ?.slice(1)
      .find((value) => value && value.trim())
      ?.trim() || null
  );
}

function normalizeSchemaToken(value: string | null) {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "$user") return null;
  return trimmed;
}

function parseSchemaList(value: string) {
  const schemas: string[] = [];
  let index = 0;
  const input = value.trim().replace(/;+\s*$/, "");

  while (index < input.length) {
    while (index < input.length && /[\s,]/.test(input[index] || "")) {
      index += 1;
    }
    if (index >= input.length) break;

    const quote = input[index];
    if (quote === '"' || quote === "'" || quote === "`") {
      let schema = "";
      index += 1;

      while (index < input.length) {
        const char = input[index] || "";
        index += 1;

        if (char === quote) {
          if (input[index] === quote) {
            schema += quote;
            index += 1;
            continue;
          }
          break;
        }

        schema += char;
      }

      schemas.push(schema);
      continue;
    }

    const start = index;
    while (index < input.length && input[index] !== ",") {
      index += 1;
    }
    schemas.push(input.slice(start, index).trim());
  }

  return schemas;
}

function extractSchemaContextFromStatement(sql: string) {
  const statement = stripLeadingSqlComments(sql);
  const useMatch = statement.match(
    /^USE\s+(?:`([^`]+)`|"([^"]+)"|([a-zA-Z_][a-zA-Z0-9_$]*))\s*;?$/i,
  );
  const useSchema = normalizeSchemaToken(firstMatchedGroup(useMatch));
  if (useSchema) return useSchema;

  const searchPathMatch = statement.match(
    /^SET\s+search_path\s*(?:TO|=)\s*([\s\S]*?)\s*;?$/i,
  );
  const searchPathSchema = searchPathMatch?.[1]
    ? parseSchemaList(searchPathMatch[1])
        .map((schema) => normalizeSchemaToken(schema))
        .find((schema): schema is string => Boolean(schema))
    : null;
  if (searchPathSchema) return searchPathSchema;

  const setSchemaMatch = statement.match(
    /^SET\s+SCHEMA\s+(?:`([^`]+)`|"([^"]+)"|'([^']+)'|([a-zA-Z_][a-zA-Z0-9_$]*))\s*;?$/i,
  );
  return normalizeSchemaToken(firstMatchedGroup(setSchemaMatch));
}

export function extractSchemaContextChange(sql: string) {
  let selectedSchema: string | null = null;
  for (const statement of splitSqlStatements(sql)) {
    selectedSchema =
      extractSchemaContextFromStatement(statement) || selectedSchema;
  }
  return selectedSchema;
}
