import { describe, expect, it } from "vitest";
import {
  createProjectDdlSnapshot,
  isProjectDdlSnapshot,
  parseProjectDdl,
  projectDdlSnapshotSources,
} from "@/features/schema-diff/model/projectDdlSnapshot";

describe("project DDL schema snapshot", () => {
  it("captures portable tables, constraints, and standalone indexes for review", () => {
    const parsed = parseProjectDdl(
      `
        CREATE TABLE public.users (
          id bigint PRIMARY KEY,
          email varchar(320) NOT NULL UNIQUE,
          role text DEFAULT 'member'
        );
        CREATE TABLE public.orders (
          id bigint NOT NULL,
          user_id bigint NOT NULL
        );
        ALTER TABLE public.orders ADD CONSTRAINT orders_pkey PRIMARY KEY (id);
        ALTER TABLE public.orders ADD CONSTRAINT orders_user_fkey FOREIGN KEY (user_id) REFERENCES public.users (id);
        CREATE INDEX orders_user_idx ON public.orders (user_id DESC);
      `,
      "public",
    );

    expect(parsed.warnings).toEqual([]);
    expect(parsed.relations.map((relation) => relation.name)).toEqual([
      "public.orders",
      "public.users",
    ]);
    const orders = parsed.relations[0]!;
    expect(orders.columns.find((column) => column.name === "id")?.is_primary_key).toBe(true);
    expect(orders.indexes).toContainEqual(expect.objectContaining({ name: "orders_user_idx", columns: ["user_id"] }));
    expect(orders.constraints).toContainEqual(expect.objectContaining({ constraint_type: "FOREIGN KEY", referenced_schema: "public", referenced_table: "users" }));
  });

  it("marks project DDL snapshots as review-only and records parser limitations", () => {
    const snapshot = createProjectDdlSnapshot(
      {
        projectId: "project-1",
        connectionId: "postgres-1",
        connectionName: "Postgres",
        driver: "postgres",
        schemaName: "public",
      },
      "db/schema.sql",
      "CREATE VIEW active_users AS SELECT * FROM users;",
      1,
    );

    expect(isProjectDdlSnapshot(snapshot)).toBe(true);
    expect(snapshot.warnings).toContain("Source: db/schema.sql");
    expect(snapshot.warnings.join(" ")).toContain("No supported CREATE TABLE");
    expect(snapshot.id).toMatch(/^project-ddl-1-offline-/);
  });

  it("records every bounded source file in a deterministic aggregate baseline", () => {
    const first = createProjectDdlSnapshot(
      {
        projectId: "project-1",
        connectionId: "postgres-1",
        connectionName: "Postgres",
        driver: "postgres",
        schemaName: "public",
      },
      ["db/tables.sql", "db/indexes.sql"],
      "CREATE TABLE users (id bigint PRIMARY KEY); CREATE INDEX users_id_idx ON users (id);",
      1,
    );
    const second = createProjectDdlSnapshot(
      {
        projectId: "project-1",
        connectionId: "postgres-1",
        connectionName: "Postgres",
        driver: "postgres",
        schemaName: "public",
      },
      ["db/indexes.sql", "db/tables.sql"],
      "CREATE TABLE users (id bigint PRIMARY KEY); CREATE INDEX users_id_idx ON users (id);",
      1,
    );

    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.warnings).toEqual(expect.arrayContaining([
      "Source: db/indexes.sql",
      "Source: db/tables.sql",
    ]));
    expect(projectDdlSnapshotSources(first)).toEqual([
      "db/indexes.sql",
      "db/tables.sql",
    ]);
  });

  it("resolves an ALTER TABLE constraint after its table appears in another source", () => {
    const parsed = parseProjectDdl(
      `
        ALTER TABLE public.orders ADD CONSTRAINT orders_customer_fkey
          FOREIGN KEY (customer_id) REFERENCES public.customers (id);
        CREATE TABLE public.orders (id bigint PRIMARY KEY, customer_id bigint NOT NULL);
      `,
      "public",
    );

    expect(parsed.warnings).toEqual([]);
    expect(parsed.relations[0]?.constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "orders_customer_fkey",
        constraint_type: "FOREIGN KEY",
        referenced_schema: "public",
        referenced_table: "customers",
      }),
    ]));
  });
});
