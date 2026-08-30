import { describe, expect, it } from "vitest";
import {
  MONGODB_DATABASE_INITIALIZATION_COLLECTION,
  mongoCreateDatabasePreview,
} from "./databaseNamespaceDdl";

describe("mongoCreateDatabasePreview", () => {
  it("renders the same bounded native command used by the MongoDB driver", () => {
    expect(JSON.parse(mongoCreateDatabasePreview(" reporting "))).toEqual({
      database: "reporting",
      command: { create: MONGODB_DATABASE_INITIALIZATION_COLLECTION },
    });
  });

  it("does not interpolate a database name into Mongo shell source", () => {
    const preview = mongoCreateDatabasePreview('reporting"; dropDatabase()');
    expect(preview).not.toContain("db.getSiblingDB");
    expect(JSON.parse(preview).database).toBe('reporting"; dropDatabase()');
  });
});
