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
