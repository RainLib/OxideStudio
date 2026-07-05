import { describe, expect, it } from "vitest";
import {
  extractRelationReferences,
  extractSchemaContextChange,
  queryMayChangeMetadata,
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
          CREATE INDEX idx_events_id ON public.events (id);
        `,
        "postgres"
      )
    ).toEqual([
      { schema: "app", table: "users" },
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
});
