import { describe, expect, it } from "vitest";
import {
  createProjectDdlSnapshot,
  detectProjectDdlDialect,
  parseProjectDdl,
} from "./projectDdlSnapshot";

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

  it.each([
    ["postgres", "CREATE TABLE events (payload JSONB);"],
    ["mysql", "CREATE TABLE `users` (`id` bigint AUTO_INCREMENT) ENGINE=InnoDB;"],
    ["sqlserver", "CREATE TABLE [dbo].[users] ([id] bigint IDENTITY(1,1));\nGO"],
    ["sqlite", "CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT);"],
    ["oracle", "CREATE TABLE users (id NUMBER(10), name VARCHAR2(100));\n/"],
  ] as const)("detects %s DDL markers", (dialect, sql) => {
    expect(detectProjectDdlDialect(sql)).toMatchObject({ dialect });
  });

  it("keeps portable DDL generic when no dialect marker is present", () => {
    expect(detectProjectDdlDialect("CREATE TABLE users (id bigint);")).toEqual({
      dialect: "generic",
      confidence: "low",
      evidence: [],
    });
  });

  it("parses SQL Server batches, quoted identifiers, identity and multiword types", () => {
    const parsed = parseProjectDdl(
      `
        CREATE TABLE [dbo].[accounts] (
          [id] bigint IDENTITY(1,1) PRIMARY KEY,
          [display_name] nvarchar(200) NOT NULL,
          [created_at] datetime2 DEFAULT sysdatetime()
        )
        GO
        CREATE UNIQUE INDEX [accounts_display_name_uq]
          ON [dbo].[accounts] ([display_name]);
      `,
      "dbo",
    );

    expect(parsed.dialect).toBe("sqlserver");
    expect(parsed.relations[0]?.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "id", is_auto_increment: true }),
        expect.objectContaining({ name: "display_name", data_type: "nvarchar(200)" }),
        expect.objectContaining({ name: "created_at", data_type: "datetime2" }),
      ]),
    );
    expect(parsed.relations[0]?.indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "accounts_display_name_uq", is_unique: true }),
      ]),
    );
  });

  it("parses MySQL inline indexes, prefix lengths and table options", () => {
    const parsed = parseProjectDdl(
      `
        CREATE TABLE \`users\` (
          \`id\` bigint unsigned NOT NULL AUTO_INCREMENT,
          \`email\` varchar(320) NOT NULL,
          \`display_name\` varchar(255),
          PRIMARY KEY (\`id\`),
          UNIQUE KEY \`users_email_uq\` (\`email\`),
          KEY \`users_display_name_idx\` (\`display_name\`(24)) USING BTREE
        ) ENGINE=InnoDB;
      `,
      "",
    );

    const relation = parsed.relations[0];
    expect(parsed.dialect).toBe("mysql");
    expect(relation?.columns.find((column) => column.name === "id")).toMatchObject({
      data_type: "bigint unsigned",
      is_auto_increment: true,
    });
    expect(relation?.indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "users_email_uq", is_unique: true }),
        expect.objectContaining({
          name: "users_display_name_idx",
          columns: ["display_name"],
          index_type: "BTREE",
        }),
      ]),
    );
    expect(relation?.columns.find((column) => column.name === "display_name")?.is_indexed).toBe(true);
  });

  it("parses SQLite autoincrement keys", () => {
    const parsed = parseProjectDdl(
      "CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL);",
      "main",
    );
    expect(parsed.dialect).toBe("sqlite");
    expect(parsed.relations[0]?.columns[0]).toMatchObject({
      name: "id",
      data_type: "INTEGER",
      is_primary_key: true,
      is_auto_increment: true,
    });
  });

  it("parses Oracle precision types and slash terminators", () => {
    const parsed = parseProjectDdl(
      `
        CREATE TABLE customers (
          id NUMBER(10) PRIMARY KEY,
          credit_limit NUMBER(12, 2) DEFAULT 0,
          display_name VARCHAR2(120) NOT NULL
        );
        /
      `,
      "APP",
    );
    expect(parsed.dialect).toBe("oracle");
    expect(parsed.relations[0]?.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "credit_limit", data_type: "NUMBER(12, 2)" }),
        expect.objectContaining({ name: "display_name", data_type: "VARCHAR2(120)" }),
      ]),
    );
  });

  it("parses PostgreSQL multiword types, casts and inline references", () => {
    const parsed = parseProjectDdl(
      `
        CREATE TABLE public.roles (id bigint PRIMARY KEY);
        CREATE TABLE public.users (
          id bigserial PRIMARY KEY,
          role_id bigint REFERENCES public.roles(id),
          preferences jsonb DEFAULT '{}'::jsonb,
          created_at timestamp with time zone NOT NULL
        );
      `,
      "public",
    );
    const users = parsed.relations.find((relation) => relation.name === "users");
    expect(parsed.dialect).toBe("postgres");
    expect(users?.columns.find((column) => column.name === "created_at")?.data_type).toBe(
      "timestamp with time zone",
    );
    expect(users?.columns.find((column) => column.name === "preferences")?.default_value).toBe(
      "'{}'::jsonb",
    );
    expect(users?.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          constraint_type: "FOREIGN KEY",
          columns: ["role_id"],
          referenced_schema: "public",
          referenced_table: "roles",
          referenced_columns: ["id"],
        }),
      ]),
    );
  });

  it("imports views as review-only relations with conservatively inferred columns", () => {
    const parsed = parseProjectDdl(
      `
        CREATE VIEW public.active_users (user_id, display_name) AS
          SELECT id, name FROM public.users WHERE active = true;
        CREATE MATERIALIZED VIEW public.account_totals AS
          SELECT account_id, sum(amount) AS total FROM public.entries GROUP BY account_id;
        CREATE VIEW public.all_users AS SELECT * FROM public.users;
      `,
      "public",
      "postgres",
    );

    expect(parsed.relations.find((relation) => relation.name === "active_users")).toMatchObject({
      objectType: "VIEW",
      columns: [
        expect.objectContaining({ name: "user_id", data_type: "UNKNOWN" }),
        expect.objectContaining({ name: "display_name", data_type: "UNKNOWN" }),
      ],
    });
    expect(parsed.relations.find((relation) => relation.name === "account_totals")).toMatchObject({
      objectType: "MATERIALIZED VIEW",
      columns: [
        expect.objectContaining({ name: "account_id" }),
        expect.objectContaining({ name: "total" }),
      ],
    });
    expect(parsed.relations.find((relation) => relation.name === "all_users")?.columns).toEqual([]);
    expect(parsed.warnings).toContain(
      "View all_users has no safely inferable columns; its relation descriptor remains review-only.",
    );
  });

  it.each([
    [
      "oracle",
      "APP",
      "CREATE OR REPLACE FORCE EDITIONABLE VIEW APP.active_users AS SELECT id AS user_id FROM APP.users",
    ],
    [
      "mysql",
      "app",
      "CREATE ALGORITHM=MERGE DEFINER=root@localhost SQL SECURITY DEFINER VIEW app.active_users AS SELECT id AS user_id FROM app.users",
    ],
    [
      "sqlserver",
      "dbo",
      "CREATE OR ALTER VIEW dbo.active_users WITH SCHEMABINDING AS SELECT id AS user_id FROM dbo.users",
    ],
  ] as const)("accepts %s view modifiers", (dialect, schema, sql) => {
    const parsed = parseProjectDdl(sql, schema, dialect);
    expect(parsed.relations).toEqual([
      expect.objectContaining({
        name: "active_users",
        objectType: "VIEW",
        columns: [expect.objectContaining({ name: "user_id" })],
      }),
    ]);
  });

  it("preserves enum types and sequences as descriptor-only schema objects", () => {
    const parsed = parseProjectDdl(
      `
        CREATE TYPE public.order_status AS ENUM ('draft', 'in_progress', 'it''s done');
        CREATE SEQUENCE public.order_number_seq START WITH 100 INCREMENT BY 5;
        CREATE TABLE public.orders (
          id bigint DEFAULT nextval('public.order_number_seq'),
          status public.order_status NOT NULL
        );
      `,
      "public",
      "postgres",
    );

    expect(parsed.schemaObjects).toEqual([
      {
        name: "order_status",
        objectType: "ENUM TYPE",
        description: "Values: 'draft', 'in_progress', 'it''s done'",
      },
      { name: "order_number_seq", objectType: "SEQUENCE" },
    ]);
    expect(parsed.relations[0]?.columns.find((column) => column.name === "status")?.data_type)
      .toBe("public.order_status");
  });

  it("flags generated expressions without treating them as defaults", () => {
    const parsed = parseProjectDdl(
      `CREATE TABLE line_items (
        quantity integer NOT NULL,
        unit_price numeric(12, 2) NOT NULL,
        total numeric(12, 2) GENERATED ALWAYS AS (quantity * unit_price) STORED
      );`,
      "public",
      "postgres",
    );
    const total = parsed.relations[0]?.columns.find((column) => column.name === "total");
    expect(total).toMatchObject({ data_type: "numeric(12, 2)" });
    expect(total?.default_value).toBeUndefined();
    expect(parsed.warnings).toContain(
      "Generated expression on line_items.total was recognized but omitted because snapshots cannot preserve executable expressions safely.",
    );
  });

  it("includes descriptor-only schema objects in the offline fingerprint", () => {
    const identity = {
      projectId: "project",
      connectionId: "connection",
      connectionName: "Local",
      driver: "postgres" as const,
      schemaName: "public",
    };
    const first = createProjectDdlSnapshot(
      identity,
      "schema.sql",
      "CREATE TYPE state AS ENUM ('open'); CREATE TABLE jobs (id bigint);",
      1,
    );
    const second = createProjectDdlSnapshot(
      identity,
      "schema.sql",
      "CREATE TYPE state AS ENUM ('open', 'closed'); CREATE TABLE jobs (id bigint);",
      1,
    );
    expect(first.fingerprint).not.toBe(second.fingerprint);
    expect(first.schemaObjects).toHaveLength(1);
  });

  it("uses the connection driver as the portable DDL preference", () => {
    const snapshot = createProjectDdlSnapshot(
      {
        projectId: "project",
        connectionId: "connection",
        connectionName: "Local",
        driver: "oracle",
        schemaName: "APP",
      },
      "portable.sql",
      "CREATE TABLE users (id bigint PRIMARY KEY);",
      1,
    );
    expect(snapshot.warnings).toContain("DDL dialect: oracle");
  });

  it("ignores dialect markers inside comments", () => {
    const detection = detectProjectDdlDialect(`
      -- AUTO_INCREMENT ENGINE=InnoDB
      /* CREATE TABLE [dbo].[fake] (id bigint IDENTITY(1,1)); */
      CREATE TABLE users (id bigint);
    `);
    expect(detection).toEqual({
      dialect: "generic",
      confidence: "low",
      evidence: [],
    });
  });

  it("preserves comment-like text and delimiters inside quoted defaults", () => {
    const parsed = parseProjectDdl(
      `
        CREATE TABLE messages (
          id bigint PRIMARY KEY,
          subject varchar(200) DEFAULT 'keep -- text',
          body text DEFAULT 'keep /* text */ and ; commas, too'
        );
      `,
      "public",
    );
    expect(parsed.relations[0]?.columns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "subject",
          default_value: "'keep -- text'",
        }),
        expect.objectContaining({
          name: "body",
          default_value: "'keep /* text */ and ; commas, too'",
        }),
      ]),
    );
  });

  it("keeps PostgreSQL dollar-quoted bodies within one ignored statement", () => {
    const parsed = parseProjectDdl(
      `
        CREATE FUNCTION public.touch_updated_at() RETURNS trigger AS $body$
        BEGIN
          NEW.updated_at := now();
          RETURN NEW;
        END;
        $body$ LANGUAGE plpgsql;

        CREATE TABLE public.items (
          id bigint PRIMARY KEY,
          marker text DEFAULT $$semi;colon -- still text$$
        );
      `,
      "public",
      "postgres",
    );
    expect(parsed.relations).toHaveLength(1);
    expect(parsed.relations[0]?.columns.find((column) => column.name === "marker"))
      .toMatchObject({ default_value: "$$semi;colon -- still text$$" });
    expect(parsed.warnings.filter((warning) => warning.includes("Unsupported CREATE")))
      .toHaveLength(1);
  });
});
