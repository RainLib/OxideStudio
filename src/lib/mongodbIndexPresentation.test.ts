import { describe, expect, it } from "vitest";
import { mongodbIndexPresentation } from "./mongodbIndexPresentation";

describe("mongodbIndexPresentation", () => {
  it("exposes MongoDB-only index hints from the preserved definition", () => {
    expect(
      mongodbIndexPresentation({
        definition: JSON.stringify({
          expireAfterSeconds: 3600,
          hidden: true,
          sparse: true,
          partialFilterExpression: { state: "active" },
        }),
      }),
    ).toEqual({
      expireAfterSeconds: 3600,
      isHidden: true,
      isSparse: true,
      hasPartialFilter: true,
    });
  });

  it("fails closed for absent or malformed driver definitions", () => {
    expect(mongodbIndexPresentation({ definition: "not json" })).toEqual({
      expireAfterSeconds: null,
      isHidden: false,
      isSparse: false,
      hasPartialFilter: false,
    });
    expect(
      mongodbIndexPresentation({
        definition: JSON.stringify({ expireAfterSeconds: -1 }),
      }),
    ).toMatchObject({ expireAfterSeconds: null });
  });
});
