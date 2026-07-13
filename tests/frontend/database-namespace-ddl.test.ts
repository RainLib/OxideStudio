import { describe, expect, it } from "vitest";
import { createNamespaceDdl } from "@/lib/databaseNamespaceDdl";

describe("database namespace DDL preview", () => {
  it("previews PostgreSQL schemas with safely quoted authorization", () => {
    expect(
      createNamespaceDdl({
        driver: "postgres",
        name: "app data",
        owner: 'app "owner"',
      })
    ).toBe('CREATE SCHEMA "app data" AUTHORIZATION "app ""owner""";');
  });

  it("previews MySQL databases with optional charset settings", () => {
    expect(
      createNamespaceDdl({ driver: "mysql", name: "app-data" })
    ).toBe("CREATE DATABASE `app-data`;");
    expect(
      createNamespaceDdl({
        driver: "mysql",
        name: "app",
        charset: "utf8mb4",
        collation: "utf8mb4_unicode_ci",
      })
    ).toBe(
      "CREATE DATABASE `app`\n  CHARACTER SET utf8mb4\n  COLLATE utf8mb4_unicode_ci;"
    );
  });
});
