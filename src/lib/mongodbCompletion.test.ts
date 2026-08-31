import { describe, expect, it } from "vitest";
import {
  buildMongoDbConsoleCompletions,
  mongodbCompletionUsesSnippetSyntax,
  mongodbConsoleCompletionContext,
  shouldOfferMongoDbCompletions,
} from "./mongodbCompletion";

const fields = [
  { name: "amount", dataType: "decimal" },
  { name: "customer.region", dataType: "string" },
];

function completion(source: string) {
  return buildMongoDbConsoleCompletions(source, source.length, { fields });
}

describe("MongoDB native JSON aggregation completion", () => {
  it("offers accumulators inside a $group output expression", () => {
    const source = '{"aggregate":"orders","pipeline":[{"$group":{"total":{"$su';
    const result = completion(source);
    expect(result.context.area).toBe("accumulator");
    expect(result.items.some((item) => item.label === "$sum")).toBe(true);
  });

  it("offers aggregation expressions inside projection values", () => {
    const source = '{"aggregate":"orders","pipeline":[{"$project":{"normalized":{"$toS';
    const result = completion(source);
    expect(result.context.area).toBe("expression");
    expect(result.items.some((item) => item.label === "$toString")).toBe(true);
  });

  it("offers sampled dotted fields as executable $field references", () => {
    const source = '{"aggregate":"orders","pipeline":[{"$group":{"_id":"$customer.';
    const result = completion(source);
    expect(result.context.area).toBe("field-reference");
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "$customer.region",
          insertText: "$customer.region",
        }),
      ]),
    );
  });

  it("keeps nested lookup pipelines in pipeline-stage mode", () => {
    const source = '{"aggregate":"orders","pipeline":[{"$lookup":{"from":"users","pipeline":[{"$ma';
    expect(mongodbConsoleCompletionContext(source, source.length).area).toBe(
      "pipeline-stage",
    );
  });

  it("keeps nested field predicates in query-operator mode", () => {
    const source = '{"find":"orders","filter":{"amount":{"$g';
    const result = completion(source);
    expect(result.context.area).toBe("query-operator");
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "$gte",
          insertText: '"$gte": ${1}',
        }),
      ]),
    );
    expect(mongodbCompletionUsesSnippetSyntax(result.items[0]!)).toBe(true);
  });

  it("offers fields inside logical query arrays", () => {
    const source = '{"find":"orders","filter":{"$and":[{"customer.';
    const result = completion(source);
    expect(result.context.area).toBe("field");
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "customer.region" }),
      ]),
    );
  });

  it("offers push modifiers only inside a pushed field value", () => {
    const source =
      '{"collection":"orders","updateOne":{"filter":{},"update":{"$push":{"tags":{"$e';
    const result = completion(source);
    expect(result.context.area).toBe("push-modifier");
    expect(result.items).toEqual([
      expect.objectContaining({
        label: "$each",
        insertText: '"$each": [${1}]',
      }),
    ]);
  });

  it("covers fixed stage options and field-reference values", () => {
    const optionSource =
      '{"aggregate":"orders","pipeline":[{"$unwind":{"pre';
    const optionResult = completion(optionSource);
    expect(optionResult.context.area).toBe("stage-option");
    expect(optionResult.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "preserveNullAndEmptyArrays" }),
      ]),
    );

    const fieldSource =
      '{"aggregate":"orders","pipeline":[{"$bucket":{"groupBy":"$customer.';
    const fieldResult = completion(fieldSource);
    expect(fieldResult.context.area).toBe("field-reference");
    expect(fieldResult.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "$customer.region" }),
      ]),
    );
  });

  it("uses executable Extended JSON values instead of shell helpers", () => {
    const source = '{"find":"orders","filter":{"_id":O';
    const result = completion(source);
    expect(result.context).toMatchObject({ area: "value", quoted: false });
    expect(result.items).toEqual([
      expect.objectContaining({
        label: "ObjectId",
        insertText: '{ "$oid": "${1:000000000000000000000000}" }',
      }),
    ]);
    expect(result.items.some((item) => item.insertText.includes("ObjectId("))).toBe(
      false,
    );
  });

  it("does not inject value snippets into an existing JSON string", () => {
    const source = '{"find":"orders","filter":{"status":"act';
    const result = completion(source);
    expect(result.context).toMatchObject({ area: "value", quoted: true });
    expect(result.items).toEqual([]);
    expect(shouldOfferMongoDbCompletions(source, source.length)).toBe(false);
  });

  it("keeps plain metadata values out of Monaco snippet mode", () => {
    expect(
      mongodbCompletionUsesSnippetSyntax({
        insertText: "status",
        kind: "field",
      }),
    ).toBe(false);
  });

  it("adds common native-command helpers without changing the JSON contract", () => {
    const source = '{"di';
    const result = completion(source);
    expect(result.context.area).toBe("root");
    expect(result.items).toEqual([
      expect.objectContaining({
        label: "distinct",
        insertText: expect.stringContaining('"command"'),
      }),
    ]);
  });

  it("bounds large metadata completion lists", () => {
    const source = '{"find":"orders","filter":{"';
    const result = buildMongoDbConsoleCompletions(source, source.length, {
      fields: Array.from({ length: 400 }, (_, index) => ({
        name: `field_${String(index).padStart(3, "0")}`,
      })),
    });
    expect(result.context.area).toBe("field");
    expect(result.items).toHaveLength(256);
  });
});

describe("MongoDB read-only shell completion", () => {
  it("offers only Host-supported read methods after a collection dot", () => {
    const source = "db.orders.fi";
    const result = buildMongoDbConsoleCompletions(source, source.length, {});
    expect(result.context).toMatchObject({
      area: "shell-method",
      typed: "fi",
      collection: "orders",
      syntax: "shell",
    });
    expect(result.items.map((item) => item.label)).toEqual(["find", "findOne"]);
    expect(result.items.some((item) => item.label === "deleteMany")).toBe(false);
  });

  it("offers bounded cursor chains and live collection names", () => {
    const chain = "db.orders.find({}).";
    expect(
      buildMongoDbConsoleCompletions(chain, chain.length).items.map(
        (item) => item.label,
      ),
    ).toEqual(["sort", "skip", "limit"]);

    const collection = "db.aud";
    const result = buildMongoDbConsoleCompletions(collection, collection.length, {
      collections: ["audit.logs", "users"],
    });
    expect(result.items).toContainEqual(
      expect.objectContaining({
        label: "audit.logs",
        insertText: 'getCollection("audit.logs")',
      }),
    );
  });

  it("keeps native JSON context routing unchanged", () => {
    const source = '{"find":"orders","filter":{"amount":{"$g';
    const result = completion(source);
    expect(result.context.syntax).not.toBe("shell");
    expect(result.context.area).toBe("query-operator");
    expect(result.items.some((item) => item.label === "$gte")).toBe(true);
  });
});
