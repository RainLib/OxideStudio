import { type MongoDbConsoleCompletion } from "@/features/query-languages/mongodb/types";

export const MONGODB_SHELL_ROOT_COMPLETIONS: MongoDbConsoleCompletion[] = [
  {
    label: "use database",
    detail: "Select the database for subsequent MongoDB shell commands",
    documentation:
      "Changes this query tab's MongoDB database target; accepts one database name.",
    insertText: "use ${1:database}",
    kind: "snippet",
  },
  {
    label: "db.collection.find",
    detail: "Find documents with a bounded result",
    documentation:
      "Read-only shell syntax parsed by OxideStudio; the default limit is 100.",
    insertText: "db.${1:collection}.find({\n  ${2}\n}).limit(${3:100})",
    kind: "snippet",
  },
  {
    label: "db.collection.aggregate",
    detail: "Run a read-only aggregation pipeline",
    insertText: 'db.${1:collection}.aggregate([\n  { "$match": { ${2} } }\n])',
    kind: "snippet",
  },
  {
    label: "db.getCollection",
    detail: "Address a dotted or non-identifier collection name",
    insertText:
      'db.getCollection("${1:collection.name}").find({ ${2} }).limit(${3:100})',
    kind: "snippet",
  },
  {
    label: "show databases",
    detail: "List databases visible to the current account",
    insertText: "show databases",
    kind: "snippet",
  },
];

export const MONGODB_SHELL_DATABASE_COMPLETIONS: MongoDbConsoleCompletion[] = [
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
  {
    label: "runCommand",
    detail: "Run a MongoDB command document",
    documentation:
      "The default ping example is read-only. Commands that mutate state remain subject to the query safety policy.",
    insertText: "runCommand({ ping: 1 })",
    kind: "snippet",
  },
];

export const MONGODB_SHELL_METHOD_COMPLETIONS: MongoDbConsoleCompletion[] = [
  {
    label: "find",
    detail: "Find documents (default limit 100)",
    insertText: "find({ ${1} }).limit(${2:100})",
    kind: "snippet",
  },
  {
    label: "findOne",
    detail: "Find the first matching document",
    insertText: "findOne({ ${1} })",
    kind: "snippet",
  },
  {
    label: "countDocuments",
    detail: "Count matching documents",
    insertText: "countDocuments({ ${1} })",
    kind: "snippet",
  },
  {
    label: "count",
    detail: "Legacy count helper",
    insertText: "count({ ${1} })",
    kind: "snippet",
  },
  {
    label: "aggregate",
    detail: "Read-only aggregation pipeline",
    insertText: 'aggregate([\n  { "$match": { ${1} } }\n])',
    kind: "snippet",
  },
  {
    label: "distinct",
    detail: "Read distinct field values",
    insertText: 'distinct("${1:field}", { ${2} })',
    kind: "snippet",
  },
  {
    label: "getIndexes",
    detail: "List collection indexes",
    insertText: "getIndexes()",
    kind: "snippet",
  },
  {
    label: "stats",
    detail: "Read collection statistics",
    insertText: "stats()",
    kind: "snippet",
  },
  {
    label: "dataSize",
    detail: "Read total document size",
    insertText: "dataSize()",
    kind: "snippet",
  },
  {
    label: "storageSize",
    detail: "Read allocated collection storage",
    insertText: "storageSize()",
    kind: "snippet",
  },
  {
    label: "totalIndexSize",
    detail: "Read total index storage",
    insertText: "totalIndexSize()",
    kind: "snippet",
  },
  {
    label: "insertOne",
    detail: "Insert one document",
    insertText: "insertOne({ ${1} })",
    kind: "snippet",
  },
  {
    label: "insertMany",
    detail: "Insert multiple documents",
    insertText: "insertMany([\n  { ${1} }\n])",
    kind: "snippet",
  },
  {
    label: "updateOne",
    detail: "Update the first matching document",
    insertText: "updateOne({ ${1:filter} }, { $set: { ${2} } })",
    kind: "snippet",
  },
  {
    label: "updateMany",
    detail: "Update all matching documents",
    insertText: "updateMany({ ${1:filter} }, { $set: { ${2} } })",
    kind: "snippet",
  },
  {
    label: "deleteOne",
    detail: "Delete the first matching document",
    insertText: "deleteOne({ ${1:filter} })",
    kind: "snippet",
  },
  {
    label: "deleteMany",
    detail: "Delete all matching documents",
    insertText: "deleteMany({ ${1:filter} })",
    kind: "snippet",
  },
  {
    label: "findOneAndUpdate",
    detail: "Atomically update and return a document",
    insertText:
      'findOneAndUpdate({ ${1:filter} }, { $set: { ${2} } }, { returnDocument: "after" })',
    kind: "snippet",
  },
  {
    label: "findOneAndReplace",
    detail: "Atomically replace and return a document",
    insertText: "findOneAndReplace({ ${1:filter} }, { ${2:replacement} })",
    kind: "snippet",
  },
  {
    label: "findOneAndDelete",
    detail: "Atomically delete and return a document",
    insertText: "findOneAndDelete({ ${1:filter} })",
    kind: "snippet",
  },
  {
    label: "createIndex",
    detail: "Create an index",
    insertText: "createIndex({ ${1:field}: ${2:1} })",
    kind: "snippet",
  },
  {
    label: "dropIndex",
    detail: "Drop one index",
    insertText: 'dropIndex("${1:indexName}")',
    kind: "snippet",
  },
  {
    label: "dropIndexes",
    detail: "Drop all non-_id indexes",
    insertText: "dropIndexes()",
    kind: "snippet",
  },
  {
    label: "drop",
    detail: "Drop the collection",
    insertText: "drop()",
    kind: "snippet",
  },
];

export const MONGODB_SHELL_CHAIN_COMPLETIONS: MongoDbConsoleCompletion[] = [
  {
    label: "limit",
    detail: "Limit results to 1-10000 documents",
    insertText: "limit(${1:100})",
    kind: "snippet",
  },
  {
    label: "sort",
    detail: "Sort find results",
    insertText: "sort({ ${1:field}: ${2:1} })",
    kind: "snippet",
  },
  {
    label: "skip",
    detail: "Skip a non-negative number of results",
    insertText: "skip(${1:0})",
    kind: "snippet",
  },
];

export const MONGODB_SHELL_COUNT_COMPLETION: MongoDbConsoleCompletion = {
  label: "count",
  detail: "Count documents matched by find()",
  insertText: "count()",
  kind: "snippet",
};

export const MONGODB_SHELL_ARGUMENT_ROLES: Record<string, readonly string[]> = {
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

export const MONGODB_SHELL_OPTION_KEYS: Record<string, readonly string[]> = {
  find: ["collation", "comment", "hint", "maxTimeMS"],
  findOne: ["collation", "comment", "hint", "maxTimeMS", "sort"],
  count: ["collation", "comment", "hint", "limit", "maxTimeMS", "skip"],
  countDocuments: [
    "collation",
    "comment",
    "hint",
    "limit",
    "maxTimeMS",
    "skip",
  ],
  aggregate: [
    "allowDiskUse",
    "bypassDocumentValidation",
    "collation",
    "comment",
    "hint",
    "let",
    "maxTimeMS",
  ],
  insertOne: ["bypassDocumentValidation", "comment", "writeConcern"],
  insertMany: [
    "bypassDocumentValidation",
    "comment",
    "ordered",
    "writeConcern",
  ],
  updateOne: [
    "arrayFilters",
    "bypassDocumentValidation",
    "collation",
    "comment",
    "hint",
    "let",
    "upsert",
    "writeConcern",
  ],
  updateMany: [
    "arrayFilters",
    "bypassDocumentValidation",
    "collation",
    "comment",
    "hint",
    "let",
    "upsert",
    "writeConcern",
  ],
  deleteOne: ["collation", "comment", "hint", "let", "writeConcern"],
  deleteMany: ["collation", "comment", "hint", "let", "writeConcern"],
  findOneAndUpdate: [
    "arrayFilters",
    "bypassDocumentValidation",
    "collation",
    "comment",
    "hint",
    "let",
    "maxTimeMS",
    "projection",
    "returnDocument",
    "sort",
    "upsert",
    "writeConcern",
  ],
  findOneAndReplace: [
    "bypassDocumentValidation",
    "collation",
    "comment",
    "hint",
    "let",
    "maxTimeMS",
    "projection",
    "returnDocument",
    "sort",
    "upsert",
    "writeConcern",
  ],
  findOneAndDelete: [
    "collation",
    "comment",
    "hint",
    "let",
    "maxTimeMS",
    "projection",
    "sort",
    "writeConcern",
  ],
  createIndex: [
    "collation",
    "expireAfterSeconds",
    "hidden",
    "name",
    "partialFilterExpression",
    "sparse",
    "unique",
    "weights",
    "wildcardProjection",
  ],
};
