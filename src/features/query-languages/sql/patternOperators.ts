const postgres=["postgres","postgresql","pgsql","psql"],mysql=["mysql","mariadb"],sqlite=["sqlite","sqlite3"],hive=["hive","hql"],clickhouse=["clickhouse","ch"];
export const SQL_PATTERN_WORDS = ["LIKE", "ILIKE", "REGEXP", "RLIKE", "GLOB", "SIMILAR", "TO", "ESCAPE"] as const;
/** Core syntax only; versioned regex aliases stay owned by the bound server. */
export function sqlPatternOperators(profile:string):string[]{
 if(postgres.includes(profile))return ["LIKE","ILIKE","SIMILAR TO","~","~*","!~","!~*"];
 if(mysql.includes(profile))return ["LIKE","REGEXP","RLIKE"];
 if(sqlite.includes(profile))return ["LIKE","GLOB"];
 if(hive.includes(profile))return ["LIKE","REGEXP","RLIKE"];
 if(clickhouse.includes(profile))return ["LIKE","ILIKE","REGEXP","~"];
 if(profile==="duckdb")return ["LIKE","ILIKE","SIMILAR TO","GLOB","~","!~"];
 return ["LIKE"];
}
/** Alphabetic predicates that may follow a completed infix NOT. */
export function sqlNegatedPatternOperators(profile:string):string[]{
 return sqlPatternOperators(profile).filter(operator=>/^[A-Z]/u.test(operator)&&!(profile==="duckdb"&&operator==="GLOB")&&!(clickhouse.includes(profile)&&operator==="REGEXP"));
}
export function sqlPatternValueType(operator:string,profile:string):string|undefined{
 const name=operator.toUpperCase().replace(/^NOT\s+/u,"");
 if(operator.toUpperCase().startsWith("NOT ")&&!sqlNegatedPatternOperators(profile).includes(name)||!sqlPatternOperators(profile).includes(name))return undefined;
 return hive.includes(profile)?"string":clickhouse.includes(profile)?"String":mysql.includes(profile)||profile==="duckdb"?"varchar":["sqlserver","mssql","tsql"].includes(profile)?"nvarchar":"text";
}
/** Versioned ClickHouse syntax is enabled by a bound server role, not guessed here. */
export function sqlPatternEscapeType(operator:string,profile:string):string|undefined{
 const name=operator.toUpperCase().replace(/^NOT\s+/u,"");
 if((postgres.includes(profile)&&["LIKE","ILIKE","SIMILAR TO"].includes(name))||(profile==="duckdb"&&["LIKE","ILIKE"].includes(name))||([...mysql,...sqlite,"sqlserver","mssql","tsql"].includes(profile)&&name==="LIKE"))return sqlPatternValueType(operator,profile);
 return undefined;
}
export const SQL_ESCAPE_VALUES=["'#'","'!'","NULL"];
export function sqlEscapeLiteral(value:string,profile:string){
 if(value.toUpperCase()==="NULL")return true;
 if(!/^'(?:[^'\\]|'')'$/u.test(value))return false;
 const character=value.slice(1,-1).replace("''","'");
 return !["clickhouse","ch","duckdb"].includes(profile)||character.codePointAt(0)!<128;
}
