import { describe, expect, it } from "vitest";
import {
  resultColumnGridId,
  resultColumnIndexByGridId,
} from "@/lib/gridColumns";

describe("query result column identities", () => {
  it("uses names for unique columns and ordinals for duplicate names", () => {
    const columns = [{ name: "id" }, { name: "email" }, { name: "id" }];

    expect(resultColumnGridId(columns, 0)).toBe(
      "__oxide_result_column_0:id"
    );
    expect(resultColumnGridId(columns, 1)).toBe("email");
    expect(resultColumnGridId(columns, 2)).toBe(
      "__oxide_result_column_2:id"
    );
  });

  it("maps reordered visual column ids back to the correct result ordinal", () => {
    const columns = [{ name: "id" }, { name: "id" }, { name: "name" }];

    expect(
      resultColumnIndexByGridId(columns, "__oxide_result_column_1:id")
    ).toBe(1);
    expect(
      resultColumnIndexByGridId(columns, "__oxide_result_column_0:id")
    ).toBe(0);
    expect(resultColumnIndexByGridId(columns, "name")).toBe(2);
  });
});
