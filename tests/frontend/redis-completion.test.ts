import { describe, expect, it } from "vitest";
import {
  mergeRedisCommandDocumentation,
  parseRedisCommandCatalog,
  parseRedisCommandDocumentation,
  type RedisCommandDocumentation,
} from "../../src/lib/redisCommandDocs";
import {
  buildRedisCompletionItems,
  getRedisCompletionContext,
  takesRedisKeyArgument,
} from "../../src/lib/redisCompletion";
import { tokenizeRedisLine } from "../../src/lib/redisCommandTokenizer";

describe("Redis command metadata", () => {
  it("normalizes COMMAND DOCS maps and nested subcommands", () => {
    const docs = parseRedisCommandDocumentation([
      "client",
      [
        "summary",
        "Client connection commands",
        "group",
        "connection",
        "subcommands",
        [
          "client|list",
          ["summary", "List clients", "group", "connection", "arity", 2],
        ],
      ],
    ]);

    expect(docs.map((command) => command.name)).toEqual([
      "CLIENT",
      "CLIENT LIST",
    ]);
    expect(docs[1]).toMatchObject({
      summary: "List clients",
      group: "connection",
      arity: 2,
    });
  });

  it("fills documentation key positions from the legacy COMMAND catalog", () => {
    const docs = parseRedisCommandDocumentation({
      get: { summary: "Get a value", group: "string" },
    });
    const catalog = parseRedisCommandCatalog([
      ["get", 2, ["readonly"], 1, 1, 1],
    ]);

    expect(mergeRedisCommandDocumentation(docs, catalog)[0]).toMatchObject({
      name: "GET",
      arity: 2,
      keySpecs: [
        {
          beginSearch: { type: "index", index: 1 },
          findKeys: { type: "range", lastKey: 0, keyStep: 1, limit: 0 },
        },
      ],
    });
  });
});

describe("Redis editor completion", () => {
  const commands: RedisCommandDocumentation[] = [
    {
      name: "GET",
      summary: "Get a value",
      group: "string",
      arity: 2,
      keySpecs: [
        {
          beginSearch: { type: "index", index: 1 },
          findKeys: { type: "range", lastKey: 0, keyStep: 1, limit: 0 },
        },
      ],
    },
    {
      name: "CLIENT",
      group: "connection",
      keySpecs: [],
    },
    {
      name: "CLIENT LIST",
      summary: "List clients",
      group: "connection",
      keySpecs: [],
    },
    {
      name: "SET",
      group: "string",
      keySpecs: [
        {
          beginSearch: { type: "index", index: 1 },
          findKeys: { type: "range", lastKey: 0, keyStep: 1, limit: 0 },
        },
      ],
      arguments: [
        { name: "key", type: "key" },
        { name: "value", type: "string" },
        { name: "expiration", token: "EX", optional: true },
      ],
    },
  ];

  it("tokenizes quoted and escaped values like the backend", () => {
    expect(tokenizeRedisLine('SET "user name" "Ada\\nLovelace"').argv).toEqual([
      { value: "SET", startColumn: 1, endColumn: 4 },
      { value: "user name", startColumn: 5, endColumn: 16 },
      { value: "Ada\nLovelace", startColumn: 17, endColumn: 32 },
    ]);
  });

  it("completes commands, subcommands, server arguments and existing keys", () => {
    const commandContext = getRedisCompletionContext("GE", 2, { commands });
    expect(buildRedisCompletionItems(commandContext, { commands })[0].label).toBe("GET");

    const subcommandContext = getRedisCompletionContext("CLIENT L", 8, { commands });
    expect(buildRedisCompletionItems(subcommandContext, { commands })[0].label).toBe("LIST");

    const keyContext = getRedisCompletionContext("GET user", 8, { commands });
    expect(takesRedisKeyArgument(
      keyContext.commandName,
      { commands },
      keyContext.argumentIndex,
      keyContext.argumentValues,
    )).toBe(true);
    expect(buildRedisCompletionItems(keyContext, {
      commands,
      keys: ["user:1", "order:1"],
    }).map((item) => item.label)).toEqual(["user:1"]);

    const argumentContext = getRedisCompletionContext("SET user:1 value E", 18, { commands });
    expect(buildRedisCompletionItems(argumentContext, { commands })[0]).toMatchObject({
      label: "EX",
      type: "value",
    });
  });

  it("bounds Redis key completions without dropping command argument hints", () => {
    const keyContext = getRedisCompletionContext("SET ", 4, { commands });
    const keys = Array.from({ length: 700 }, (_, index) =>
      `cache:${String(index).padStart(3, "0")}`,
    );

    const items = buildRedisCompletionItems(keyContext, { commands, keys });

    expect(items.filter((item) => item.type === "key")).toHaveLength(512);
    expect(items[0]?.label).toBe("cache:000");
    expect(items.some((item) => item.label === "EX")).toBe(true);
  });
});
