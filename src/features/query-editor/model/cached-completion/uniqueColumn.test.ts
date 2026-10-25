import { describe, expect, it, vi } from "vitest";
import { currentTopLevelStatementAtCursor } from "./lexical";
import { cachedSqlFieldBindings, cachedSqlRelationForFieldCompletion } from "./relations";
import { uniqueCachedColumn } from "./uniqueColumn";
import type { CachedColumnSet } from "./metadataSearch";
const amount = {
    name: "amount",
    dataType: "decimal",
    comment: "Revenue"
  },
  id = {
    name: "id",
    dataType: "bigint"
  };
function fixture(marked: string, rows: Record<string, CachedColumnSet> = {
  ledger: {
    columns: [amount],
    complete: true
  },
  users: {
    columns: [id],
    complete: true
  }
}) {
  const cursor = marked.indexOf("<cursor>"),
    source = marked.replace("<cursor>", ""),
    statement = currentTopLevelStatementAtCursor(source, cursor);
  const view = cachedSqlFieldBindings(statement),
    read = vi.fn(async (relation: {
      table: string;
    }): Promise<CachedColumnSet> => rows[relation.table] ?? {
      columns: [],
      complete: false
    }),
    onIncomplete = vi.fn();
  return {
    read,
    view,
    statement,
    onIncomplete,
    resolve: (sql = "amount", token = {}) => uniqueCachedColumn(view, sql, "postgres", read, token, onIncomplete)
  };
}
describe("unique bound-column identity", () => {
  it("checks every visible input before inheriting metadata", async () => {
    const f = fixture("SELECT amount<cursor> FROM ledger l JOIN users u ON true");
    expect(await f.resolve()).toEqual(amount);
    expect(f.read).toHaveBeenCalledTimes(2);
  });
  it("does not choose one of two same-name columns", async () => {
    const f = fixture("SELECT amount<cursor> FROM ledger l JOIN users u ON true", {
      ledger: {
        columns: [amount],
        complete: true
      },
      users: {
        columns: [{
          ...amount,
          dataType: "text"
        }],
        complete: true
      }
    });
    expect(await f.resolve()).toBeUndefined();
    expect(f.read).toHaveBeenCalledTimes(2);
  });
  it("cannot prove uniqueness using a partial field list", async () => {
    const f = fixture("SELECT amount<cursor> FROM ledger l JOIN users u ON true", {
      ledger: {
        columns: [amount],
        complete: true
      },
      users: {
        columns: [id],
        complete: false
      }
    });
    expect(await f.resolve()).toBeUndefined();
  });
  it("accepts a complete empty input", async () => {
    const f = fixture("SELECT amount<cursor> FROM ledger l JOIN users u ON true", {
      ledger: {
        columns: [amount],
        complete: true
      },
      users: {
        columns: [],
        complete: true
      }
    });
    expect(await f.resolve()).toEqual(amount);
  });
  it("uses a nearest-block match without borrowing an outer comment", async () => {
    const f = fixture("SELECT * FROM ledger o WHERE EXISTS(SELECT amount<cursor> FROM users u JOIN empty e ON true)", {
      ledger: {
        columns: [amount],
        complete: true
      },
      users: {
        columns: [{
          name: "amount",
          dataType: "text",
          comment: "Inner"
        }],
        complete: true
      },
      empty: {
        columns: [],
        complete: true
      }
    });
    expect(await f.resolve()).toEqual({
      name: "amount",
      dataType: "text",
      comment: "Inner"
    });
    expect(f.read.mock.calls.every(([r]) => r.table !== "ledger")).toBe(true);
  });
  it("does not fall through a local ambiguity to an outer field", async () => {
    const f = fixture("SELECT * FROM ledger o WHERE EXISTS(SELECT amount<cursor> FROM users u JOIN inner_b b ON true)", {
      ledger: {
        columns: [amount],
        complete: true
      },
      users: {
        columns: [amount],
        complete: true
      },
      inner_b: {
        columns: [amount],
        complete: true
      }
    });
    expect(await f.resolve()).toBeUndefined();
    expect(f.read.mock.calls.every(([r]) => r.table !== "ledger")).toBe(true);
  });
  it("falls back to a correlated outer scope only after proving local absence", async () => {
    const f = fixture("SELECT * FROM ledger o WHERE EXISTS(SELECT amount<cursor> FROM users u JOIN inner_b b ON true)", {
      ledger: {
        columns: [amount],
        complete: true
      },
      users: {
        columns: [id],
        complete: true
      },
      inner_b: {
        columns: [],
        complete: true
      }
    });
    expect(await f.resolve()).toEqual(amount);
    expect(f.read).toHaveBeenCalledTimes(3);
  });
  it("withholds inference when an input could not be parsed", async () => {
    const f = fixture("SELECT amount<cursor> FROM ledger l JOIN a.b.c.d.e z ON true");
    expect(await f.resolve()).toBeUndefined();
    expect(f.read).not.toHaveBeenCalled();
  });
  it("keeps a LATERAL result out of its own input scope", () => {
    const f = fixture("SELECT * FROM ledger l JOIN LATERAL(SELECT q.amount<cursor> FROM users u) q ON true");
    expect(cachedSqlRelationForFieldCompletion(f.statement.source.slice(0, f.statement.cursorOffset), f.statement)).toBeNull();
  });
  it("does not classify EXTRACT's FROM token as another table", async () => {
    const f = fixture("SELECT amount<cursor> FROM ledger l WHERE EXTRACT(DAY FROM l.created_at)>0");
    expect(await f.resolve()).toEqual(amount);
    expect(f.read).toHaveBeenCalledOnce();
  });
  it("honors cancellation after an outstanding read", async () => {
    const f = fixture("SELECT amount<cursor> FROM ledger l JOIN users u ON true"),
      token = {
        isCancellationRequested: false
      };
    let finish!: (value: CachedColumnSet) => void;
    f.read.mockImplementation(() => new Promise(resolve => {
      finish = resolve;
    }));
    const pending = f.resolve("amount", token);
    token.isCancellationRequested = true;
    finish({
      columns: [amount],
      complete: true
    });
    expect(await pending).toBeUndefined();
    expect(f.read).toHaveBeenCalledOnce();
  });
  it("uses exact quoted names and driver folding for referenced columns", async () => {
    const f = fixture('SELECT "Amount"<cursor> FROM ledger l JOIN users u ON true', {
      ledger: {
        columns: [{
          name: "Amount",
          dataType: "numeric"
        }],
        complete: true
      },
      users: {
        columns: [amount],
        complete: true
      }
    });
    expect((await f.resolve('"Amount"'))?.dataType).toBe("numeric");
    expect((await f.resolve("Amount"))?.dataType).toBe("decimal");
  });
});
