/**
 * MongoDB's native query runner accepts JSON command documents, not shell
 * expressions. Keep completion on that contract so every template is directly
 * executable by `src-tauri/src/drivers/mongodb.rs`.
 */
export type MongoDbCompletionArea =
  | "root"
  | "key"
  | "collection"
  | "field"
  | "stage-option"
  | "query-operator"
  | "update-operator"
  | "pipeline-stage"
  | "value"
  | "unknown";

export type MongoDbConsoleCompletion = {
  label: string;
  detail: string;
  documentation?: string;
  insertText: string;
  kind: "property" | "field" | "operator" | "snippet" | "value";
  sortText?: string;
};

export type MongoDbCompletionContext = {
  area: MongoDbCompletionArea;
  typed: string;
  activeKey?: string;
  parentKey?: string;
  collection?: string;
};

export type MongoDbCompletionInput = {
  collections?: readonly string[];
  fields?: readonly { name: string; dataType?: string }[];
};

type JsonFrame = {
  kind: "object" | "array";
  ownerKey?: string;
  lastKey?: string;
  expectingKey: boolean;
};

const COLLECTION_VALUE_KEYS = new Set([
  "collection",
  "find",
  "aggregate",
  "count",
  "from",
  "into",
  "coll",
]);
const FIELD_OBJECT_KEYS = new Set([
  "filter",
  "projection",
  "sort",
  "query",
  "$match",
  "$project",
  "$set",
  "$addFields",
  "$unset",
  "$inc",
  "$mul",
  "$min",
  "$max",
  "$rename",
  "$push",
  "$addToSet",
  "$pull",
]);
const UPDATE_OBJECT_KEYS = new Set(["update"]);
const STAGE_OPTION_KEYS: Record<string, readonly string[]> = {
  $lookup: ["from", "localField", "foreignField", "as", "let", "pipeline"],
  $graphLookup: [
    "from",
    "startWith",
    "connectFromField",
    "connectToField",
    "as",
    "maxDepth",
    "depthField",
    "restrictSearchWithMatch",
  ],
  $merge: ["into", "on", "let", "whenMatched", "whenNotMatched"],
  $unionWith: ["coll", "pipeline"],
};
const STAGE_FIELD_VALUE_KEYS = new Set([
  "localField",
  "foreignField",
  "connectFromField",
  "connectToField",
  "on",
]);
const QUERY_OPERATORS = ["$eq", "$ne", "$gt", "$gte", "$lt", "$lte", "$in", "$nin", "$exists", "$regex", "$and", "$or", "$nor", "$not", "$elemMatch", "$size", "$all", "$type"];
const UPDATE_OPERATORS = ["$set", "$unset", "$inc", "$mul", "$min", "$max", "$rename", "$currentDate", "$push", "$addToSet", "$pull", "$pop"];
const PIPELINE_STAGES = ["$match", "$project", "$set", "$addFields", "$unset", "$group", "$sort", "$limit", "$skip", "$unwind", "$lookup", "$facet", "$count", "$replaceRoot"];

const ROOT_COMMANDS: MongoDbConsoleCompletion[] = [
  { label: "find", detail: "Find documents in a collection", documentation: 'Runs `{ "find": "collection", "filter": {} }`.', insertText: '"find": "${1:collection}",\n  "filter": {${2}}', kind: "snippet" },
  { label: "aggregate", detail: "Aggregate collection documents", documentation: 'Runs `{ "aggregate": "collection", "pipeline": [] }`.', insertText: '"aggregate": "${1:collection}",\n  "pipeline": [\n    ${2}\n  ]', kind: "snippet" },
  { label: "count", detail: "Count documents in a collection", documentation: 'Runs `{ "count": "collection", "query": {} }`.', insertText: '"count": "${1:collection}",\n  "query": {${2}}', kind: "snippet" },
  { label: "insertOne", detail: "Insert one document", insertText: '"collection": "${1:collection}",\n  "insertOne": {\n    ${2}\n  }', kind: "snippet" },
  { label: "insertMany", detail: "Insert multiple documents", insertText: '"collection": "${1:collection}",\n  "insertMany": [\n    {${2}}\n  ]', kind: "snippet" },
  { label: "updateOne", detail: "Update the first matching document", insertText: '"collection": "${1:collection}",\n  "updateOne": {\n    "filter": {${2}},\n    "update": {\n      "$set": {${3}}\n    }\n  }', kind: "snippet" },
  { label: "updateMany", detail: "Update all matching documents", insertText: '"collection": "${1:collection}",\n  "updateMany": {\n    "filter": {${2}},\n    "update": {\n      "$set": {${3}}\n    }\n  }', kind: "snippet" },
  { label: "deleteOne", detail: "Delete the first matching document", insertText: '"collection": "${1:collection}",\n  "deleteOne": {${2}}', kind: "snippet" },
  { label: "deleteMany", detail: "Delete all matching documents", insertText: '"collection": "${1:collection}",\n  "deleteMany": {${2}}', kind: "snippet" },
  { label: "command", detail: "Run a native MongoDB command document", insertText: '"command": {${1}}', kind: "snippet" },
];

const COMMAND_OPTIONS: Record<string, string[]> = {
  find: ["collection", "find", "filter", "projection", "sort", "limit", "skip", "database"],
  aggregate: ["collection", "aggregate", "pipeline", "database"],
  count: ["collection", "count", "query", "database"],
  insertOne: ["collection", "insertOne", "database"],
  insertMany: ["collection", "insertMany", "database"],
  updateOne: ["collection", "updateOne", "database"],
  updateMany: ["collection", "updateMany", "database"],
  deleteOne: ["collection", "deleteOne", "database"],
  deleteMany: ["collection", "deleteMany", "database"],
};

function clampOffset(source: string, offset: number) {
  return Math.max(0, Math.min(source.length, offset));
}

/** Tolerant scanner that remains useful while a JSON command is incomplete. */
function scanJsonBeforeCursor(source: string, offset: number) {
  const before = source.slice(0, clampOffset(source, offset));
  const frames: JsonFrame[] = [];
  let inString = false;
  let stringStart = -1;
  let escaping = false;
  let pendingString: string | undefined;

  for (let index = 0; index < before.length; index += 1) {
    const character = before[index]!;
    if (inString) {
      if (escaping) escaping = false;
      else if (character === "\\") escaping = true;
      else if (character === '"') {
        inString = false;
        pendingString = before.slice(stringStart + 1, index).replace(/\\"/gu, '"');
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      stringStart = index;
      escaping = false;
      continue;
    }
    if (/\s/u.test(character)) continue;
    if (character === ":") {
      const frame = frames[frames.length - 1];
      if (frame?.kind === "object" && pendingString !== undefined) {
        frame.lastKey = pendingString;
        frame.expectingKey = false;
      }
      pendingString = undefined;
    } else if (character === "{") {
      const parent = frames[frames.length - 1];
      frames.push({
        kind: "object",
        ownerKey:
          parent?.kind === "array" ? parent.ownerKey : parent?.lastKey,
        expectingKey: true,
      });
      pendingString = undefined;
    } else if (character === "[") {
      const parent = frames[frames.length - 1];
      frames.push({ kind: "array", ownerKey: parent?.lastKey, expectingKey: false });
      pendingString = undefined;
    } else if (character === "}" || character === "]") {
      frames.pop();
      pendingString = undefined;
    } else if (character === ",") {
      const frame = frames[frames.length - 1];
      if (frame?.kind === "object") frame.expectingKey = true;
      pendingString = undefined;
    }
  }
  return { before, frames, inString, stringStart };
}

function activeCollection(source: string, offset: number) {
  const before = source.slice(0, clampOffset(source, offset));
  const matches = [...before.matchAll(/"(?:collection|find|aggregate|count)"\s*:\s*"([^"\\]*)/gu)];
  return matches[matches.length - 1]?.[1]?.trim() || undefined;
}

export function mongodbConsoleCompletionContext(source: string, cursorOffset: number): MongoDbCompletionContext {
  const scan = scanJsonBeforeCursor(source, cursorOffset);
  const frame = scan.frames[scan.frames.length - 1];
  const collection = activeCollection(source, cursorOffset);
  const typed = scan.inString ? scan.before.slice(scan.stringStart + 1) : "";
  const activeKey = frame?.lastKey;
  const ownerKey = frame?.ownerKey;
  const isKeyPosition = Boolean(frame?.kind === "object" && frame.expectingKey);

  if (isKeyPosition) {
    if (ownerKey === "pipeline") return { area: "pipeline-stage", typed, activeKey, parentKey: ownerKey, collection };
    if (ownerKey && STAGE_OPTION_KEYS[ownerKey]) {
      return { area: "stage-option", typed, activeKey, parentKey: ownerKey, collection };
    }
    if (UPDATE_OBJECT_KEYS.has(ownerKey || "")) return { area: "update-operator", typed, activeKey, parentKey: ownerKey, collection };
    if (FIELD_OBJECT_KEYS.has(ownerKey || "")) {
      return typed.startsWith("$")
        ? { area: "query-operator", typed, activeKey, parentKey: ownerKey, collection }
        : { area: "field", typed, activeKey, parentKey: ownerKey, collection };
    }
    if (!ownerKey && scan.frames.length <= 1) return { area: "root", typed, activeKey, collection };
    return { area: "key", typed, activeKey, parentKey: ownerKey, collection };
  }
  if (scan.inString && COLLECTION_VALUE_KEYS.has(activeKey || "")) {
    return { area: "collection", typed, activeKey, parentKey: ownerKey, collection };
  }
  if (
    scan.inString &&
    (["field", "path"].includes(activeKey || "") ||
      (Boolean(ownerKey && STAGE_OPTION_KEYS[ownerKey]) &&
        STAGE_FIELD_VALUE_KEYS.has(activeKey || "")))
  ) {
    return { area: "field", typed, activeKey, parentKey: ownerKey, collection };
  }
  return { area: "value", typed, activeKey, parentKey: ownerKey, collection };
}

function matches(value: string, typed: string) {
  return !typed || value.toLocaleLowerCase().startsWith(typed.toLocaleLowerCase());
}

function propertyItems(keys: readonly string[], typed: string, detail: string): MongoDbConsoleCompletion[] {
  return keys.filter((key) => matches(key, typed)).map((key) => ({
    label: key,
    detail,
    insertText: `"${key}": ${key === "limit" || key === "skip" ? "${1:0}" : "${1}"}`,
    kind: "property",
  }));
}

function operatorItems(values: readonly string[], typed: string, detail: string): MongoDbConsoleCompletion[] {
  return values.filter((value) => matches(value, typed)).map((value) => ({
    label: value,
    detail,
    insertText: `"${value}": ${value === "$exists" ? "${1:true}" : "${1}"}`,
    kind: "operator",
  }));
}

function stageOptionItems(stage: string | undefined, typed: string): MongoDbConsoleCompletion[] {
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
  if (key === "restrictSearchWithMatch") return `"restrictSearchWithMatch": { \${1} }`;
  if (key === "whenMatched") return `"whenMatched": "\${1:merge}"`;
  if (key === "whenNotMatched") return `"whenNotMatched": "\${1:insert}"`;
  return `"${key}": \${1}`;
}

export function buildMongoDbConsoleCompletions(source: string, cursorOffset: number, input: MongoDbCompletionInput = {}) {
  const context = mongodbConsoleCompletionContext(source, cursorOffset);
  const collections = [...new Set(input.collections || [])].sort((left, right) => left.localeCompare(right));
  const fields = [...new Map((input.fields || []).map((field) => [field.name.toLocaleLowerCase(), field])).values()]
    .sort((left, right) => left.name.localeCompare(right.name));
  let items: MongoDbConsoleCompletion[];
  switch (context.area) {
    case "root":
      items = ROOT_COMMANDS.filter((item) => matches(item.label, context.typed));
      break;
    case "collection":
      items = collections.filter((name) => matches(name, context.typed)).map((name) => ({ label: name, detail: "MongoDB collection", insertText: name, kind: "value" }));
      break;
    case "field":
      items = fields.filter((field) => matches(field.name, context.typed)).map((field) => ({ label: field.name, detail: field.dataType || "MongoDB field", insertText: field.name, kind: "field" }));
      break;
    case "query-operator":
      items = operatorItems(QUERY_OPERATORS, context.typed, "MongoDB query operator");
      break;
    case "update-operator":
      items = operatorItems(UPDATE_OPERATORS, context.typed, "MongoDB update operator");
      break;
    case "pipeline-stage":
      items = operatorItems(PIPELINE_STAGES, context.typed, "MongoDB aggregation stage");
      break;
    case "stage-option":
      items = stageOptionItems(context.parentKey, context.typed);
      break;
    case "key":
      items = propertyItems(COMMAND_OPTIONS[context.parentKey || ""] || ["filter", "projection", "sort", "limit", "skip", "database"], context.typed, "MongoDB command option");
      break;
    default:
      items = [];
  }
  return { context, items };
}

/** Compatibility shape used by the auto-suggest lifecycle. */
export function mongodbCompletionArea(source: string, cursorOffset: number): MongoDbCompletionArea | "unknown" {
  const area = mongodbConsoleCompletionContext(source, cursorOffset).area;
  if (area === "root") return "key";
  if (
    area === "field" ||
    area === "query-operator" ||
    area === "update-operator" ||
    area === "pipeline-stage"
  ) {
    return "key";
  }
  return area;
}

export function shouldOfferMongoDbCompletions(source: string, cursorOffset: number) {
  return !["unknown", "value"].includes(mongodbConsoleCompletionContext(source, cursorOffset).area);
}

const MONGODB_AUTOMATIC_TRIGGER = /[A-Za-z0-9_$.-]/u;

export function shouldTriggerMongoDbCompletions(source: string, cursorOffset: number, insertedText: string) {
  const lastCharacter = insertedText[insertedText.length - 1];
  return Boolean(lastCharacter && (lastCharacter === '"' || lastCharacter === "{" || lastCharacter === "[" || lastCharacter === "," || lastCharacter === ":" || MONGODB_AUTOMATIC_TRIGGER.test(lastCharacter)) && shouldOfferMongoDbCompletions(source, cursorOffset));
}
