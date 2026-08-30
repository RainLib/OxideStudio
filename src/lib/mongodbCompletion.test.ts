import { describe, expect, it } from "vitest";
import {
  buildMongoDbConsoleCompletions,
  mongodbConsoleCompletionContext,
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
});
