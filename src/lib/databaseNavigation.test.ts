import { describe, expect, it } from "vitest";
import {
  databaseObjectNavigationKey,
  databaseSchemaNavigationKey,
  parseDatabaseObjectNavigationKey,
  parseDatabaseSchemaNavigationKey,
} from "./databaseNavigation";

describe("database navigation keys", () => {
  it("round-trips database, schema, and object names containing delimiters", () => {
    const schemaKey = databaseSchemaNavigationKey({
      connectionId: "connection:1",
      databaseName: "sales/eu",
      schemaName: "team:a",
    });
    expect(parseDatabaseSchemaNavigationKey(schemaKey)).toEqual({
      connectionId: "connection:1",
      databaseName: "sales/eu",
      schemaName: "team:a",
    });

    const objectKey = databaseObjectNavigationKey({
      connectionId: "connection:1",
      databaseName: "sales/eu",
      schemaName: "team:a",
      objectName: "orders:2026",
    });
    expect(parseDatabaseObjectNavigationKey(objectKey)).toEqual({
      connectionId: "connection:1",
      databaseName: "sales/eu",
      schemaName: "team:a",
      objectName: "orders:2026",
    });
  });

  it("rejects malformed, truncated, or targetless keys", () => {
    expect(parseDatabaseSchemaNavigationKey("connection:schema")).toBeNull();
    expect(parseDatabaseSchemaNavigationKey("%zz::schema")).toBeNull();
    expect(parseDatabaseObjectNavigationKey("connection:::")).toBeNull();
  });
});
