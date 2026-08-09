import { describe, expect, it } from "vitest";
import { createProjectDdlSnapshot, parseProjectDdl } from "./projectDdlSnapshot";

describe("project DDL snapshot", () => {
  it("normalizes same-schema qualified relation names to live snapshot names", () => {
    const parsed = parseProjectDdl(
      'CREATE TABLE "public"."users" ("id" bigint PRIMARY KEY);',
      "public",
    );
    expect(parsed.relations[0]?.name).toBe("users");
  });

  it("preserves referenced schema separately from the relation name", () => {
    const snapshot = createProjectDdlSnapshot(
      {
        projectId: "project",
        connectionId: "connection",
        connectionName: "Local",
        driver: "postgres",
        schemaName: "public",
      },
      "schema.sql",
      `
        CREATE TABLE public.users (id bigint PRIMARY KEY);
        CREATE TABLE public.orders (
          id bigint PRIMARY KEY,
          user_id bigint,
          CONSTRAINT orders_user_fk FOREIGN KEY (user_id)
            REFERENCES public.users(id)
        );
      `,
      1,
    );
    const foreignKey = snapshot.relations
      .find((relation) => relation.name === "orders")
      ?.constraints.find((constraint) => constraint.constraint_type === "FOREIGN KEY");
    expect(foreignKey).toMatchObject({
      referenced_schema: "public",
      referenced_table: "users",
    });
  });
});
