import { describe, expect, it } from "vitest";
import { splitQualifiedIdentifier } from "./lexical";
import { cachedPhysicalNamespaceSupported, cachedCatalogNamespaceMatches } from "./namespace";
import { cachedSqlRelationsBeforeCursor } from "./relations";
import { cachedSqlProjectionSources } from "./projections";
describe("cached metadata namespace identity", () => {
  it.each([["remote.db.app.ledger", {
    server: "remote",
    database: "db",
    schema: "app",
    table: "ledger"
  }], ['[remote.dot].[db].[app].[order.items]', {
    server: "remote.dot",
    database: "db",
    schema: "app",
    table: "order.items"
  }], ['[rem]]ote].[db].[app].[ledger]', {
    server: "rem]ote",
    database: "db",
    schema: "app",
    table: "ledger"
  }], ['remote.db..ledger', {
    server: "remote",
    database: "db",
    schema: undefined,
    schemaOmitted: true,
    table: "ledger"
  }], ['remote...ledger', {
    server: "remote",
    schema: undefined,
    schemaOmitted: true,
    table: "ledger"
  }], ['db..ledger', {
    database: "db",
    schema: undefined,
    schemaOmitted: true,
    table: "ledger"
  }]])("retains every meaningful component of %s", (sql, expected) => {
    const relation = splitQualifiedIdentifier(sql)!;
    expect(relation).toEqual(expected);
    expect(cachedPhysicalNamespaceSupported(relation)).toBe(false);
    expect(cachedSqlRelationsBeforeCursor(`SELECT * FROM ${sql} r`)[0]).toMatchObject(expected);
  });
  it.each(["ledger", "app.ledger", "db.app.ledger"])("keeps supported local identities available: %s", sql => {
    expect(cachedPhysicalNamespaceSupported(splitQualifiedIdentifier(sql)!)).toBe(true);
    expect(cachedCatalogNamespaceMatches(sql, {
      databaseName: "db",
      schema: "app"
    })).toBe(true);
  });
  it.each(["remote.db.app.le", "other.le", "other.app.le", "db..le", "remote...le", "a.b.c.d.e"])("does not reuse a local catalog list for %s", fragment => {
    expect(cachedCatalogNamespaceMatches(fragment, {
      databaseName: "db",
      schema: "app"
    })).toBe(false);
  });
  it("does not silently truncate an unsupported five-part path", () => {
    expect(splitQualifiedIdentifier("a.b.c.d.e")).toBeNull();
    expect(cachedSqlRelationsBeforeCursor("SELECT * FROM a.b.c.d.e r")).toEqual([]);
  });
  it.each(["SELECT r.amount FROM remote.db.app.ledger r", "SELECT r.* FROM remote.db.app.ledger r", "SELECT r.amount FROM db..ledger r"])("withholds formatter provenance for unresolved namespaces: %s", sql => {
    expect(cachedSqlProjectionSources(sql, ["amount"])).toEqual([undefined]);
  });
});
