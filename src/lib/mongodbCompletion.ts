/**
 * MongoDB completion supports both the native JSON contract and the bounded,
 * structurally parsed shell syntax in `src-tauri/src/drivers/mongodb_shell.rs`.
 * Never suggest a shell method that the Host cannot structurally parse.
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
  | "shell-root"
  | "shell-qualified"
  | "shell-method"
  | "shell-chain"
  | "shell-option"
  | "unknown";

export type MongoDbConsoleCompletion = {
  label: string;
  detail: string;
  documentation?: string;
  insertText: string;
  /** Text Monaco filters against when one completion replaces a qualified prefix. */
  filterText?: string;
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
  syntax?: "json" | "shell";
  /** Number of UTF-16 code units before the caret replaced by shell completion. */
  replacementLength?: number;
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

export const MONGODB_CONSOLE_LANGUAGE_ID = "mongodb-console";
export const MONGODB_COMPLETION_TRIGGER_CHARACTERS = Array.from(
  new Set(
    ` .({[,\"'$ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-`.split(
      "",
    ),
  ),
);

export function registerMongoDbConsoleLanguage(monaco: any) {
  const registrationKey = "__oxideMongoDbConsoleRegistration";
  if (monaco[registrationKey]) return;
  if (
    !monaco.languages
      .getLanguages()
      .some((language: { id: string }) => language.id === MONGODB_CONSOLE_LANGUAGE_ID)
  ) {
    monaco.languages.register({
      id: MONGODB_CONSOLE_LANGUAGE_ID,
      extensions: [".mongo", ".mongodb"],
      aliases: ["MongoDB Console", "MongoDB"],
    });
  }
  const disposables = [
    monaco.languages.setMonarchTokensProvider(MONGODB_CONSOLE_LANGUAGE_ID, {
      tokenizer: {
        root: [
          [/\/\*/, "comment", "@comment"],
          [/\/\/.*$/, "comment"],
          [/\b(db)(\.)(getCollection)\b/, ["variable.predefined", "delimiter", "keyword"]],
          [/\b(db)\b/, "variable.predefined"],
          [/\b(find|findOne|count|countDocuments|aggregate|distinct|getIndexes|stats|sort|skip|limit)\b(?=\s*\()/, "keyword"],
          [/\$(?:[A-Za-z][\w]*)/, "type.identifier"],
          [/[{}()[\]]/, "@brackets"],
          [/-?\d+(?:\.\d+)?/, "number"],
          [/"(?:[^"\\]|\\.)*"/, "string"],
          [/'(?:[^'\\]|\\.)*'/, "string"],
          [/\b(?:true|false|null)\b/, "constant"],
          [/[A-Za-z_][\w-]*(?=\s*:)/, "key"],
        ],
        comment: [
          [/[^/*]+/, "comment"],
          [/\*\//, "comment", "@pop"],
          [/[/*]/, "comment"],
        ],
      },
    }),
    monaco.languages.setLanguageConfiguration(MONGODB_CONSOLE_LANGUAGE_ID, {
      comments: { lineComment: "//", blockComment: ["/*", "*/"] },
      brackets: [
        ["{", "}"],
        ["[", "]"],
        ["(", ")"],
      ],
      autoClosingPairs: [
        { open: "{", close: "}" },
        { open: "[", close: "]" },
        { open: "(", close: ")" },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
      ],
    }),
  ];
  monaco[registrationKey] = disposables;
}

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

const MONGODB_SHELL_ROOT_COMPLETIONS: MongoDbConsoleCompletion[] = [
  {
    label: "db.collection.find",
    detail: "Find documents with a bounded result",
    documentation: "Read-only shell syntax parsed by OxideStudio; the default limit is 100.",
    insertText:
      "db.${1:collection}.find({\n  ${2}\n}).limit(${3:100})",
    kind: "snippet",
  },
  {
    label: "db.collection.aggregate",
    detail: "Run a read-only aggregation pipeline",
    insertText:
      'db.${1:collection}.aggregate([\n  { "$match": { ${2} } }\n])',
    kind: "snippet",
  },
  {
    label: "db.getCollection",
    detail: "Address a dotted or non-identifier collection name",
    insertText: 'db.getCollection("${1:collection.name}").find({ ${2} }).limit(${3:100})',
    kind: "snippet",
  },
  {
    label: "show databases",
    detail: "List databases visible to the current account",
    insertText: "show databases",
    kind: "snippet",
  },
];

const MONGODB_SHELL_DATABASE_COMPLETIONS: MongoDbConsoleCompletion[] = [
  {
    label: "getCollection",
    detail: "Reference a dotted or non-identifier collection name",
    insertText: 'getCollection("${1:collection.name}")',
    kind: "snippet",
  },
  {
    label: "version",
    detail: "Read the MongoDB server build information",
    insertText: "version()",
    kind: "snippet",
  },
];

const MONGODB_SHELL_METHOD_COMPLETIONS: MongoDbConsoleCompletion[] = [
  { label: "find", detail: "Find documents (default limit 100)", insertText: "find({ ${1} }).limit(${2:100})", kind: "snippet" },
  { label: "findOne", detail: "Find the first matching document", insertText: "findOne({ ${1} })", kind: "snippet" },
  { label: "countDocuments", detail: "Count matching documents", insertText: "countDocuments({ ${1} })", kind: "snippet" },
  { label: "count", detail: "Legacy count helper", insertText: "count({ ${1} })", kind: "snippet" },
  { label: "aggregate", detail: "Read-only aggregation pipeline", insertText: 'aggregate([\n  { "$match": { ${1} } }\n])', kind: "snippet" },
  { label: "distinct", detail: "Read distinct field values", insertText: 'distinct("${1:field}", { ${2} })', kind: "snippet" },
  { label: "getIndexes", detail: "List collection indexes", insertText: "getIndexes()", kind: "snippet" },
  { label: "stats", detail: "Read collection statistics", insertText: "stats()", kind: "snippet" },
  { label: "dataSize", detail: "Read total document size", insertText: "dataSize()", kind: "snippet" },
  { label: "storageSize", detail: "Read allocated collection storage", insertText: "storageSize()", kind: "snippet" },
  { label: "totalIndexSize", detail: "Read total index storage", insertText: "totalIndexSize()", kind: "snippet" },
  { label: "insertOne", detail: "Insert one document", insertText: "insertOne({ ${1} })", kind: "snippet" },
  { label: "insertMany", detail: "Insert multiple documents", insertText: "insertMany([\n  { ${1} }\n])", kind: "snippet" },
  { label: "updateOne", detail: "Update the first matching document", insertText: "updateOne({ ${1:filter} }, { $set: { ${2} } })", kind: "snippet" },
  { label: "updateMany", detail: "Update all matching documents", insertText: "updateMany({ ${1:filter} }, { $set: { ${2} } })", kind: "snippet" },
  { label: "deleteOne", detail: "Delete the first matching document", insertText: "deleteOne({ ${1:filter} })", kind: "snippet" },
  { label: "deleteMany", detail: "Delete all matching documents", insertText: "deleteMany({ ${1:filter} })", kind: "snippet" },
  { label: "findOneAndUpdate", detail: "Atomically update and return a document", insertText: "findOneAndUpdate({ ${1:filter} }, { $set: { ${2} } }, { returnDocument: \"after\" })", kind: "snippet" },
  { label: "findOneAndReplace", detail: "Atomically replace and return a document", insertText: "findOneAndReplace({ ${1:filter} }, { ${2:replacement} })", kind: "snippet" },
  { label: "findOneAndDelete", detail: "Atomically delete and return a document", insertText: "findOneAndDelete({ ${1:filter} })", kind: "snippet" },
  { label: "createIndex", detail: "Create an index", insertText: "createIndex({ ${1:field}: ${2:1} })", kind: "snippet" },
  { label: "dropIndex", detail: "Drop one index", insertText: 'dropIndex("${1:indexName}")', kind: "snippet" },
  { label: "dropIndexes", detail: "Drop all non-_id indexes", insertText: "dropIndexes()", kind: "snippet" },
  { label: "drop", detail: "Drop the collection", insertText: "drop()", kind: "snippet" },
];

const MONGODB_SHELL_CHAIN_COMPLETIONS: MongoDbConsoleCompletion[] = [
  { label: "limit", detail: "Limit results to 1-10000 documents", insertText: "limit(${1:100})", kind: "snippet" },
  { label: "sort", detail: "Sort find results", insertText: "sort({ ${1:field}: ${2:1} })", kind: "snippet" },
  { label: "skip", detail: "Skip a non-negative number of results", insertText: "skip(${1:0})", kind: "snippet" },
];

const MONGODB_SHELL_COUNT_COMPLETION: MongoDbConsoleCompletion = {
  label: "count",
  detail: "Count documents matched by find()",
  insertText: "count()",
  kind: "snippet",
};

const MONGODB_SHELL_ARGUMENT_ROLES: Record<string, readonly string[]> = {
  find: ["filter", "projection", "options"],
  findOne: ["filter", "projection", "options"],
  count: ["filter", "options"],
  countDocuments: ["filter", "options"],
  aggregate: ["pipeline", "options"],
  distinct: ["fieldName", "filter"],
  insertOne: ["insertOne", "options"],
  insertMany: ["insertMany", "options"],
  updateOne: ["filter", "update", "options"],
  updateMany: ["filter", "update", "options"],
  deleteOne: ["filter", "options"],
  deleteMany: ["filter", "options"],
  findOneAndUpdate: ["filter", "update", "options"],
  findOneAndReplace: ["filter", "replacement", "options"],
  findOneAndDelete: ["filter", "options"],
  createIndex: ["sort", "options"],
  sort: ["sort"],
};

const MONGODB_SHELL_OPTION_KEYS: Record<string, readonly string[]> = {
  find: ["collation", "comment", "hint", "maxTimeMS"],
  findOne: ["collation", "comment", "hint", "maxTimeMS", "sort"],
  count: ["collation", "comment", "hint", "limit", "maxTimeMS", "skip"],
  countDocuments: ["collation", "comment", "hint", "limit", "maxTimeMS", "skip"],
  aggregate: ["allowDiskUse", "bypassDocumentValidation", "collation", "comment", "hint", "let", "maxTimeMS"],
  insertOne: ["bypassDocumentValidation", "comment", "writeConcern"],
  insertMany: ["bypassDocumentValidation", "comment", "ordered", "writeConcern"],
  updateOne: ["arrayFilters", "bypassDocumentValidation", "collation", "comment", "hint", "let", "upsert", "writeConcern"],
  updateMany: ["arrayFilters", "bypassDocumentValidation", "collation", "comment", "hint", "let", "upsert", "writeConcern"],
  deleteOne: ["collation", "comment", "hint", "let", "writeConcern"],
  deleteMany: ["collation", "comment", "hint", "let", "writeConcern"],
  findOneAndUpdate: ["arrayFilters", "bypassDocumentValidation", "collation", "comment", "hint", "let", "maxTimeMS", "projection", "returnDocument", "sort", "upsert", "writeConcern"],
  findOneAndReplace: ["bypassDocumentValidation", "collation", "comment", "hint", "let", "maxTimeMS", "projection", "returnDocument", "sort", "upsert", "writeConcern"],
  findOneAndDelete: ["collation", "comment", "hint", "let", "maxTimeMS", "projection", "sort", "writeConcern"],
  createIndex: ["collation", "expireAfterSeconds", "hidden", "name", "partialFilterExpression", "sparse", "unique", "weights", "wildcardProjection"],
};

function mongodbShellCollection(beforeCursor: string) {
  const getCollection = beforeCursor.match(
    /\bdb\.getCollection\(\s*(["'])(.*?)\1\s*\)/su,
  );
  if (getCollection?.[2]) return getCollection[2];
  return beforeCursor.match(/\bdb\.([\p{L}\p{N}_-]+)/u)?.[1];
}

function mongodbShellCursorIsInComment(source: string) {
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] || "";
    const next = source[index + 1] || "";
    if (lineComment) {
      if (character === "\n" || character === "\r") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if ((character === "/" && next === "/") || (character === "-" && next === "-")) {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
    }
  }
  return lineComment || blockComment;
}

function mongodbShellFindChainAllowsCount(beforeCursor: string) {
  if (!/\.find\s*\(/u.test(beforeCursor)) return false;
  return (beforeCursor.match(/\)\s*\./gu) || []).length === 1;
}

type MongoShellCallContext = {
  method: string;
  argumentIndex: number;
  argumentSource: string;
};

function activeMongoShellCall(beforeCursor: string): MongoShellCallContext | null {
  const stack: Array<{
    delimiter: "(" | "[" | "{";
    method?: string;
    argumentStart?: number;
    argumentIndex?: number;
  }> = [];
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < beforeCursor.length; index += 1) {
    const character = beforeCursor[index] ?? "";
    const next = beforeCursor[index + 1] ?? "";
    if (lineComment) {
      if (character === "\n" || character === "\r") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if ((character === "/" && next === "/") || (character === "-" && next === "-")) {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (character === ".") {
      const match = beforeCursor
        .slice(index + 1)
        .match(/^\s*([A-Za-z][A-Za-z0-9_]*)\s*\(/u);
      const method = match?.[1];
      if (method && MONGODB_SHELL_ARGUMENT_ROLES[method]) {
        const openOffset = match[0].lastIndexOf("(");
        const open = index + 1 + openOffset;
        stack.push({
          delimiter: "(",
          method,
          argumentStart: open + 1,
          argumentIndex: 0,
        });
        index = open;
        continue;
      }
    }
    if (character === "(" || character === "[" || character === "{") {
      stack.push({ delimiter: character });
      continue;
    }
    if (character === ",") {
      const call = [...stack].reverse().find((frame) => frame.method);
      if (call && stack[stack.length - 1] === call) {
        call.argumentIndex = (call.argumentIndex ?? 0) + 1;
        call.argumentStart = index + 1;
      }
      continue;
    }
    if (character === ")" || character === "]" || character === "}") {
      const expected = character === ")" ? "(" : character === "]" ? "[" : "{";
      if (stack[stack.length - 1]?.delimiter === expected) stack.pop();
    }
  }

  const call = [...stack].reverse().find((frame) => frame.method);
  if (!call?.method || call.argumentStart === undefined) return null;
  return {
    method: call.method,
    argumentIndex: call.argumentIndex ?? 0,
    argumentSource: beforeCursor.slice(call.argumentStart),
  };
}

function mongodbShellArgumentContext(
  beforeCursor: string,
  collection: string | undefined,
): MongoDbCompletionContext | null {
  const call = activeMongoShellCall(beforeCursor);
  if (!call) return null;
  const role = MONGODB_SHELL_ARGUMENT_ROLES[call.method]?.[call.argumentIndex];
  if (!role) return null;
  const typed = call.argumentSource.match(/[A-Za-z0-9_$.-]+$/u)?.[0] || "";
  if (role === "options") {
    return {
      area: "shell-option",
      typed,
      parentKey: call.method,
      collection,
      syntax: "shell",
    };
  }
  if (role === "fieldName") {
    return {
      area: "field",
      typed: typed.replace(/^\$/u, ""),
      parentKey: call.method,
      collection,
      syntax: "shell",
      quoted: /["'][^"']*$/u.test(call.argumentSource),
    };
  }

  const ownerKey = role === "replacement" ? "insertOne" : role;
  const wrapper = `{ "${ownerKey}": ${call.argumentSource}`;
  const nested = mongodbConsoleCompletionContext(wrapper, wrapper.length);
  return {
    ...nested,
    collection,
    syntax: "shell",
  };
}

function mongodbShellCompletionContext(
  source: string,
  cursorOffset: number,
): MongoDbCompletionContext | null {
  const beforeCursor = source.slice(0, clampOffset(source, cursorOffset));
  const trimmed = beforeCursor.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return null;

  if (mongodbShellCursorIsInComment(beforeCursor)) {
    return { area: "unknown", typed: "", syntax: "shell" };
  }

  // Argument classification must run before the trailing `db.x.y` patterns:
  // a method-shaped string value is data, not another MongoDB command chain.
  const argumentContext = mongodbShellArgumentContext(
    beforeCursor,
    mongodbShellCollection(beforeCursor),
  );
  if (argumentContext) return argumentContext;

  const chain = beforeCursor.match(/\)\s*\.\s*([A-Za-z]*)$/u);
  if (chain) {
    return {
      area: "shell-chain",
      typed: chain[1] || "",
      collection: mongodbShellCollection(beforeCursor),
      parentKey: mongodbShellFindChainAllowsCount(beforeCursor)
        ? "find-countable"
        : undefined,
      syntax: "shell",
    };
  }

  const qualified = beforeCursor.match(
    /\bdb\.([\p{L}\p{N}_.-]*\.[\p{L}\p{N}_.-]*)$/u,
  );
  if (qualified) {
    const typed = qualified[1] || "";
    return {
      area: "shell-qualified",
      typed,
      collection: typed.split(".", 1)[0] || undefined,
      replacementLength: typed.length,
      syntax: "shell",
    };
  }

  const method = beforeCursor.match(
    /\bdb\.getCollection\(\s*(["']).*?\1\s*\)\s*\.\s*([A-Za-z]*)$/su,
  );
  if (method) {
    return {
      area: "shell-method",
      typed: method[2] || "",
      collection: mongodbShellCollection(beforeCursor),
      syntax: "shell",
    };
  }

  const collection = beforeCursor.match(/\bdb\.([\p{L}\p{N}_.-]*)$/u);
  if (collection) {
    return {
      area: "collection",
      typed: collection[1] || "",
      syntax: "shell",
    };
  }

  if (/^\s*(?:(?:d|db)|(?:s|sh|sho|show|show\s+d|show\s+db|show\s+dat|show\s+data))?$/iu.test(beforeCursor)) {
    return {
      area: "shell-root",
      typed: beforeCursor.trim(),
      syntax: "shell",
    };
  }

  return trimmed.startsWith("db.")
    ? {
        area: "unknown",
        typed: beforeCursor.match(/[A-Za-z0-9_$.-]+$/u)?.[0] || "",
        collection: mongodbShellCollection(beforeCursor),
        syntax: "shell",
      }
    : null;
}

export function mongodbConsoleCompletionContext(source: string, cursorOffset: number): MongoDbCompletionContext {
  const shellContext = mongodbShellCompletionContext(source, cursorOffset);
  if (shellContext) return shellContext;
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

function shellOptionItems(method: string | undefined, typed: string) {
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
      } else if (["expireAfterSeconds", "limit", "maxTimeMS", "skip"].includes(key)) {
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
    case "shell-root":
      items = MONGODB_SHELL_ROOT_COMPLETIONS.filter((item) =>
        matches(item.label, context.typed),
      );
      break;
    case "shell-qualified": {
      const dot = context.typed.lastIndexOf(".");
      const collectionPrefix = context.typed.slice(0, dot);
      const methodPrefix = context.typed.slice(dot + 1);
      const exactCollection = (input.collections || []).some(
        (name) => name.toLocaleLowerCase() === collectionPrefix.toLocaleLowerCase(),
      );
      const qualifiedCollections = [...new Set(input.collections || [])]
        .filter((name) =>
          name.toLocaleLowerCase().startsWith(context.typed.toLocaleLowerCase()),
        )
        .sort((left, right) => left.localeCompare(right))
        .map((name) => ({
          label: name,
          detail: "MongoDB collection",
          insertText: `getCollection(${JSON.stringify(name)})`,
          filterText: name,
          kind: "value" as const,
        }));
      const qualifiedMethods = MONGODB_SHELL_METHOD_COMPLETIONS
        .filter((item) => matches(item.label, methodPrefix))
        .map((item) => ({
          ...item,
          insertText: `${collectionPrefix}.${item.insertText}`,
          filterText: `${collectionPrefix}.${item.label}`,
        }));
      items = exactCollection
        ? [...qualifiedMethods, ...qualifiedCollections]
        : [...qualifiedCollections, ...qualifiedMethods];
      break;
    }
    case "shell-method":
      items = MONGODB_SHELL_METHOD_COMPLETIONS.filter((item) =>
        matches(item.label, context.typed),
      );
      break;
    case "shell-chain":
      items = MONGODB_SHELL_CHAIN_COMPLETIONS.filter((item) =>
        matches(item.label, context.typed),
      );
      if (
        context.parentKey === "find-countable" &&
        matches(MONGODB_SHELL_COUNT_COMPLETION.label, context.typed)
      ) {
        items.push(MONGODB_SHELL_COUNT_COMPLETION);
      }
      break;
    case "shell-option":
      items = shellOptionItems(context.parentKey, context.typed);
      break;
    case "root":
      items = ROOT_COMMANDS.filter((item) => matches(item.label, context.typed));
      break;
    case "collection":
      items = collections.filter((name) => matches(name, context.typed)).map((name) => ({
        label: name,
        detail: "MongoDB collection",
        insertText:
          context.syntax === "shell" && !/^[\p{L}\p{N}_-]+$/u.test(name)
            ? `getCollection(${JSON.stringify(name)})`
            : name,
        kind: "value",
      }));
      if (context.syntax === "shell") {
        items.push(
          ...MONGODB_SHELL_DATABASE_COMPLETIONS.filter((item) =>
            matches(item.label, context.typed),
          ),
        );
      }
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
  if (area === "root" || area === "shell-root" || area === "shell-qualified" || area === "shell-method" || area === "shell-chain") return "key";
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
  return Boolean(lastCharacter && (lastCharacter === '"' || lastCharacter === "'" || lastCharacter === "." || lastCharacter === "(" || lastCharacter === "{" || lastCharacter === "[" || lastCharacter === "," || lastCharacter === ":" || MONGODB_AUTOMATIC_TRIGGER.test(lastCharacter)) && shouldOfferMongoDbCompletions(source, cursorOffset));
}
