import { describe, expect, it } from "vitest";
import {
  buildMongoDbConsoleCompletions,
  mongodbConsoleCompletionContext,
  shouldOfferMongoDbCompletions,
  shouldTriggerMongoDbCompletions,
} from "@/lib/mongodbCompletion";

describe("MongoDB JSON Console completion", () => {
  it("offers only native JSON command templates at a command root", () => {
    const source = '{\n  "';
    const result = buildMongoDbConsoleCompletions(source, source.length);

    expect(result.context.area).toBe("root");
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "find",
          insertText: expect.stringContaining('"find"'),
        }),
        expect.objectContaining({ label: "aggregate" }),
        expect.objectContaining({ label: "updateOne" }),
      ]),
    );
    expect(result.items.map((item) => item.insertText).join("\n")).not.toContain(
      "db.",
    );
  });

  it("uses loaded collections for the strict find, aggregate, and count aliases", () => {
    const source = '{ "find": "ord';
    const result = buildMongoDbConsoleCompletions(source, source.length, {
      collections: ["audit_log", "orders", "orders_archive"],
    });

    expect(result.context).toMatchObject({ area: "collection", activeKey: "find" });
    expect(result.items.map((item) => item.label)).toEqual([
      "orders",
      "orders_archive",
    ]);
  });

  it("scopes sampled fields and query operators to a filter document", () => {
    const fieldSource = '{ "find": "orders", "filter": { "sta';
    const fields = buildMongoDbConsoleCompletions(fieldSource, fieldSource.length, {
      fields: [
        { name: "createdAt", dataType: "date" },
        { name: "status", dataType: "string" },
      ],
    });
    expect(fields.context).toMatchObject({
      area: "field",
      collection: "orders",
    });
    expect(fields.items).toEqual([
      expect.objectContaining({ label: "status", detail: "string" }),
    ]);

    const operatorSource = '{ "find": "orders", "filter": { "$g';
    const operators = buildMongoDbConsoleCompletions(
      operatorSource,
      operatorSource.length,
    );
    expect(operators.context.area).toBe("query-operator");
    expect(operators.items.map((item) => item.label)).toEqual(
      expect.arrayContaining(["$gt", "$gte"]),
    );
  });

  it("distinguishes update operators and aggregation stages", () => {
    const update = '{ "collection": "orders", "updateOne": { "update": { "$';
    expect(
      buildMongoDbConsoleCompletions(update, update.length).context.area,
    ).toBe("update-operator");

    const pipeline = '{ "aggregate": "orders", "pipeline": [ { "$';
    const result = buildMongoDbConsoleCompletions(pipeline, pipeline.length);
    expect(result.context.area).toBe("pipeline-stage");
    expect(result.items.map((item) => item.label)).toEqual(
      expect.arrayContaining(["$match", "$group", "$lookup"]),
    );
  });

  it("opens automatically for semantic positions but not arbitrary values", () => {
    const root = '{ "';
    expect(shouldOfferMongoDbCompletions(root, root.length)).toBe(true);
    expect(shouldTriggerMongoDbCompletions(root, root.length, '"')).toBe(true);

    const value = '{ "find": "orders", "limit": 1';
    expect(
      mongodbConsoleCompletionContext(value, value.length).area,
    ).toBe("value");
    expect(shouldOfferMongoDbCompletions(value, value.length)).toBe(false);
  });
});
