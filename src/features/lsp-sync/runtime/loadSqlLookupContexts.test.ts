import { beforeEach, describe, expect, it, vi } from "vitest";
const {
  getSqlLookupContext
} = vi.hoisted(() => ({
  getSqlLookupContext: vi.fn()
}));
vi.mock("@/services/tauri", () => ({
  schemaService: {
    getSqlLookupContext
  }
}));
import { loadSqlLookupContexts } from "./loadSqlLookupContexts";
import { lspCatalogKey, type LspCatalogTarget } from "@/services/lsp/syncPlan";
const catalog = (schemaName = "selected", database: string | null = "db"): LspCatalogTarget => ({
  catalogName: database,
  databaseName: null,
  schemaName
});
const options = (targetCatalogs = [catalog()]) => ({
  connectionId: "connection",
  dialect: "sqlserver",
  targetCatalogs,
  preferredTablesByCatalog: new Map([[lspCatalogKey(targetCatalogs[0]!), new Set(["ledger"])]])
});
describe("driver-confirmed SQL lookup context", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    getSqlLookupContext.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  it("loads the actual default schema instead of treating the selected schema as the default", async () => {
    getSqlLookupContext.mockResolvedValue({
      database: "db",
      defaultSchema: "sales"
    });
    const result = await loadSqlLookupContexts(options());
    expect(result.targetCatalogs.map(c => c.schemaName)).toEqual(["selected", "sales"]);
    for (const c of result.targetCatalogs) expect(result.namespaceFor(c)).toEqual({
      default_schema: "sales",
      tables_complete: false
    });
    expect(result.preferredTablesByCatalog.get(lspCatalogKey(catalog()))).toEqual(new Set(["ledger"]));
  });
  it("queries each database once and keeps their defaults isolated", async () => {
    getSqlLookupContext.mockImplementation(async (_id: string, database: string) => ({
      database,
      defaultSchema: database === "db" ? "sales" : "reporting"
    }));
    const result = await loadSqlLookupContexts(options([catalog(), catalog("other"), catalog("app", "remote")]));
    expect(getSqlLookupContext).toHaveBeenCalledTimes(2);
    expect(result.namespaceFor(catalog("app", "remote"))?.default_schema).toBe("reporting");
    expect(result.namespaceFor(catalog())?.default_schema).toBe("sales");
  });
  it("binds an unknown current catalog to the database confirmed by the live driver", async () => {
    getSqlLookupContext.mockResolvedValue({
      database: "live",
      defaultSchema: "dbo"
    });
    const original = catalog("selected", null),
      result = await loadSqlLookupContexts(options([original]));
    expect(getSqlLookupContext).toHaveBeenCalledWith("connection", null);
    expect(result.bindCatalog(original)).toEqual({
      catalogName: "live",
      databaseName: "live",
      schemaName: "selected"
    });
    expect(result.preferredTablesByCatalog.get(lspCatalogKey(result.bindCatalog(original)))).toEqual(new Set(["ledger"]));
  });
  it("does not invent context when an older driver returns null", async () => {
    getSqlLookupContext.mockResolvedValue(null);
    const result = await loadSqlLookupContexts(options());
    expect(result.targetCatalogs).toEqual([catalog()]);
    expect(result.namespaceFor(catalog())).toBeUndefined();
    expect(result.failures).toBe(0);
  });
  it("rejects wrong-database and malformed context without adding schema names", async () => {
    for (const context of [{
      database: "other",
      defaultSchema: "dbo"
    }, {
      database: "db",
      defaultSchema: ""
    }, {
      database: "db",
      defaultSchema: "bad\n"
    }, {
      database: 1,
      defaultSchema: "dbo"
    }, {}]) {
      getSqlLookupContext.mockResolvedValue(context);
      const result = await loadSqlLookupContexts(options());
      expect(result.targetCatalogs).toEqual([catalog()]);
      expect(result.namespaceFor(catalog())).toBeUndefined();
      expect(result.failures).toBe(1);
    }
  });
  it("treats a transport failure as unknown and records the limitation", async () => {
    getSqlLookupContext.mockRejectedValue(new Error("metadata failed"));
    const result = await loadSqlLookupContexts(options());
    expect(result.failures).toBe(1);
    expect(result.namespaceFor(catalog())).toBeUndefined();
  });
  it("rejects conflicting current/explicit contexts from the same database", async () => {
    getSqlLookupContext.mockImplementation(async (_id: string, database: string | null) => ({
      database: "db",
      defaultSchema: database === null ? "a" : "b"
    }));
    const result = await loadSqlLookupContexts(options([catalog("one", null), catalog("two", "db")]));
    expect(result.namespaceFor(catalog())).toBeUndefined();
    expect(result.targetCatalogs.map(c => c.schemaName)).toEqual(["one", "two"]);
    expect(result.failures).toBe(1);
  });
  it("does not apply SQL Server single-default semantics to other SQL dialects", async () => {
    const result = await loadSqlLookupContexts({
      ...options(),
      dialect: "postgres"
    });
    expect(getSqlLookupContext).not.toHaveBeenCalled();
    expect(result.namespaceFor(catalog())).toBeUndefined();
  });
  it("rechecks the driver on the next sync and never reuses an old default", async () => {
    getSqlLookupContext.mockResolvedValueOnce({
      database: "db",
      defaultSchema: "old"
    }).mockResolvedValueOnce({
      database: "db",
      defaultSchema: "new"
    });
    const first = await loadSqlLookupContexts(options()),
      second = await loadSqlLookupContexts(options());
    expect(first.namespaceFor(catalog())?.default_schema).toBe("old");
    expect(second.namespaceFor(catalog())?.default_schema).toBe("new");
  });
});
