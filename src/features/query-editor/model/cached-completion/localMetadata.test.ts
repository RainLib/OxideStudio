import { describe, expect, it, vi } from "vitest";
import { currentTopLevelStatementAtCursor } from "./lexical";
import { cachedSqlRelationForFieldCompletion } from "./relations";
import { createCachedLocalMetadataResolver } from "./localMetadata";
import type { CachedColumnSet } from "./metadataSearch";
function fixture(marked: string, token: {
  isCancellationRequested?: boolean;
} = {}) {
  const cursorOffset = marked.indexOf("<cursor>"),
    source = marked.replace("<cursor>", "");
  const statement = currentTopLevelStatementAtCursor(source, cursorOffset);
  const relation = cachedSqlRelationForFieldCompletion(source.slice(0, cursorOffset), statement)!;
  const load = vi.fn(async (): Promise<CachedColumnSet> => ({
    complete: true,
    columns: [{
      name: "amount",
      dataType: "decimal",
      comment: "Revenue"
    }, {
      name: "id",
      dataType: "bigint"
    }]
  }));
  const onIncomplete = vi.fn();
  const resolver = createCachedLocalMetadataResolver(statement, load, {
    driver: "postgres",
    token,
    onIncomplete
  });
  return {
    load,
    onIncomplete,
    resolve: () => resolver.resolve(relation)
  };
}
describe("cached direct projection metadata provenance", () => {
  it.each(["amount IS DISTINCT FROM NULL","amount IS /* FROM */ NOT DISTINCT FROM NULL"])("keeps the complete comparison projection %s without borrowing operand metadata",async expression=>{
    const f=fixture(`WITH q AS(SELECT ${expression} AS null_safe FROM ledger) SELECT q.<cursor> FROM q`);
    expect(await f.resolve()).toEqual([{name:"null_safe",dataType:"column"}]);
  });
  it("keeps dollar-quoted commas out of ordinal renames", async () => {
    const f = fixture("WITH q(note,net) AS(SELECT $$a,b$$, amount FROM ledger) SELECT q.<cursor> FROM q");
    expect(await f.resolve()).toEqual([{
      name: "note",
      dataType: "column"
    }, {
      name: "net",
      dataType: "decimal",
      comment: "Revenue"
    }]);
  });
  it("shares a local query and source load across repeated projections", async () => {
    const f = fixture("WITH a AS(SELECT amount FROM ledger),q AS(SELECT a.amount AS x,a.amount AS y FROM a) SELECT q.<cursor> FROM q");
    expect((await f.resolve()).map(c => [c.name, c.dataType, c.comment])).toEqual([["x", "decimal", "Revenue"], ["y", "decimal", "Revenue"]]);
    expect(f.load).toHaveBeenCalledOnce();
  });
  it("does not attach one branch's metadata to a UNION output", async () => {
    const f = fixture("WITH q(net) AS(SELECT amount FROM ledger UNION ALL SELECT id FROM users) SELECT q.<cursor> FROM q");
    expect(await f.resolve()).toEqual([{
      name: "net",
      dataType: "column"
    }]);
    expect(f.load).not.toHaveBeenCalled();
  });
  it("terminates recursive local definitions without a physical CTE lookup", async () => {
    const f = fixture("WITH RECURSIVE q(net) AS(SELECT net FROM q) SELECT q.<cursor> FROM q");
    expect(await f.resolve()).toEqual([{
      name: "net",
      dataType: "column"
    }]);
    expect(f.load).not.toHaveBeenCalled();
  });
  it("bounds deep valid chains and marks metadata incomplete", async () => {
    const definitions = ["q0(net) AS(SELECT amount FROM ledger)", ...Array.from({
      length: 39
    }, (_, i) => `q${i + 1}(net) AS(SELECT net FROM q${i})`)];
    const f = fixture(`WITH ${definitions.join(",")} SELECT q39.<cursor> FROM q39`);
    expect(await f.resolve()).toEqual([{
      name: "net",
      dataType: "column"
    }]);
    expect(f.onIncomplete).toHaveBeenCalled();
    expect(f.load).not.toHaveBeenCalled();
  });
  it("drops duplicate output names rather than selecting arbitrary provenance", async () => {
    const f = fixture("WITH q AS(SELECT amount AS net,id AS net FROM ledger) SELECT q.<cursor> FROM q");
    expect(await f.resolve()).toEqual([]);
    expect(f.load).toHaveBeenCalledOnce();
  });
  it("cancels before I/O and after an outstanding metadata read", async () => {
    const token = {
        isCancellationRequested: true
      },
      f = fixture("WITH q AS(SELECT amount FROM ledger) SELECT q.<cursor> FROM q", token);
    expect(await f.resolve()).toEqual([]);
    expect(f.load).not.toHaveBeenCalled();
    token.isCancellationRequested = false;
    let finish!: (columns: CachedColumnSet) => void;
    f.load.mockImplementation(() => new Promise(resolve => {
      finish = resolve;
    }));
    const pending = f.resolve();
    token.isCancellationRequested = true;
    finish({
      complete: true,
      columns: [{
        name: "amount",
        dataType: "decimal",
        comment: "Revenue"
      }]
    });
    expect(await pending).toEqual([]);
  });
  it("retains unrenamed tail columns of a partial alias list", async () => {
    const f = fixture("WITH q(net) AS(SELECT amount,id FROM ledger) SELECT q.<cursor> FROM q");
    expect((await f.resolve()).map(c => [c.name, c.dataType])).toEqual([["net", "decimal"], ["id", "bigint"]]);
  });
});
