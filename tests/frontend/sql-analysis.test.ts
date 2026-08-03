import { describe, expect, it } from "vitest";
import {
  extractRelationReferences,
  extractSchemaContextChange,
  metadataRefreshNamespaces,
  normalizeSqlPlaceholders,
  queryMayChangeMetadata,
  sqlPlaceholderSpans,
  splitSqlStatements,
} from "@/lib/sqlAnalysis";

describe("SQL analysis helpers", () => {
  it("splits statements without breaking quoted bodies", () => {
    expect(
      splitSqlStatements(`
        SELECT ';' AS semi;
        CREATE FUNCTION app.demo() RETURNS void AS $$
        BEGIN
          RAISE NOTICE 'hello;world';
        END;
        $$ LANGUAGE plpgsql;
      `)
    ).toHaveLength(2);
  });

  it("detects metadata-changing statements without trusting quoted text", () => {
    expect(
      queryMayChangeMetadata("SELECT 'DROP TABLE users' AS example", null)
    ).toBe(false);
    expect(
      queryMayChangeMetadata("/* planned migration */ CREATE TABLE app.users(id INT)", null)
    ).toBe(true);
    expect(
      queryMayChangeMetadata("SELECT 1", [{ statementType: "CREATE" }])
    ).toBe(true);
  });

  it("extracts the last explicit schema context change", () => {
    expect(extractSchemaContextChange("USE `app-db`;")).toBe("app-db");
    expect(
      extractSchemaContextChange(
        'USE staging; SET search_path TO "$user", "analytics", public;'
      )
    ).toBe("analytics");
    expect(extractSchemaContextChange("SET SCHEMA 'reporting';")).toBe(
      "reporting"
    );
  });

  it("extracts relation references across common SQL forms", () => {
    expect(
      extractRelationReferences(
        `
          SELECT u.id FROM "app"."users" u
          JOIN orders o ON o.user_id = u.id;
          UPDATE \`sales\`.\`orders\` SET status = 'paid';
          INSERT INTO [dbo].[audit_log] (id) VALUES (1);
          SELECT * FROM [warehouse].[reporting].[monthly.sales];
          CREATE INDEX idx_events_id ON public.events (id);
        `,
        "postgres"
      )
    ).toEqual([
      { schema: "app", table: "users" },
      { database: "warehouse", schema: "reporting", table: "monthly.sales" },
      { table: "orders" },
      { schema: "sales", table: "orders" },
      { schema: "dbo", table: "audit_log" },
      { schema: "public", table: "events" },
    ]);
  });

  it("does not treat common table expressions as physical relations", () => {
    expect(
      extractRelationReferences(
        `
          WITH recent AS (
            SELECT * FROM app.orders
          ),
          ranked AS NOT MATERIALIZED (
            SELECT * FROM recent
          )
          SELECT * FROM ranked
          JOIN public.users ON users.id = ranked.user_id;
        `,
        "postgres"
      )
    ).toEqual([
      { schema: "app", table: "orders" },
      { schema: "public", table: "users" },
    ]);
  });

  it("ignores relation-looking tokens inside comments and strings", () => {
    expect(
      extractRelationReferences(`
        -- FROM ignored.comment_table
        SELECT 'join ignored.string_table' AS sample
        FROM real_table;
      `)
    ).toEqual([{ table: "real_table" }]);
  });

  it("selects metadata refresh namespaces from explicit relation schemas", () => {
    expect(
      metadataRefreshNamespaces(
        `
          CREATE TABLE analytics.events(id INT);
          CREATE INDEX idx_audit_id ON audit.events(id);
        `,
        "public",
        "postgres"
      )
    ).toEqual(["analytics", "audit"]);

    expect(
      metadataRefreshNamespaces("ALTER TABLE users ADD COLUMN name TEXT", "public")
    ).toEqual(["public"]);
  });

  it("normalizes supported placeholders without changing offsets", () => {
    const sql =
      "SELECT '😀', $1, ?, ?1, @id, :id, {{id}}, ${id}, %(id)s FROM users";
    const normalized = normalizeSqlPlaceholders(sql);

    expect(sqlPlaceholderSpans(sql).map((span) => sql.slice(span.start, span.end))).toEqual([
      "$1",
      "?",
      "?1",
      "@id",
      ":id",
      "{{id}}",
      "${id}",
      "%(id)s",
    ]);
    expect(normalized).toHaveLength(sql.length);
    expect(normalized.indexOf("FROM users")).toBe(sql.indexOf("FROM users"));
  });

  it("does not normalize placeholder-like text in protected SQL regions", () => {
    const sql = `
      SELECT ':id', "{{column}}", \`@column\`, [${"${column}"}], payload ?| array['x'];
      -- :line_comment
      # @hash_comment
      /* {{block_comment}} /* ${"${nested}"} */ */
      DO $body$ BEGIN RAISE NOTICE '%(inside)s'; END $body$;
      SELECT :outside;
    `;

    expect(sqlPlaceholderSpans(sql).map((span) => sql.slice(span.start, span.end))).toEqual([
      ":outside",
    ]);
  });

  it("does not mistake PostgreSQL casts or SQL Server globals for parameters", () => {
    const sql = "SELECT value::text, @@ROWCOUNT, :outside, @named";

    expect(sqlPlaceholderSpans(sql).map((span) => sql.slice(span.start, span.end))).toEqual([
      ":outside",
      "@named",
    ]);
  });

  it("distinguishes PostgreSQL JSON question operators from bind placeholders", () => {
    const sql =
      "SELECT payload ? 'enabled', payload ? :key, ? AS supplied FROM events WHERE id = ?";

    expect(
      sqlPlaceholderSpans(sql, "postgres").map((span) =>
        sql.slice(span.start, span.end)
      )
    ).toEqual([":key", "?", "?"]);
  });

  it("does not treat PostgreSQL JSON hash operators as comments", () => {
    const sql =
      "SELECT payload #> :path, payload #>> :text_path, payload #- :remove_path FROM events";

    expect(
      sqlPlaceholderSpans(sql, "postgres").map((span) =>
        sql.slice(span.start, span.end)
      )
    ).toEqual([":path", ":text_path", ":remove_path"]);
  });

  it("keeps MySQL hash comments dialect-specific", () => {
    const sql = "#> comment :inside\nSELECT :outside";

    expect(
      sqlPlaceholderSpans(sql, "mysql").map((span) =>
        sql.slice(span.start, span.end)
      )
    ).toEqual([":outside"]);
  });

  it("keeps static relation inference around identifier placeholders", () => {
    expect(
      extractRelationReferences(
        "SELECT {{column}} FROM {{schema}}.users u WHERE u.id = :id",
        "postgres"
      )
    ).toEqual([{ table: "users" }]);
    expect(extractRelationReferences("SELECT * FROM public.{{table}}", "postgres")).toEqual(
      []
    );
  });

  it("keeps CTE names out of relation metadata while retaining catalog-qualified relations", () => {
    expect(
      extractRelationReferences(
        "WITH orders AS (SELECT * FROM archive.sales.orders) SELECT * FROM orders JOIN live.public.customers c ON true",
        "postgres",
      ),
    ).toEqual([
      { database: "archive", schema: "sales", table: "orders" },
      { database: "live", schema: "public", table: "customers" },
    ]);
  });
});
