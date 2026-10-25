import {sqlCompletionTypeFamily} from "./predicateContext";
import {postgresBuiltinType} from "./typeNames";

export type SqlValueTemplate={label:string;insertText:string;cursorOffsetFromEnd?:number;preserveInsertText?:boolean};
const arraySuffix=(type:string)=>/\[\s*\d*\s*\]\s*$/u.test(type);
const opaquePostgresType=(type:string|undefined,profile:string,builtin:ReturnType<typeof postgresBuiltinType>)=>!builtin&&["postgres","postgresql","pgsql","psql"].includes(profile)&&/[."]/u.test(type??"")&&!arraySuffix(type??"");
const unknownValues=(profile:string):SqlValueTemplate[]=>(["sqlserver","mssql","tsql"].includes(profile)?["NULL","CURRENT_TIMESTAMP"]:["NULL","TRUE","FALSE","CURRENT_DATE","CURRENT_TIMESTAMP"]).map(label=>({label,insertText:label+" "}));
function normalizedSqlValueType(dataType:string|undefined,builtin:ReturnType<typeof postgresBuiltinType>){
 if(builtin)return builtin.name+builtin.modifiers+(builtin.array?"[]":"");
 let type=(dataType??"").trim().toLowerCase();
 for(let i=0;i<4&&/^(?:nullable|lowcardinality)\s*\(/u.test(type)&&type.endsWith(")");i++)type=type.slice(type.indexOf("(")+1,-1).trim();
 return type;
}
export function sqlIsPredicateLabels(dataType:string|undefined,profile:string,negated:boolean){
 const labels=["NULL"];if(!negated)labels.push("NOT NULL");
 const tsql=["sqlserver","mssql","tsql"].includes(profile),clickhouse=profile==="clickhouse",sqlite=["sqlite","sqlite3"].includes(profile),hive=["hive","hql"].includes(profile),postgres=["postgres","postgresql","pgsql","psql"].includes(profile);
 const builtin=postgresBuiltinType(dataType??"",profile),type=normalizedSqlValueType(dataType,builtin),family=sqlCompletionTypeFamily(type,profile),knownNonBoolean=!opaquePostgresType(dataType,profile,builtin)&&Boolean(type)&&(family!=="boolean"&&family!=="other"||Boolean(builtin&&builtin.name!=="boolean")||arraySuffix(type)||/\[\s*\]|\barray\b|^(?:bit|varbit|map|tuple|struct)\b/u.test(type));
 if(!tsql&&!clickhouse&&!(postgres&&knownNonBoolean)){
  labels.push("TRUE","FALSE");if(!sqlite&&!hive)labels.push("UNKNOWN");
  if(!negated){labels.push("NOT TRUE","NOT FALSE");if(!sqlite&&!hive)labels.push("NOT UNKNOWN");}
 }
 if(postgres||sqlite||profile==="duckdb"){labels.push("DISTINCT FROM");if(!negated)labels.push("NOT DISTINCT FROM");}
 return labels;
}
const nil:SqlValueTemplate={label:"NULL",insertText:"NULL "};
/** Whether a known scalar type can be used as a logical operand. Unknown
 * types stay distinct from a proven restriction or permitted coercion. */
export function sqlLogicalContinuation(dataType:string|undefined,profile:string):boolean|undefined {
 if(!dataType)return undefined;
 const builtin=postgresBuiltinType(dataType,profile),type=normalizedSqlValueType(dataType,builtin),family=sqlCompletionTypeFamily(type,profile);
 if(opaquePostgresType(dataType,profile,builtin))return undefined;
 const container=arraySuffix(type)||/\[\s*\]|^(?:array|map|tuple|struct)\s*\(/u.test(type);
 const known=builtin||family!=="other"||container||/^(?:blob|bit|varbit|bitstring)\b/u.test(type);
 if(!known)return undefined;
 if(profile==="duckdb"&&/^enum\s*\(/u.test(type))return undefined;
 if(["sqlserver","mssql","tsql"].includes(profile))return false;
 if(["sqlite","sqlite3"].includes(profile))return true;
 if(["postgres","postgresql","pgsql","psql","hive","hql"].includes(profile))return builtin?builtin.name==="boolean"&&!builtin.array:family==="boolean"&&!/^(?:bit|varbit)\b/u.test(type);
 if(["mysql","mariadb"].includes(profile))return container?false:family==="json"?undefined:true;
 if(["clickhouse","ch"].includes(profile))return /^(?:u?int\d*|float\d*|bool(?:ean)?)$/u.test(type);
 if(profile==="duckdb")return ["boolean","number","text"].includes(family)||/^(?:bit|varbit|bitstring)\b/u.test(type)?true:family==="json"?undefined:false;
 return undefined;
}
const numeric=():SqlValueTemplate[]=>[{label:"0",insertText:"0 ",preserveInsertText:true},{label:"1",insertText:"1 ",preserveInsertText:true},nil];
const literals=(values:string[]):SqlValueTemplate[]=>[...values.map(value=>({label:value,insertText:value+" ",preserveInsertText:true})),nil];

/** Literal recommendations follow the effective profile, independently of the
 * compatibility parser used by its language service. */
export function sqlValueTemplates(dataType:string|undefined,profile:string):SqlValueTemplate[]{
 const builtin=postgresBuiltinType(dataType??"",profile),type=normalizedSqlValueType(dataType,builtin);
 if(opaquePostgresType(dataType,profile,builtin))return unknownValues(profile);
 if(arraySuffix(type)||/\[\s*\]|\barray\b|^(?:map|tuple|struct)\s*\(/u.test(type))return [nil];
 const bit=/^(bit(?:\s+varying)?|varbit|bitstring)(?:\(\s*(\d+)\s*\))?$/u.exec(type);
 if(bit){
  if(["sqlserver","mssql","tsql","sqlite"].includes(profile))return numeric();
  if(profile==="duckdb")return literals(["'0'::BIT","'1'::BIT"]);
  if(["postgres","postgresql","pgsql","psql","mysql","mariadb"].includes(profile)){
   const width=Number(bit[2]??1),variable=bit[1]!=="bit";
   if(!Number.isSafeInteger(width)||width<1||width>4294967295)return [nil];
   if(["mysql","mariadb"].includes(profile)&&(variable||width>64))return [nil];
   if(bit[1]==="bitstring")return [nil];
   return literals(["0","1"].map(last=>variable?`B'${last}'`:width>64?`B'${last}'::bit(${width})`:`B'${"0".repeat(width-1)}${last}'`));
  }
  return [nil];
 }
 const family=sqlCompletionTypeFamily(type,profile);
 if(family==="boolean")return ["sqlserver","mssql","tsql"].includes(profile)?numeric():[...(["TRUE","FALSE"].map(label=>({label,insertText:label+" "}))),nil];
 if(family==="number")return numeric();
 if(family==="temporal")return [{label:"''",insertText:"'' ",cursorOffsetFromEnd:2},{label:"CURRENT_DATE",insertText:"CURRENT_DATE "},{label:"CURRENT_TIMESTAMP",insertText:"CURRENT_TIMESTAMP "},nil];
 if(family==="json")return [{label:"'{}'",insertText:"'{}' ",cursorOffsetFromEnd:3},nil];
 if(family==="uuid")return [{label:"'UUID'",insertText:"'00000000-0000-0000-0000-000000000000' ",cursorOffsetFromEnd:38},nil];
 if(family==="text")return [{label:"''",insertText:"'' ",cursorOffsetFromEnd:2},{label:"'%…%'",insertText:"'%%' ",cursorOffsetFromEnd:3},nil];
 if(builtin)return [nil];
 return unknownValues(profile);
}

export function compatibleSqlValueKeyword(dataType:string|undefined,profile:string,label:string){
 const builtin=postgresBuiltinType(dataType??"",profile),type=normalizedSqlValueType(dataType,builtin);
 if(opaquePostgresType(dataType,profile,builtin))return true;
 if(!type||!builtin&&sqlCompletionTypeFamily(type,profile)==="other"&&!/\[\s*\]|^(?:array|map|tuple|struct)\s*\(|^(?:bit|varbit|bitstring)\b/iu.test(type))return true;
 if(!["TRUE","FALSE","CURRENT_DATE","CURRENT_TIMESTAMP"].includes(label))return true;
 return sqlValueTemplates(dataType,profile).some(item=>item.label.toUpperCase()===label);
}
