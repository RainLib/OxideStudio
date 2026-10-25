/** Query ownership at an arbitrary UTF-16 cursor, including FROM clauses
 * following SELECT. Snapshots retain each set branch and parent's context. */
import {isSqlComparisonFrom} from "./structure";
export function cachedQueryScopes(source: string, cursorOffset = source.length) {
  type Query = {
    id: number;
    depth: number;
    branch: number;
    clause: string;
    parentAt: Location | null;
    barrier: boolean;
  };
  type Location = {
    query: Query;
    branch: number;
    clause: string;
    position: number;
  };
  type Frame = {
    fresh: boolean;
    query: Query | null;
    fromBarrier: boolean;
    parentLimit?: number;
  };
  const root: Query = {
    id: 0,
    depth: 0,
    branch: 0,
    clause: "",
    parentAt: null,
    barrier: false
  };
  let owner = root,
    queryCount = 0;
  let budget = cursorOffset < 0 || cursorOffset > source.length;
  const fromCommas = new Set<number>();
  const inputPositions = new Set<number>();
  const lastInputByOwner = new Map<number, number>();
  const frames: Frame[] = [],
    starts = new Set<number>();
  const snapshot = (position: number): Location => ({
    query: owner,
    branch: owner.branch,
    clause: owner.clause,
    position
  });
  const segments: Location[] = [snapshot(0)];
  const record = (position: number) => {
    segments.push(snapshot(position));
  };
  let quote: string | null = null;
  for (let index = 0; index < source.length && !budget;) {
    if (source.length > 512 * 1024 || frames.length > 128 || queryCount > 1024 || starts.size > 32768) {
      budget = true;
      break;
    }
    const ch = source[index]!;
    if (quote) {
      if (ch === quote) {
        if (source[index + 1] === quote) {
          index += 2;
          continue;
        }
        quote = null;
      }
      index++;
      continue;
    }
    if (ch === '"' || ch === '`' || ch === '[') {
      quote = ch === '[' ? ']' : ch;
      if (frames.length) frames[frames.length - 1]!.fresh = false;
      index++;
      continue;
    }
    if (ch === '(') {
      const previous = source.slice(Math.max(0, index - 128), index);
      const directFrom = owner.clause === "FROM" && /(?:\bfrom|\bjoin|,)\s*$/iu.test(previous);
      // CTE bodies see declarations, never the enclosing query's physical FROM.
      const cteBody = /\bas(?:\s+(?:not\s+)?materialized)?\s*$/iu.test(previous);
      const parentFrame = frames[frames.length - 1];
      const inherited = parentFrame && !parentFrame.query ? parentFrame.fromBarrier : false;
      if (parentFrame) parentFrame.fresh = false;
      frames.push({
        fresh: true,
        query: null,
        fromBarrier: directFrom || cteBody || inherited,
        ...(owner.clause === "FROM" && lastInputByOwner.has(owner.id) ? {
          parentLimit: lastInputByOwner.get(owner.id)! - 1
        } : {})
      });
      index++;
      continue;
    }
    if (ch === ')') {
      const frame = frames.pop();
      if (frame?.query) {
        owner = frame.query.parentAt?.query ?? root;
        record(index + 1);
      }
      index++;
      continue;
    }
    if (ch === ',') {
      starts.add(index);
      if (frames.length === owner.depth && owner.clause === "FROM") {
        fromCommas.add(index);
        inputPositions.add(index);
        lastInputByOwner.set(owner.id, index);
      }
    }
    if (/[A-Za-z_]/u.test(ch)) {
      const start = index;
      while (index < source.length && /[A-Za-z0-9_$]/u.test(source[index]!)) index++;
      starts.add(start);
      const word = source.slice(start, index).toUpperCase();
      const frame = frames[frames.length - 1];
      if (frame?.fresh && ["SELECT", "WITH", "VALUES"].includes(word)) {
        owner = {
          id: ++queryCount,
          depth: frames.length,
          branch: start,
          clause: "",
          parentAt: {
            ...snapshot(start),
            position: frame.parentLimit ?? start
          },
          barrier: frame.fromBarrier
        };
        frame.query = owner;
        record(start);
      }
      if (frame) frame.fresh = false;
      if (frames.length === owner.depth) {
        if (["UNION", "INTERSECT", "EXCEPT", "MINUS"].includes(word)) {
          owner.branch = index;
          record(index);
        }
        if (["SELECT", "WHERE", "ON", "HAVING", "GROUP", "ORDER", "LIMIT", "SET", "VALUES", "RETURNING"].includes(word) || word === "WITH" && owner.clause === "") {
          owner.clause = word;
          record(start);
        }
        if (["FROM", "JOIN", "APPLY"].includes(word)&&!(word==="FROM"&&isSqlComparisonFrom(source,start))) {
          inputPositions.add(start);
          lastInputByOwner.set(owner.id, start);
          owner.clause = "FROM";
          record(start);
        }
      }
      continue;
    }
    if (!/\s/u.test(ch) && frames.length) frames[frames.length - 1]!.fresh = false;
    index++;
  }
  const locate = (offset: number) => {
    let low = 0,
      high = segments.length;
    while (low + 1 < high) {
      const mid = low + high >>> 1;
      if (segments[mid]!.position <= offset) low = mid;else high = mid;
    }
    return segments[low]!;
  };
  const target = {
    ...locate(cursorOffset),
    position: cursorOffset
  };
  const declarations = new Set<number>(),
    relations = new Map<number, Location>();
  for (let location: Location | null = target; location; location = location.query.parentAt) declarations.add(location.query.id);
  for (let location: Location | null = target; location; location = location.query.barrier ? null : location.query.parentAt) relations.set(location.query.id, location);
  const at = (offset: number, relation: boolean) => {
    if (budget || !starts.has(offset)) return undefined;
    const location = locate(offset),
      visible = relations.get(location.query.id);
    if (!relation) return declarations.has(location.query.id) ? location.query.id : undefined;
    if (!visible || location.branch !== visible.branch) return undefined;
    // ON excludes later JOINs; LATERAL/APPLY exclude following FROM inputs.
    if (["ON", "FROM"].includes(visible.clause) && offset > visible.position) return undefined;
    return location.query.id;
  };
  return {
    relationAt: (offset: number) => at(offset, true),
    isInputPosition: (offset: number) => inputPositions.has(offset),
    visibleInputPositions: () => [...inputPositions].filter(offset => at(offset, true) !== undefined),
    activeOwner: target.query.id,
    fromItemAt: (offset: number) => fromCommas.has(offset) ? at(offset, true) : undefined,
    isFromComma: (offset: number) => fromCommas.has(offset),
    isCteDeclaration: (offset: number) => starts.has(offset) && locate(offset).clause === "WITH",
    declarationAt: (offset: number) => at(offset, false)
  };
}
