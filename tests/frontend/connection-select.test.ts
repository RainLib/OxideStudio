import { describe, expect, it } from "vitest";
import { filterConnectionOptions } from "@/components/connection/ConnectionSelect";

describe("ConnectionSelect", () => {
  const connections = [
    { id: "warehouse", name: "Warehouse 10", driver: "postgres", tags: ["production"] },
    { id: "local", name: "Local cache", driver: "sqlite", tags: ["development"] },
  ] as never;

  it("searches by connection name, driver, and tags with stable display order", () => {
    expect(filterConnectionOptions(connections, "prod").map((item) => item.id)).toEqual(["warehouse"]);
    expect(filterConnectionOptions(connections, "sql").map((item) => item.id)).toEqual(["local"]);
    expect(filterConnectionOptions(connections, "").map((item) => item.id)).toEqual(["local", "warehouse"]);
  });
});
