import { describe, expect, it } from "vitest";
import {
  mongodbCompletionArea,
  shouldOfferMongoDbCompletions,
  shouldTriggerMongoDbCompletions,
} from "@/lib/mongodbCompletion";

describe("MongoDB editor completion triggers", () => {
  it.each([
    ['{"', "key"],
    ['{"collection":"', "collection"],
    ['{"find":"us', "collection"],
    ['{"collection":"users","filter":{"em', "key"],
    ['{"collection":"users","filter":{"email":"ad', "value"],
  ] as const)("classifies %s as %s", (source, area) => {
    expect(mongodbCompletionArea(source, source.length)).toBe(area);
  });

  it("opens automatically for keys and collection names, not literal values", () => {
    const field = '{"collection":"users","filter":{"em';
    const collection = '{"collection":"us';
    const literal = '{"collection":"users","filter":{"email":"ad';

    expect(shouldTriggerMongoDbCompletions(field, field.length, "m")).toBe(true);
    expect(
      shouldTriggerMongoDbCompletions(collection, collection.length, "s"),
    ).toBe(true);
    expect(
      shouldTriggerMongoDbCompletions(literal, literal.length, "d"),
    ).toBe(false);
    expect(shouldOfferMongoDbCompletions(literal, literal.length)).toBe(false);
  });
});
