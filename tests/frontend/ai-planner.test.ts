import { describe, expect, it } from "vitest";
import { createDefaultAssistantPlanner } from "@/ai/assistant/planner";
import { DEFAULT_AI_TOOL_POLICY } from "@/ai/tools/policy";
import type { AiToolSummary } from "@/ai/tools/types";

const QUERY_TOOLS: AiToolSummary[] = [
  {
    name: "query.runReadOnly",
    description: "Run read-only query.",
    inputSchema: { type: "object" },
    permissions: ["read"],
    capabilities: ["query"],
  },
  {
    name: "key.getValue",
    description: "Read Redis key.",
    inputSchema: { type: "object" },
    permissions: ["read"],
    capabilities: ["query"],
  },
  {
    name: "key.deleteKeys",
    description: "Delete Redis keys.",
    inputSchema: { type: "object" },
    permissions: ["destructive"],
    capabilities: ["query"],
  },
  {
    name: "key.setValue",
    description: "Set Redis key.",
    inputSchema: { type: "object" },
    permissions: ["write"],
    capabilities: ["query"],
  },
  {
    name: "table.insertRows",
    description: "Insert table rows.",
    inputSchema: { type: "object" },
    permissions: ["write"],
    capabilities: ["query"],
  },
  {
    name: "document.insertDocuments",
    description: "Insert documents.",
    inputSchema: { type: "object" },
    permissions: ["write"],
    capabilities: ["query"],
  },
  {
    name: "document.updateDocuments",
    description: "Update documents.",
    inputSchema: { type: "object" },
    permissions: ["write"],
    capabilities: ["query"],
  },
  {
    name: "document.deleteDocuments",
    description: "Delete documents.",
    inputSchema: { type: "object" },
    permissions: ["destructive"],
    capabilities: ["query"],
  },
  {
    name: "search.indexDocument",
    description: "Index search document.",
    inputSchema: { type: "object" },
    permissions: ["write"],
    capabilities: ["query"],
  },
  {
    name: "search.updateDocument",
    description: "Update search document.",
    inputSchema: { type: "object" },
    permissions: ["write"],
    capabilities: ["query"],
  },
  {
    name: "search.deleteDocument",
    description: "Delete search document.",
    inputSchema: { type: "object" },
    permissions: ["destructive"],
    capabilities: ["query"],
  },
];

function planFor(
  message: string,
  activeDriver: "postgres" | "redis" | "mongodb" | "elasticsearch",
  selectedText?: string,
  activeSql?: string
) {
  return createDefaultAssistantPlanner().plan({
    turn: { message, selectedText },
    context: {
      requestId: `planner-${activeDriver}`,
      activeDriver,
      activeTab: activeSql
        ? {
            id: "tab-1",
            type: "query",
            title: "Query #1",
            sql: activeSql,
          }
        : undefined,
    },
    availableTools: QUERY_TOOLS,
    policy: DEFAULT_AI_TOOL_POLICY,
  });
}

describe("default assistant planner", () => {
  it("plans active tab query execution when no editor selection is present", () => {
    const result = planFor(
      "run current query",
      "postgres",
      undefined,
      "SELECT * FROM users"
    );

    expect(result.intent).toBe("query");
    expect(result.steps).toContainEqual(
      expect.objectContaining({
        id: "query-execution",
        toolName: "query.runReadOnly",
        input: { query: "SELECT * FROM users" },
        requiresApproval: false,
      })
    );
  });

  it("prefers selected SQL over active tab SQL for query execution", () => {
    const result = planFor(
      "run current query",
      "postgres",
      "SELECT id FROM selected_users",
      "SELECT * FROM users"
    );

    expect(result.steps).toContainEqual(
      expect.objectContaining({
        toolName: "query.runReadOnly",
        input: { query: "SELECT id FROM selected_users" },
      })
    );
  });

  it("plans Redis key reads without requiring selected text", () => {
    const result = planFor("read key session:1", "redis");

    expect(result.intent).toBe("query");
    expect(result.steps).toContainEqual(
      expect.objectContaining({
        id: "query-execution",
        toolName: "key.getValue",
        input: { key: "session:1" },
        requiresApproval: false,
      })
    );
  });

  it("plans Chinese Redis key reads without requiring selected text", () => {
    const result = planFor("查看键 session:1", "redis");

    expect(result.intent).toBe("query");
    expect(result.steps).toContainEqual(
      expect.objectContaining({
        toolName: "key.getValue",
        input: { key: "session:1" },
      })
    );
  });

  it("plans Chinese structured writes for relational, document, and search drivers", () => {
    const rowInsert = planFor("插入到表 users", "postgres", '{"id":1}');
    const documentInsert = planFor(
      "新增到集合 users",
      "mongodb",
      '{"name":"Ada"}'
    );
    const searchIndex = planFor(
      "写入到索引 users 编号 1",
      "elasticsearch",
      '{"active":true}'
    );

    expect(rowInsert.steps).toContainEqual(
      expect.objectContaining({
        toolName: "table.insertRows",
        input: { table: "users", inserts: [{ id: 1 }] },
      })
    );
    expect(documentInsert.steps).toContainEqual(
      expect.objectContaining({
        toolName: "document.insertDocuments",
        input: { collection: "users", documents: [{ name: "Ada" }] },
      })
    );
    expect(searchIndex.steps).toContainEqual(
      expect.objectContaining({
        toolName: "search.indexDocument",
        input: { index: "users", id: "1", document: { active: true } },
      })
    );
  });

  it("plans document, key-value, and search structured mutations beyond inserts", () => {
    const documentUpdate = planFor(
      'update collection users where {"id":1}',
      "mongodb",
      '{"active":false}'
    );
    const documentDelete = planFor(
      "delete many from collection users",
      "mongodb",
      '{"filter":{"active":false},"many":true}'
    );
    const redisDelete = planFor("delete key session:1", "redis");
    const searchUpdate = planFor(
      "update index users id 42",
      "elasticsearch",
      '{"active":false}'
    );
    const searchDelete = planFor(
      "delete from index users id 42",
      "elasticsearch"
    );

    expect(documentUpdate.steps).toContainEqual(
      expect.objectContaining({
        toolName: "document.updateDocuments",
        input: {
          collection: "users",
          filter: { id: 1 },
          update: { $set: { active: false } },
          many: false,
          upsert: false,
        },
      })
    );
    expect(documentDelete.steps).toContainEqual(
      expect.objectContaining({
        toolName: "document.deleteDocuments",
        input: {
          collection: "users",
          filter: { active: false },
          many: true,
        },
      })
    );
    expect(redisDelete.steps).toContainEqual(
      expect.objectContaining({
        toolName: "key.deleteKeys",
        input: { keys: ["session:1"] },
      })
    );
    expect(searchUpdate.steps).toContainEqual(
      expect.objectContaining({
        toolName: "search.updateDocument",
        input: {
          index: "users",
          id: "42",
          document: { active: false },
          upsert: false,
        },
      })
    );
    expect(searchDelete.steps).toContainEqual(
      expect.objectContaining({
        toolName: "search.deleteDocument",
        input: {
          index: "users",
          id: "42",
        },
      })
    );
  });

  it("plans MongoDB read commands from natural language and active collection context", () => {
    const findResult = planFor(
      'find collection users where {"active":true} limit 10',
      "mongodb"
    );
    const nativeFindResult = planFor(
      'find {"collection":"users","find":{"active":true}}',
      "mongodb"
    );
    const nativeLimitedFindResult = planFor(
      'find {"collection":"users","find":{"active":true},"limit":20}',
      "mongodb"
    );
    const aggregateResult = planFor(
      'aggregate collection events {"aggregate":[{"$match":{"active":true}}]}',
      "mongodb"
    );
    const countResult = createDefaultAssistantPlanner().plan({
      turn: { message: "count current collection" },
      context: {
        requestId: "planner-mongodb",
        activeDriver: "mongodb",
        activeNamespace: "app",
        activeTab: {
          id: "tab-1",
          type: "query",
          title: "Collection: users",
          tableName: "users",
          objectType: "collection",
        },
      },
      availableTools: QUERY_TOOLS,
      policy: DEFAULT_AI_TOOL_POLICY,
    });

    expect(findResult.intent).toBe("query");
    expect(findResult.steps).toContainEqual(
      expect.objectContaining({
        toolName: "query.runReadOnly",
        input: {
          query: JSON.stringify({
            collection: "users",
            find: { active: true },
            limit: 10,
          }),
          limit: 10,
        },
      })
    );
    expect(nativeFindResult.steps).toContainEqual(
      expect.objectContaining({
        toolName: "query.runReadOnly",
        input: {
          query: JSON.stringify({
            collection: "users",
            find: { active: true },
            limit: 50,
          }),
          limit: 50,
        },
      })
    );
    expect(nativeLimitedFindResult.steps).toContainEqual(
      expect.objectContaining({
        toolName: "query.runReadOnly",
        input: {
          query: JSON.stringify({
            collection: "users",
            find: { active: true },
            limit: 20,
          }),
          limit: 50,
        },
      })
    );
    expect(aggregateResult.steps).toContainEqual(
      expect.objectContaining({
        toolName: "query.runReadOnly",
        input: {
          query: JSON.stringify({
            collection: "events",
            aggregate: [{ $match: { active: true } }, { $limit: 50 }],
          }),
          limit: 50,
        },
      })
    );
    expect(countResult.steps).toContainEqual(
      expect.objectContaining({
        toolName: "query.runReadOnly",
        input: {
          namespace: "app",
          query: JSON.stringify({
            collection: "users",
            countDocuments: {},
          }),
          limit: 50,
        },
      })
    );
  });

  it("plans Elasticsearch read requests from natural language and active index context", () => {
    const result = createDefaultAssistantPlanner().plan({
      turn: {
        message: 'search current index {"query":{"term":{"status":"open"}}}',
      },
      context: {
        requestId: "planner-elasticsearch",
        activeDriver: "elasticsearch",
        activeNamespace: "default",
        activeTab: {
          id: "tab-1",
          type: "query",
          title: "Index: events",
          tableName: "events",
          objectType: "index",
        },
      },
      availableTools: QUERY_TOOLS,
      policy: DEFAULT_AI_TOOL_POLICY,
    });
    const nativeBodyResult = planFor(
      'search current index {"query":{"match_all":{}},"size":25}',
      "elasticsearch"
    );

    expect(result.intent).toBe("query");
    expect(result.steps).toContainEqual(
      expect.objectContaining({
        toolName: "query.runReadOnly",
        input: {
          namespace: "events",
          query: JSON.stringify({
            query: { term: { status: "open" } },
            size: 50,
          }),
          limit: 50,
        },
      })
    );
    expect(nativeBodyResult.steps).toContainEqual(
      expect.objectContaining({
        toolName: "query.runReadOnly",
        input: {
          query: JSON.stringify({
            query: { match_all: {} },
            size: 25,
          }),
          limit: 50,
        },
      })
    );
  });
});
