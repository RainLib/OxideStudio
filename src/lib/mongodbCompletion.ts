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
  | "push-modifier"
  | "pipeline-stage"
  | "accumulator"
  | "expression"
  | "field-reference"
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
  /** True when the cursor is inside a JSON string value. */
  quoted?: boolean;
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
  "$out",
  "$merge",
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
  "restrictSearchWithMatch",
]);
const UPDATE_OBJECT_KEYS = new Set(["update"]);
const UPDATE_OPERATOR_KEYS = new Set([
  "$set",
  "$unset",
  "$setOnInsert",
  "$inc",
  "$mul",
  "$min",
  "$max",
  "$rename",
  "$currentDate",
  "$push",
  "$addToSet",
  "$pop",
  "$pull",
  "$pullAll",
  "$bit",
]);
const PUSH_OPERATOR_KEYS = new Set(["$push", "$addToSet"]);
const QUERY_DOCUMENT_KEYS = new Set([
  "filter",
  "query",
  "$match",
  "restrictSearchWithMatch",
  "$and",
  "$or",
  "$nor",
  "$elemMatch",
]);
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
  $unwind: ["path", "includeArrayIndex", "preserveNullAndEmptyArrays"],
  $bucket: ["groupBy", "boundaries", "default", "output"],
  $bucketAuto: ["groupBy", "buckets", "output", "granularity"],
  $sample: ["size"],
  $setWindowFields: ["partitionBy", "sortBy", "output"],
  $geoNear: [
    "near",
    "distanceField",
    "maxDistance",
    "minDistance",
    "query",
    "spherical",
    "key",
    "includeLocs",
  ],
  $replaceRoot: ["newRoot"],
};

/** Keep semantic completion kinds while still enabling Monaco tab stops. */
export function mongodbCompletionUsesSnippetSyntax(
  item: Pick<MongoDbConsoleCompletion, "insertText" | "kind">,
) {
  return item.kind === "snippet" || /\$\{\d+(?::[^}]*)?\}/u.test(item.insertText);
}
const STAGE_FIELD_VALUE_KEYS = new Set([
  "localField",
  "foreignField",
  "connectFromField",
  "connectToField",
  "on",
  "key",
]);
const STAGE_FIELD_REFERENCE_VALUE_KEYS = new Set([
  "path",
  "startWith",
  "groupBy",
  "partitionBy",
  "newRoot",
]);
const QUERY_OPERATORS = [
  "$eq", "$ne", "$gt", "$gte", "$lt", "$lte", "$in", "$nin",
  "$and", "$or", "$nor", "$not", "$exists", "$type", "$regex",
  "$text", "$expr", "$jsonSchema", "$mod", "$where", "$all",
  "$elemMatch", "$size", "$bitsAllSet", "$bitsAnySet", "$bitsAllClear",
  "$bitsAnyClear", "$geoWithin", "$geoIntersects", "$near", "$nearSphere",
];
const UPDATE_OPERATORS = [
  "$set", "$unset", "$setOnInsert", "$inc", "$mul", "$min", "$max",
  "$rename", "$currentDate", "$push", "$addToSet", "$pop", "$pull",
  "$pullAll", "$bit",
];
const PUSH_MODIFIERS = ["$each", "$slice", "$sort", "$position"];
const PIPELINE_STAGES = ["$match", "$project", "$group", "$sort", "$limit", "$skip", "$count", "$unwind", "$lookup", "$addFields", "$set", "$unset", "$replaceRoot", "$replaceWith", "$facet", "$sortByCount", "$bucket", "$bucketAuto", "$sample", "$unionWith", "$graphLookup", "$geoNear", "$setWindowFields", "$densify", "$fill", "$documents", "$redact", "$out", "$merge", "$collStats", "$indexStats", "$planCacheStats"];
const ACCUMULATORS = ["$sum", "$avg", "$min", "$max", "$count", "$first", "$last", "$push", "$addToSet", "$mergeObjects", "$stdDevPop", "$stdDevSamp", "$top", "$topN", "$bottom", "$bottomN", "$firstN", "$lastN", "$maxN", "$minN", "$median", "$percentile"];
const EXPRESSION_OPERATORS = [
  "$cond", "$ifNull", "$switch", "$eq", "$ne", "$gt", "$gte", "$lt",
  "$lte", "$cmp", "$and", "$or", "$not", "$add", "$subtract",
  "$multiply", "$divide", "$mod", "$abs", "$ceil", "$floor", "$round",
  "$trunc", "$pow", "$sqrt", "$ln", "$log", "$log10", "$exp", "$concat",
  "$split", "$substr", "$substrBytes", "$substrCP", "$strLenCP",
  "$strLenBytes", "$strcasecmp", "$toLower", "$toUpper", "$trim", "$ltrim",
  "$rtrim", "$replaceOne", "$replaceAll", "$regexMatch", "$regexFind",
  "$regexFindAll", "$indexOfCP", "$indexOfBytes", "$size", "$arrayElemAt",
  "$first", "$last", "$slice", "$in", "$indexOfArray", "$concatArrays",
  "$filter", "$map", "$reduce", "$reverseArray", "$sortArray", "$range",
  "$zip", "$isArray", "$arrayToObject", "$objectToArray", "$setUnion",
  "$setIntersection", "$setDifference", "$setEquals", "$setIsSubset",
  "$allElementsTrue", "$anyElementTrue", "$dateToString", "$dateFromString",
  "$dateToParts", "$dateFromParts", "$dateAdd", "$dateSubtract", "$dateDiff",
  "$dateTrunc", "$year", "$month", "$dayOfMonth", "$dayOfWeek", "$dayOfYear",
  "$week", "$hour", "$minute", "$second", "$millisecond", "$isoWeek",
  "$isoWeekYear", "$isoDayOfWeek", "$type", "$convert", "$toString", "$toInt",
  "$toLong", "$toDouble", "$toDecimal", "$toBool", "$toDate", "$toObjectId",
  "$isNumber", "$literal", "$mergeObjects", "$getField", "$setField", "$let",
  "$rand",
];
const EXPRESSION_STAGES = new Set(["$project", "$set", "$addFields", "$replaceRoot", "$replaceWith", "$redact", "$setWindowFields", "$fill"]);

const OPERATOR_VALUE_TEMPLATES: Record<string, string> = {
  $in: "[${1}]",
  $nin: "[${1}]",
  $and: "[\n  { ${1} }\n]",
  $or: "[\n  { ${1} }\n]",
  $nor: "[\n  { ${1} }\n]",
  $not: "{ ${1} }",
  $exists: "true",
  $regex: '"${1:pattern}"',
  $text: '{ "$search": "${1:text}" }',
  $expr: "{ ${1} }",
  $jsonSchema: "{ ${1} }",
  $mod: "[${1:divisor}, ${2:remainder}]",
  $all: "[${1}]",
  $elemMatch: "{ ${1} }",
  $set: "{ ${1} }",
  $unset: '{ "${1:field}": "" }',
  $setOnInsert: "{ ${1} }",
  $inc: '{ "${1:field}": 1 }',
  $mul: '{ "${1:field}": 2 }',
  $rename: '{ "${1:field}": "${2:newName}" }',
  $currentDate: '{ "${1:field}": true }',
  $push: '{ "${1:field}": ${2} }',
  $addToSet: '{ "${1:field}": ${2} }',
  $pull: '{ "${1:field}": ${2} }',
  $pullAll: '{ "${1:field}": [${2}] }',
  $each: "[${1}]",
  $slice: "${1:10}",
  $sort: '{ "${1:field}": 1 }',
  $position: "${1:0}",
  $match: "{ ${1} }",
  $project: "{ ${1} }",
  $group: '{ "_id": "$${1:field}", "count": { "$sum": 1 } }',
  $limit: "${1:100}",
  $skip: "${1:0}",
  $count: '"${1:total}"',
  $unwind: '"$${1:field}"',
  $lookup: '{ "from": "${1:collection}", "localField": "${2:field}", "foreignField": "_id", "as": "${3:joined}" }',
  $sample: '{ "size": ${1:10} }',
  $out: '"${1:collection}"',
  $merge: '{ "into": "${1:collection}" }',
  $sum: "${1:1}",
  $avg: '"$${1:field}"',
  $cond: '{ "if": ${1}, "then": ${2}, "else": ${3} }',
  $ifNull: "[${1}, ${2}]",
};

const VALUE_COMPLETIONS: MongoDbConsoleCompletion[] = [
  { label: "ObjectId", detail: "Extended JSON ObjectId", insertText: '{ "$oid": "${1:000000000000000000000000}" }', kind: "snippet" },
  { label: "Date", detail: "Extended JSON date", insertText: '{ "$date": "${1:2026-01-01T00:00:00Z}" }', kind: "snippet" },
  { label: "NumberLong", detail: "Extended JSON signed 64-bit integer", insertText: '{ "$numberLong": "${1:0}" }', kind: "snippet" },
  { label: "Decimal128", detail: "Extended JSON decimal", insertText: '{ "$numberDecimal": "${1:0}" }', kind: "snippet" },
  { label: "null", detail: "JSON null", insertText: "null", kind: "value" },
  { label: "true", detail: "JSON boolean", insertText: "true", kind: "value" },
  { label: "false", detail: "JSON boolean", insertText: "false", kind: "value" },
];

const MAX_MONGODB_COMPLETION_ITEMS = 256;

const ROOT_COMMANDS: MongoDbConsoleCompletion[] = [
  { label: "find", detail: "Find documents in a collection", documentation: 'Runs `{ "find": "collection", "filter": {} }`.', insertText: '"find": "${1:collection}",\n  "filter": {${2}}', kind: "snippet" },
  { label: "aggregate", detail: "Aggregate collection documents", documentation: 'Runs `{ "aggregate": "collection", "pipeline": [] }`.', insertText: '"aggregate": "${1:collection}",\n  "pipeline": [\n    ${2}\n  ]', kind: "snippet" },
  { label: "count", detail: "Count documents in a collection", documentation: 'Runs `{ "count": "collection", "query": {} }`.', insertText: '"count": "${1:collection}",\n  "query": {${2}}', kind: "snippet" },
  { label: "findOne", detail: "Find the first matching document", documentation: "Uses the native find contract with a Host-bounded limit of one.", insertText: '"find": "${1:collection}",\n  "filter": {${2}},\n  "limit": 1', kind: "snippet" },
  { label: "distinct", detail: "List distinct values for a field", documentation: "Runs the native MongoDB distinct command.", insertText: '"command": {\n    "distinct": "${1:collection}",\n    "key": "${2:field}",\n    "query": {${3}}\n  }', kind: "snippet" },
  { label: "listIndexes", detail: "List collection indexes", documentation: "Runs the native MongoDB listIndexes command.", insertText: '"command": {\n    "listIndexes": "${1:collection}"\n  }', kind: "snippet" },
  { label: "collStats", detail: "Read collection statistics", documentation: "Runs the native MongoDB collStats command.", insertText: '"command": {\n    "collStats": "${1:collection}"\n  }', kind: "snippet" },
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
  const typed = scan.inString
    ? scan.before.slice(scan.stringStart + 1)
    : scan.before.match(/[A-Za-z0-9_$.-]+$/u)?.[0] || "";
  const activeKey = frame?.lastKey;
  const ownerKey = frame?.ownerKey;
  const ownerKeys = scan.frames
    .map((candidate) => candidate.ownerKey)
    .filter((candidate): candidate is string => Boolean(candidate));
  const enclosingStage = [...ownerKeys]
    .reverse()
    .find((candidate) => PIPELINE_STAGES.includes(candidate));
  const withinQueryDocument = ownerKeys.some((candidate) =>
    QUERY_DOCUMENT_KEYS.has(candidate),
  );
  const withinUpdateDocument = ownerKeys.some(
    (candidate) =>
      UPDATE_OBJECT_KEYS.has(candidate) || UPDATE_OPERATOR_KEYS.has(candidate),
  );
  const withinPushDocument = ownerKeys.some((candidate) =>
    PUSH_OPERATOR_KEYS.has(candidate),
  );
  const isKeyPosition = Boolean(frame?.kind === "object" && frame.expectingKey);

  if (isKeyPosition) {
    if (ownerKey === "pipeline") return { area: "pipeline-stage", typed, activeKey, parentKey: ownerKey, collection };
    if (ownerKey && STAGE_OPTION_KEYS[ownerKey]) {
      return { area: "stage-option", typed, activeKey, parentKey: ownerKey, collection };
    }
    if (enclosingStage === "$group" && ownerKey !== "$group") {
      return { area: "accumulator", typed, activeKey, parentKey: enclosingStage, collection };
    }
    if (enclosingStage && EXPRESSION_STAGES.has(enclosingStage) && ownerKey !== enclosingStage) {
      return { area: "expression", typed, activeKey, parentKey: enclosingStage, collection };
    }
    if (ownerKey === "$expr" || ownerKeys.includes("$expr")) {
      return { area: "expression", typed, activeKey, parentKey: ownerKey, collection };
    }
    if (UPDATE_OBJECT_KEYS.has(ownerKey || "")) return { area: "update-operator", typed, activeKey, parentKey: ownerKey, collection };
    if (
      withinPushDocument &&
      ownerKey !== "$push" &&
      ownerKey !== "$addToSet"
    ) {
      return { area: "push-modifier", typed, activeKey, parentKey: ownerKey, collection };
    }
    if (withinUpdateDocument && UPDATE_OPERATOR_KEYS.has(ownerKey || "")) {
      return { area: "field", typed, activeKey, parentKey: ownerKey, collection };
    }
    if (FIELD_OBJECT_KEYS.has(ownerKey || "")) {
      return typed.startsWith("$")
        ? { area: "query-operator", typed, activeKey, parentKey: ownerKey, collection }
        : { area: "field", typed, activeKey, parentKey: ownerKey, collection };
    }
    if (withinQueryDocument) {
      const ownerIsFieldPredicate = Boolean(
        ownerKey &&
          !QUERY_DOCUMENT_KEYS.has(ownerKey) &&
          !ownerKey.startsWith("$"),
      );
      return ownerIsFieldPredicate || typed.startsWith("$")
        ? { area: "query-operator", typed, activeKey, parentKey: ownerKey, collection }
        : { area: "field", typed, activeKey, parentKey: ownerKey, collection };
    }
    if (
      ownerKey === "insertOne" ||
      ownerKey === "insertMany" ||
      ownerKey === "replacement"
    ) {
      return { area: "field", typed, activeKey, parentKey: ownerKey, collection };
    }
    if (!ownerKey && scan.frames.length <= 1) return { area: "root", typed, activeKey, collection };
    return { area: "key", typed, activeKey, parentKey: ownerKey, collection };
  }
  if (scan.inString && COLLECTION_VALUE_KEYS.has(activeKey || "")) {
    return { area: "collection", typed, activeKey, parentKey: ownerKey, collection };
  }
  if (
    scan.inString &&
    (["field"].includes(activeKey || "") ||
      (Boolean(ownerKey && STAGE_OPTION_KEYS[ownerKey]) &&
        STAGE_FIELD_VALUE_KEYS.has(activeKey || "")))
  ) {
    return { area: "field", typed, activeKey, parentKey: ownerKey, collection };
  }
  if (
    scan.inString &&
    (STAGE_FIELD_REFERENCE_VALUE_KEYS.has(activeKey || "") ||
      typed.startsWith("$") && Boolean(enclosingStage))
  ) {
    return { area: "field-reference", typed, activeKey, parentKey: ownerKey, collection };
  }
  if (scan.inString && typed.startsWith("$") && (enclosingStage || activeKey === "$expr")) {
    return { area: "field-reference", typed, activeKey, parentKey: enclosingStage, collection };
  }
  return { area: "value", typed, activeKey, parentKey: ownerKey, collection, quoted: scan.inString };
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
    insertText: `"${value}": ${
      detail.includes("accumulator") && value === "$count"
        ? "{}"
        : OPERATOR_VALUE_TEMPLATES[value] || "${1}"
    }`,
    kind: "operator",
  }));
}

function fieldReferenceItems(
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
  if (key === "includeArrayIndex") return `"includeArrayIndex": "\${1:index}"`;
  if (key === "preserveNullAndEmptyArrays") return `"preserveNullAndEmptyArrays": true`;
  if (key === "boundaries") return `"boundaries": [\${1}]`;
  if (key === "default") return `"default": "\${1:other}"`;
  if (key === "output") return `"output": { \${1} }`;
  if (key === "buckets") return `"buckets": \${1:5}`;
  if (key === "granularity") return `"granularity": "\${1:R20}"`;
  if (key === "size") return `"size": \${1:10}`;
  if (key === "sortBy") return `"sortBy": { "\${1:field}": 1 }`;
  if (key === "near") return `"near": { "type": "Point", "coordinates": [0, 0] }`;
  if (key === "distanceField" || key === "includeLocs") return `"${key}": "\${1:field}"`;
  if (key === "maxDistance") return `"maxDistance": \${1:1000}`;
  if (key === "minDistance") return `"minDistance": \${1:0}`;
  if (key === "query") return `"query": { \${1} }`;
  if (key === "spherical") return `"spherical": true`;
  if (key === "whenMatched") return `"whenMatched": "\${1:merge}"`;
  if (key === "whenNotMatched") return `"whenNotMatched": "\${1:insert}"`;
  return `"${key}": \${1}`;
}

export function buildMongoDbConsoleCompletions(source: string, cursorOffset: number, input: MongoDbCompletionInput = {}) {
  const context = mongodbConsoleCompletionContext(source, cursorOffset);
  const typedForMetadata = context.typed.replace(/^\$/u, "").toLocaleLowerCase();
  const collections = [...new Set(input.collections || [])]
    .filter((name) => !typedForMetadata || name.toLocaleLowerCase().startsWith(typedForMetadata))
    .sort((left, right) => left.localeCompare(right));
  const fields = [...new Map((input.fields || [])
    .filter((field) => !typedForMetadata || field.name.toLocaleLowerCase().startsWith(typedForMetadata))
    .map((field) => [field.name.toLocaleLowerCase(), field])).values()]
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
    case "push-modifier":
      items = operatorItems(PUSH_MODIFIERS, context.typed, "MongoDB array update modifier");
      break;
    case "pipeline-stage":
      items = operatorItems(PIPELINE_STAGES, context.typed, "MongoDB aggregation stage");
      break;
    case "accumulator":
      items = operatorItems(ACCUMULATORS, context.typed, "MongoDB group accumulator");
      break;
    case "expression":
      items = operatorItems(EXPRESSION_OPERATORS, context.typed, "MongoDB aggregation expression");
      break;
    case "field-reference":
      items = fieldReferenceItems(fields, context.typed);
      break;
    case "stage-option":
      items = stageOptionItems(context.parentKey, context.typed);
      break;
    case "value":
      items = context.quoted
        ? []
        : VALUE_COMPLETIONS.filter((item) => matches(item.label, context.typed));
      break;
    case "key":
      items = propertyItems(COMMAND_OPTIONS[context.parentKey || ""] || ["filter", "projection", "sort", "limit", "skip", "database"], context.typed, "MongoDB command option");
      break;
    default:
      items = [];
  }
  return { context, items: items.slice(0, MAX_MONGODB_COMPLETION_ITEMS) };
}

/** Compatibility shape used by the auto-suggest lifecycle. */
export function mongodbCompletionArea(source: string, cursorOffset: number): MongoDbCompletionArea | "unknown" {
  const area = mongodbConsoleCompletionContext(source, cursorOffset).area;
  if (area === "root") return "key";
  if (
    area === "field" ||
    area === "query-operator" ||
    area === "update-operator" ||
    area === "push-modifier" ||
    area === "pipeline-stage" ||
    area === "accumulator" ||
    area === "expression"
  ) {
    return "key";
  }
  return area;
}

export function shouldOfferMongoDbCompletions(source: string, cursorOffset: number) {
  const context = mongodbConsoleCompletionContext(source, cursorOffset);
  if (context.area === "unknown") return false;
  if (context.area !== "value") return true;
  return (
    !context.quoted &&
    (!context.typed ||
      VALUE_COMPLETIONS.some((item) => matches(item.label, context.typed)))
  );
}

const MONGODB_AUTOMATIC_TRIGGER = /[A-Za-z0-9_$.-]/u;

export function shouldTriggerMongoDbCompletions(source: string, cursorOffset: number, insertedText: string) {
  const lastCharacter = insertedText[insertedText.length - 1];
  return Boolean(lastCharacter && (lastCharacter === '"' || lastCharacter === "{" || lastCharacter === "[" || lastCharacter === "," || lastCharacter === ":" || MONGODB_AUTOMATIC_TRIGGER.test(lastCharacter)) && shouldOfferMongoDbCompletions(source, cursorOffset));
}
