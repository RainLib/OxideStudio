export function looksReadOnlyMongoCommand(query: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(query);
  } catch {
    return false;
  }

  const commands = Array.isArray(parsed) ? parsed : [parsed];
  return commands.every((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return false;
    }

    const payload = item as Record<string, unknown>;
    const keys = Object.keys(payload).map((key) => key.toLowerCase());
    const operations = keys.filter((key) => MONGO_OPERATION_KEYS.has(key));

    if (operations.length === 0) {
      return (
        typeof payload.collection === "string" &&
        keys.every((key) => READ_ONLY_MONGO_FIND_FIELDS.has(key))
      );
    }
    if (operations.length > 1) return false;

    const operation = operations[0];
    if (!operation) return false;
    if (operation === "aggregate") {
      return mongoPipelineIsReadOnly(payload.aggregate);
    }
    if (["find", "countdocuments"].includes(operation)) {
      return true;
    }
    if (operation !== "command") return false;

    const commandBody = payload.command;
    if (
      !commandBody ||
      typeof commandBody !== "object" ||
      Array.isArray(commandBody)
    ) {
      return false;
    }
    const [commandName] = Object.keys(commandBody);
    if (commandName?.toLowerCase() === "aggregate") {
      return mongoPipelineIsReadOnly(
        (commandBody as Record<string, unknown>).pipeline,
      );
    }
    return Boolean(
      commandName && READ_ONLY_MONGO_COMMANDS.has(commandName.toLowerCase()),
    );
  });
}

export function looksDestructiveMongoCommand(query: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(query);
  } catch {
    return false;
  }

  const commands = Array.isArray(parsed) ? parsed : [parsed];
  return commands.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return false;
    }

    const payload = item as Record<string, unknown>;
    const keys = Object.keys(payload).map((key) => key.toLowerCase());
    if (mongoPipelineHasWriteStage(payload.aggregate)) {
      return true;
    }
    if (
      keys.some((key) =>
        [
          "collmod",
          "delete",
          "deleteone",
          "deletemany",
          "drop",
          "dropdatabase",
          "dropindexes",
          "findandmodify",
          "renamecollection",
        ].includes(key),
      )
    ) {
      return true;
    }

    const commandBody = payload.command;
    if (
      !commandBody ||
      typeof commandBody !== "object" ||
      Array.isArray(commandBody)
    ) {
      return false;
    }
    if (
      mongoPipelineHasWriteStage(
        (commandBody as Record<string, unknown>).pipeline,
      )
    ) {
      return true;
    }
    const [commandName] = Object.keys(commandBody).map((key) =>
      key.toLowerCase(),
    );
    return Boolean(
      commandName &&
        [
          "collmod",
          "delete",
          "drop",
          "dropdatabase",
          "dropindexes",
          "findandmodify",
          "renamecollection",
        ].includes(commandName),
    );
  });
}

function mongoPipelineIsReadOnly(value: unknown) {
  return Array.isArray(value) && !mongoPipelineHasWriteStage(value);
}

function mongoPipelineHasWriteStage(value: unknown) {
  if (!Array.isArray(value)) return false;

  return value.some((stage) => {
    if (!stage || typeof stage !== "object" || Array.isArray(stage)) {
      return false;
    }

    return Object.keys(stage as Record<string, unknown>).some((key) =>
      ["$out", "$merge"].includes(key.toLowerCase()),
    );
  });
}

const READ_ONLY_MONGO_COMMANDS = new Set([
  "aggregate",
  "buildinfo",
  "collstats",
  "count",
  "dbstats",
  "distinct",
  "explain",
  "find",
  "hello",
  "ismaster",
  "listcollections",
  "listdatabases",
  "listindexes",
  "ping",
  "serverstatus",
]);

const MONGO_OPERATION_KEYS = new Set([
  "aggregate",
  "command",
  "countdocuments",
  "deletemany",
  "deleteone",
  "find",
  "insertmany",
  "insertone",
  "updatemany",
  "updateone",
]);

const READ_ONLY_MONGO_FIND_FIELDS = new Set([
  "collection",
  "database",
  "find",
  "limit",
  "projection",
  "skip",
  "sort",
]);
