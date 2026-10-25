import {dollarQuoteTagAt, isPostgresDialect} from "./lexicalRules";

export type SqlCompletionRegion = "sql" | "identifier" | "literal" | "comment";
export type SqlCompletionToken = {kind:"word"|"identifier"|"literal"|"number"|"symbol";text:string;start:number;end:number};
const wordPattern=/[_\p{ID_Start}][$_\u200c\u200d\p{ID_Continue}]*/uy;
const tsqlWordPattern=/[_\p{ID_Start}][$@#_\u200c\u200d\p{ID_Continue}]*/uy;
const numberPattern=/(?:0[xX][\da-fA-F_]+|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?[\d_]+)?)/y;

/** Cursor classification for incomplete SQL. Offsets are UTF-16, as in Monaco.
 * Uses default dialect modes and the effective identifier quote for MySQL
 * ANSI_QUOTES. Other session-specific lexer settings are not inferred here. */
function scanCompletionSql(sql: string, cursorOffset: number, dialect?: string | null, identifierQuote?: string, emit?:(token:SqlCompletionToken)=>void): SqlCompletionRegion {
  const cursor = Math.max(0, Math.min(cursorOffset, sql.length));
  const profile = (dialect ?? "").trim().toLowerCase();
  const postgres = isPostgresDialect(profile);
  const mysql = ["mysql", "mariadb"].includes(profile);
  const tsql = ["sqlserver", "mssql", "tsql"].includes(profile);
  const hive = ["hive", "spark", "sparksql"].includes(profile);
  const clickhouse = profile === "clickhouse";
  const nestedComments = postgres || tsql || profile === "duckdb";
  let index = 0;
  while(index < cursor) {
    const start = index;
    let kind: SqlCompletionRegion | undefined, end = index, closed = false;
    const dash = sql.startsWith("--", index) && (!mysql || index + 2 === sql.length || /[\s\u0000-\u001f]/u.test(sql[index + 2]!));
    if(dash || ((mysql || clickhouse) && sql[index] === "#")) {
      kind = "comment";
      end = index;
      while(end < sql.length && sql[end] !== "\n" && sql[end] !== "\r")end++;
      // At a line ending the caret is still inside the comment, before it.
      if(cursor <= end)return kind;
      index = end + 1;
      continue;
    }
    if(sql.startsWith("/*", index)) {
      kind = "comment";
      let depth = 1;
      end = index + 2;
      while(end < sql.length && depth) {
        if(nestedComments && sql.startsWith("/*", end)){depth++;end += 2;}
        else if(sql.startsWith("*/", end)){depth--;end += 2;}
        else end++;
      }
      closed = depth === 0;
    } else {
      const char = sql[index]!;
      const tag = (postgres || profile === "duckdb" || clickhouse) && char === "$" && !/[\p{L}\p{N}_$]/u.test(sql[index - 1] ?? "") ? dollarQuoteTagAt(sql, index) : null;
      if(tag) {
        kind = "literal";
        const closing = sql.indexOf(tag, index + tag.length);
        closed = closing >= 0;
        end = closed ? closing + tag.length : sql.length;
      } else if(char === "'" || char === '"' || char === "`" || (char === "[" && (tsql || profile === "sqlite" || identifierQuote === "["))) {
        kind = char === "'" || (char === '"' && (hive || (mysql && identifierQuote !== '"'))) ? "literal" : "identifier";
        const closing = char === "[" ? "]" : char;
        const escapeString = (postgres || profile === "duckdb") && char === "'" && /[eE]/u.test(sql[index - 1] ?? "") && !/[\p{L}\p{N}_$]/u.test(sql[index - 2] ?? "");
        const backslash = mysql || clickhouse || hive || escapeString;
        end = index + 1;
        while(end < sql.length) {
          if(backslash && sql[end] === "\\"){end = Math.min(end + 2, sql.length);continue;}
          if(sql[end] === closing) {
            if(sql[end + 1] === closing){end += 2;continue;}
            end++;closed = true;break;
          }
          end++;
        }
      }
    }
    if(kind) {
      if(kind!=="comment")emit?.({kind:kind==="identifier"?"identifier":"literal",text:sql.slice(start,Math.min(end,cursor)),start,end:Math.min(end,cursor)});
      if(cursor > start && (cursor < end || (!closed && cursor === end)))return kind;
      index = end;
    } else {
      const char=sql[index]!;
      if(/\s/u.test(char)){index++;continue;}
      const identifierPattern=tsql?tsqlWordPattern:wordPattern;
      identifierPattern.lastIndex=index;
      let word=identifierPattern.exec(sql);
      if(!word&&(char==="@"||(tsql&&char==="#"))){identifierPattern.lastIndex=index+1;word=identifierPattern.exec(sql);}
      numberPattern.lastIndex=index;
      const number=!word?numberPattern.exec(sql):null;
      const operator=!word&&!number?sql.slice(index).match(/^(?:->>|#>>|<=>|<=|>=|<>|!=|\|\||&&|::|->|#>|@>|<@|:=)/u)?.[0]:undefined;
      end=Math.min(cursor,word?identifierPattern.lastIndex:number?numberPattern.lastIndex:operator?index+operator.length:index+1);
      emit?.({kind:word?"word":number?"number":"symbol",text:sql.slice(index,end),start:index,end});
      index=end;
    }
  }
  return "sql";
}

export function sqlCompletionRegionAtCursor(sql:string,cursorOffset:number,dialect?:string|null,identifierQuote?:string){
  return scanCompletionSql(sql,cursorOffset,dialect,identifierQuote);
}

/** One dialect-aware scan supplies both cursor state and opaque SQL lexemes. */
export function sqlCompletionTokens(sql:string,cursorOffset:number,dialect?:string|null,identifierQuote?:string){
  const tokens:SqlCompletionToken[]=[];
  if(sql.length>524288)return {region:"sql" as SqlCompletionRegion,tokens,complete:false};
  let complete=true;
  const region=scanCompletionSql(sql,cursorOffset,dialect,identifierQuote,token=>{
    if(tokens.length>=16384){complete=false;return;}
    const previous=tokens[tokens.length-1];
    if(token.kind==="literal"&&previous?.kind==="word"&&previous.end===token.start&&/^[enxb]$/iu.test(previous.text)){
      tokens.pop();token={...token,start:previous.start,text:previous.text+token.text};
    }
    tokens.push(token);
  });
  return {region,tokens,complete};
}
