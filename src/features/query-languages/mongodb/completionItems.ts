import {
  OPERATOR_VALUE_TEMPLATES,
  STAGE_FIELD_VALUE_KEYS,
  STAGE_OPTION_KEYS,
} from "@/features/query-languages/mongodb/jsonCatalog";
import { MONGODB_SHELL_OPTION_KEYS } from "@/features/query-languages/mongodb/shellCatalog";
import { type MongoDbConsoleCompletion } from "@/features/query-languages/mongodb/types";

export function matches(value: string, typed: string) {
  return (
    !typed || value.toLocaleLowerCase().startsWith(typed.toLocaleLowerCase())
  );
}

export function propertyItems(
  keys: readonly string[],
  typed: string,
  detail: string,
): MongoDbConsoleCompletion[] {
  return keys
    .filter((key) => matches(key, typed))
    .map((key) => ({
      label: key,
      detail,
      insertText: `"${key}": ${key === "limit" || key === "skip" ? "${1:0}" : "${1}"}`,
      kind: "property",
    }));
}

export function operatorItems(
  values: readonly string[],
  typed: string,
  detail: string,
): MongoDbConsoleCompletion[] {
  return values
    .filter((value) => matches(value, typed))
    .map((value) => ({
      label: value,
      detail,
      insertText: `"${value}": ${
        detail.includes("accumulator") && value === "$count"
          ? "{}"
          : OPERATOR_VALUE_TEMPLATES[value] || "${1}"
      }`,
      kind: "operator",
    }));
}

export function shellOptionItems(method: string | undefined, typed: string) {
  return (MONGODB_SHELL_OPTION_KEYS[method || ""] || [])
    .filter((key) => matches(key, typed))
    .map((key) => {
      let value = "${1}";
      if (
        [
          "allowDiskUse",
          "bypassDocumentValidation",
          "hidden",
          "ordered",
          "sparse",
          "unique",
          "upsert",
        ].includes(key)
      ) {
        value = "${1:true}";
      } else if (
        ["expireAfterSeconds", "limit", "maxTimeMS", "skip"].includes(key)
      ) {
        value = "${1:0}";
      } else if (key === "returnDocument") {
        value = '"${1:after}"';
      } else if (key === "arrayFilters") {
        value = "[\n  { ${1} }\n]";
      } else if (
        [
          "collation",
          "hint",
          "let",
          "partialFilterExpression",
          "projection",
          "sort",
          "weights",
          "wildcardProjection",
          "writeConcern",
        ].includes(key)
      ) {
        value = "{ ${1} }";
      } else {
        value = '"${1}"';
      }
      return {
        label: key,
        detail: `${method || "MongoDB"} option`,
        insertText: `${key}: ${value}`,
        kind: "property" as const,
      };
    });
}

export function fieldReferenceItems(
  fields: readonly { name: string; dataType?: string }[],
  typed: string,
): MongoDbConsoleCompletion[] {
  const normalizedTyped = typed.startsWith("$") ? typed.slice(1) : typed;
  return fields
    .filter((field) => matches(field.name, normalizedTyped))
    .map((field) => ({
      label: `$${field.name}`,
      detail: field.dataType
        ? `MongoDB field reference · ${field.dataType}`
        : "MongoDB field reference",
      insertText: `$${field.name}`,
      kind: "field" as const,
    }));
}

export function stageOptionItems(
  stage: string | undefined,
  typed: string,
): MongoDbConsoleCompletion[] {
  return (STAGE_OPTION_KEYS[stage || ""] || [])
    .filter((key) => matches(key, typed))
    .map((key) => ({
      label: key,
      detail: `${stage} option`,
      insertText: stageOptionInsertText(key),
      kind: "property" as const,
    }));
}

function stageOptionInsertText(key: string) {
  if (["from", "into", "coll"].includes(key)) {
    return `"${key}": "\${1:collection}"`;
  }
  if (STAGE_FIELD_VALUE_KEYS.has(key)) {
    return `"${key}": "\${1:field}"`;
  }
  if (key === "pipeline") return `"pipeline": [\n  \${1}\n]`;
  if (key === "let") return `"let": {\n  "\${1:name}": "\${2:$field}"\n}`;
  if (key === "startWith") return `"startWith": "\${1:$field}"`;
  if (key === "as" || key === "depthField") return `"${key}": "\${1:field}"`;
  if (key === "maxDepth") return `"maxDepth": \${1:0}`;
  if (key === "restrictSearchWithMatch")
    return `"restrictSearchWithMatch": { \${1} }`;
  if (key === "includeArrayIndex") return `"includeArrayIndex": "\${1:index}"`;
  if (key === "preserveNullAndEmptyArrays")
    return `"preserveNullAndEmptyArrays": true`;
  if (key === "boundaries") return `"boundaries": [\${1}]`;
  if (key === "default") return `"default": "\${1:other}"`;
  if (key === "output") return `"output": { \${1} }`;
  if (key === "buckets") return `"buckets": \${1:5}`;
  if (key === "granularity") return `"granularity": "\${1:R20}"`;
  if (key === "size") return `"size": \${1:10}`;
  if (key === "sortBy") return `"sortBy": { "\${1:field}": 1 }`;
  if (key === "near")
    return `"near": { "type": "Point", "coordinates": [0, 0] }`;
  if (key === "distanceField" || key === "includeLocs")
    return `"${key}": "\${1:field}"`;
  if (key === "maxDistance") return `"maxDistance": \${1:1000}`;
  if (key === "minDistance") return `"minDistance": \${1:0}`;
  if (key === "query") return `"query": { \${1} }`;
  if (key === "spherical") return `"spherical": true`;
  if (key === "whenMatched") return `"whenMatched": "\${1:merge}"`;
  if (key === "whenNotMatched") return `"whenNotMatched": "\${1:insert}"`;
  return `"${key}": \${1}`;
}
