import { describe, expect, it } from "vitest";
import type { DatabaseDataModel } from "@/services/tauri/types";
import { shouldShowConnectionUrl } from "./connectionFormVisibility";

describe("connection form visibility", () => {
  it("keeps the generated transport URL internal for queue packages", () => {
    expect(shouldShowConnectionUrl("queue")).toBe(false);
  });

  it.each<DatabaseDataModel>([
    "relational",
    "document",
    "keyValue",
    "search",
    "graph",
    "wideColumn",
    "timeSeries",
    "coordination",
  ])("keeps the URL editor available for %s connections", (dataModel) => {
    expect(shouldShowConnectionUrl(dataModel)).toBe(true);
  });
});
