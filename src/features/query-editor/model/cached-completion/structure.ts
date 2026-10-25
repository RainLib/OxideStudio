/** Shared structural primitives over comment/literal-masked SQL. */
export function isSqlComparisonFrom(source:string,offset:number){
  let end=offset;
  const previous=()=>{
    while(end>0&&/\s/u.test(source[end-1]!))end--;
    const finish=end;while(end>0&&/[A-Za-z0-9_$]/u.test(source[end-1]!))end--;
    return finish-end>8?"":source.slice(end,finish).toUpperCase();
  };
  if(previous()!=="DISTINCT")return false;
  const second=previous();if(second!=="IS"&&(second!=="NOT"||previous()!=="IS"))return false;
  return source[end-1]!==".";
}
export function quotedSqlIdentifierEnd(source: string, start: number) {
  const closing = source[start] === '[' ? ']' : source[start];
  for (let index = start + 1; index < source.length; index++) {
    if (source[index] !== closing) continue;
    if (source[index + 1] === closing) {
      index++;
      continue;
    }
    return index;
  }
  return source.length - 1;
}
export function matchingSqlParenthesis(source: string, open: number) {
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    if (['"', '`', '['].includes(source[index]!)) {
      index = quotedSqlIdentifierEnd(source, index);
      continue;
    }
    if (source[index] === '(') depth++;else if (source[index] === ')' && --depth === 0) return index;
  }
  return -1;
}
export function* topLevelSqlWords(source: string, start = 0, end = source.length) {
  let depth = 0;
  for (let index = start; index < end; index++) {
    const ch = source[index]!;
    if (['"', '`', '['].includes(ch)) {
      index = quotedSqlIdentifierEnd(source, index);
      continue;
    }
    if (ch === '(') depth++;else if (ch === ')') depth--;else if (depth === 0 && /[A-Za-z_]/u.test(ch)) {
      const offset = index;
      while (index + 1 < end && /[A-Za-z0-9_$]/u.test(source[index + 1]!)) index++;
      const word=source.slice(offset,index+1).toUpperCase();
      if(word==="FROM"&&isSqlComparisonFrom(source,offset))continue;
      yield {
        word,
        start: offset,
        end: index + 1
      };
    }
  }
}
