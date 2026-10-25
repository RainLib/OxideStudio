import {sqlCompletionTokens,type SqlCompletionToken} from "./completionRegion";
import {postgresBuiltinType} from "./typeNames";
import {SQL_PATTERN_WORDS,sqlPatternValueType,sqlPatternEscapeType} from "./patternOperators";

type Atom={kind:"atom";text:string;start:number;end:number;type?:string;predicate?:boolean};
type Node=SqlCompletionToken|Atom;
export const SQL_UNTYPED_STRING="__oxide_untyped_string__";
type Frame={kind:"root"|"group"|"call"|"in"|"case";nodes:Node[];start:number;callee?:string;scalar?:boolean};
export type PredicatePhase="operand"|"operator"|"value"|"continuation"|"between-separator"|"in-continuation"|"is"|"is-not"|"not"|"relation"|"type"|"open-in"|"case-when"|"case-then"|"case-result"|"case-end"|"argument-continuation"|"distinct-from"|"similar-to";
export type PredicateContext={phase:PredicatePhase;type?:string;valueRole?:"pattern-escape";escapeSupported?:boolean;canEscape?:boolean;escapeAttachable?:boolean;canAppendPredicate:boolean;blocked:boolean;consumedKeyword:boolean;structural:boolean};
type Options={condition:string;cursorOffset:number;replacementStart:number;dialect?:string;identifierQuote?:string;columns:readonly {name:string;type?:string}[];qualifiers?:readonly string[]};
const keywords=new Set(["AND","OR","NOT","IS","NULL","TRUE","FALSE","UNKNOWN",...SQL_PATTERN_WORDS,"BETWEEN","IN","CASE","WHEN","THEN","ELSE","END","WHERE","HAVING","ON","SELECT","FROM","JOIN","WITH","AS","EXISTS","DISTINCT","ALL"]);
const word=(node:Node|undefined,value:string)=>node?.kind==="word"&&node.text.toUpperCase()===value;
const name=(node:Node)=>node.kind==="identifier"?node.text.slice(1,-1).replace(/""|``|\]\]/gu,match=>match[0]!):node.text;
const isIdentifier=(node:Node)=>node.kind==="identifier"||(node.kind==="word"&&!keywords.has(node.text.toUpperCase()));
const split=(nodes:Node[],separator:string)=>{
 const parts:Node[][]=[[]];for(const node of nodes){if(node.kind==="symbol"&&node.text===separator)parts.push([]);else parts[parts.length-1]!.push(node);}return parts;
};
export function sqlCompletionTypeFamily(value:string|undefined,profile?:string){
 const builtin=postgresBuiltinType(value??"",profile);
 if(builtin?.array)return "other";
 if(!builtin&&["postgres","postgresql","pgsql","psql"].includes(profile??"")&&/[."]/u.test(value??""))return "other";
 value=builtin?.name??value;
 let type=(value??"").trim().toLowerCase();
 for(let i=0;i<4&&/^(?:nullable|lowcardinality)\s*\(/u.test(type);i++)type=type.replace(/^[^(]*\(/u,"").replace(/\)\s*$/u,"").trim();
 if(/\[\s*\]|\barray\b|^(?:map|tuple|struct)\b/u.test(type))return "other";
 if(/^(?:bool(?:ean)?|bit)\b/u.test(type))return "boolean";
 if(/^(?:u?int(?:eger|8|16|32|64|128|256)?|bigint|smallint|tinyint|mediumint|int2|int4|int8|serial(?:2|4|8)?|bigserial|smallserial|numeric|decimal(?:32|64|128|256)?|dec|number|float(?:32|64|4|8)?|double|real|money|smallmoney|fixed)\b/u.test(type))return "number";
 if(/^(?:date(?:time(?:64|2|offset)?)?|time(?:stamp|stampntz|stampltz|stamptz|tz)?|smalldatetime|interval)\b/u.test(type))return "temporal";
 if(/^(?:char(?:acter)?|varchar(?:2)?|nvarchar(?:2)?|nchar|text|ntext|string|fixedstring|clob|nclob|enum|set)\b/u.test(type))return "text";
 if(/^(?:jsonb?|object)\b/u.test(type))return "json";
 if(/^(?:uuid|uniqueidentifier)\b/u.test(type))return "uuid";
 return "other";
}
function commonType(types:(string|undefined)[],profile?:string){
 if(!types.length||types.some(type=>!type))return undefined;
 types=types.map(type=>type===SQL_UNTYPED_STRING?"text":type);
 const first=types[0]!,family=sqlCompletionTypeFamily(first,profile);
 return types.every(type=>type===first)?first:family!=="other"&&types.every(type=>sqlCompletionTypeFamily(type,profile)===family)?({text:"text",number:"numeric",boolean:"boolean",temporal:"timestamp",json:"json",uuid:"uuid"}[family]):undefined;
}
function expressionType(nodes:Node[],options:Options):string|undefined {
 if(!nodes.length)return undefined;
 if(nodes.length===1){
  const node=nodes[0]!;
  if(node.kind==="atom")return node.type;
  if(node.kind==="literal")return ["postgres","postgresql","pgsql","psql"].includes(options.dialect??"")?SQL_UNTYPED_STRING:"text";
  if(node.kind==="number")return "numeric";
  if(word(node,"TRUE")||word(node,"FALSE"))return "boolean";
  if(node.kind==="word"&&/^(?:CURRENT_DATE|CURRENT_TIME|CURRENT_TIMESTAMP)$/iu.test(node.text))return "timestamp";
 }
 if(nodes.every((node,index)=>index%2===0?isIdentifier(node):node.kind==="symbol"&&node.text===".")){
  const identifiers=nodes.filter((_,index)=>index%2===0).map(name);
  if(identifiers.length>1&&!options.qualifiers?.some(qualifier=>qualifier.toLowerCase()===identifiers.slice(0,-1).join(".").toLowerCase()))return undefined;
  return options.columns.find(column=>column.name.toLowerCase()===identifiers[identifiers.length-1]!.toLowerCase())?.type;
 }
 const arithmetic=nodes.some(node=>node.kind==="symbol"&&["+","-","*","/","%","||"].includes(node.text));
 if(arithmetic){
  const parts:Node[][]=[[]],operators:string[]=[];
  for(const node of nodes){
   const current=parts[parts.length-1]!;
   if(node.kind==="symbol"&&["+","-","*","/","%","||"].includes(node.text)){
    if(!current.length&&["+","-"].includes(node.text))continue;
    operators.push(node.text);parts.push([]);
   }else current.push(node);
  }
  const types=parts.map(part=>expressionType(part,options)).map(type=>type===SQL_UNTYPED_STRING?"text":type),operator=operators[0];
  if(types.some(type=>!type))return undefined;
  if(!operators.length)return types[0];
  if(operators.every(value=>value==="||"))return types.every(type=>sqlCompletionTypeFamily(type,options.dialect)==="json")?"json":types.every(type=>sqlCompletionTypeFamily(type,options.dialect)==="text")?"text":undefined;
  if(operator==="+"&&operators.every(value=>value==="+")&&["sqlserver","mssql","tsql"].includes(options.dialect??"")&&types.every(type=>sqlCompletionTypeFamily(type,options.dialect)==="text"))return "text";
  return types.every(type=>sqlCompletionTypeFamily(type,options.dialect)==="number")?"numeric":undefined;
 }
 const cast=nodes.findIndex(node=>node.kind==="symbol"&&node.text==="::");
 if(cast>=0)return typeSource(nodes.slice(cast+1),options);
 return undefined;
}
function callType(frame:Frame,options:Options){
 const call=frame.callee?.toUpperCase();if(!call||call.includes("."))return undefined;
 const args=split(frame.nodes,",");
 if(call==="CAST"||call==="TRY_CAST"||call==="SAFE_CAST"){
  const as=frame.nodes.findIndex(node=>word(node,"AS")),type=as>=0?typeSource(frame.nodes.slice(as+1),options):undefined;
  if(type&&call==="CAST"&&["sqlite","sqlite3"].includes(options.dialect??"")){
   const name=type.toUpperCase();
   if(name.includes("INT"))return "integer";
   if(["CHAR","CLOB","TEXT"].some(part=>name.includes(part)))return "text";
   if(name.includes("BLOB")||name.replace(/["`\[\]]/gu,"").length===0)return "blob";
   if(["REAL","FLOA","DOUB"].some(part=>name.includes(part)))return "real";
   return "numeric";
  }
  return type;
 }
 if(["LOWER","UPPER","TRIM","LTRIM","RTRIM","SUBSTRING","SUBSTR","CONCAT","REPLACE"].includes(call))return "text";
 if(["COUNT","LENGTH","CHAR_LENGTH","OCTET_LENGTH","LEN","ROUND","FLOOR","CEIL","CEILING"].includes(call))return "numeric";
 if(["COALESCE","IFNULL","NVL"].includes(call))return commonType(args.filter(arg=>!(arg.length===1&&word(arg[0],"NULL"))).map(arg=>expressionType(arg,options)),options.dialect);
 if(["SUM","AVG"].includes(call))return sqlCompletionTypeFamily(expressionType(args[0]??[],options),options.dialect)==="number"?"numeric":undefined;
 if(call==="NULLIF")return commonType(args.map(arg=>expressionType(arg,options)),options.dialect);
 if(["MIN","MAX","ABS"].includes(call))return expressionType(args[0]??[],options);
 return undefined;
}
function typeSource(nodes:Node[],options:Options){
 return nodes.length?options.condition.slice(nodes[0]!.start,nodes[nodes.length-1]!.end):undefined;
}
function caseType(nodes:Node[],options:Options){
 const branches:Node[][]=[];let branch:Node[]|undefined;
 for(const node of nodes){
  if(word(node,"THEN")||word(node,"ELSE")){branch=[];branches.push(branch);}
  else if(word(node,"WHEN"))branch=undefined;
  else branch?.push(node);
 }
 return commonType(branches.filter(branch=>!(branch.length===1&&word(branch[0],"NULL"))).map(branch=>expressionType(branch,options)),options.dialect);
}
function predicateNodes(nodes:Node[]):{nodes:Node[];role:"predicate"|"scalar"|"relation"}{
 let start=0,role:"predicate"|"scalar"|"relation"="predicate";
 for(let i=0;i<nodes.length;i++){
  const node=nodes[i];
  if(word(node,"FROM")&&word(nodes[i-1],"DISTINCT")&&(word(nodes[i-2],"IS")||word(nodes[i-2],"NOT")&&word(nodes[i-3],"IS")))continue;
  if(["WHERE","HAVING","ON","WHEN"].some(key=>word(node,key))){start=i+1;role="predicate";}
  else if(["SELECT","THEN","ELSE","RETURNING"].some(key=>word(node,key))){start=i+1;role="scalar";}
  else if(["FROM","JOIN","WITH"].some(key=>word(node,key))){start=i+1;role="relation";}
 }
 return {nodes:nodes.slice(start),role};
}
function phaseFor(nodes:Node[],options:Options):{phase:PredicatePhase;type?:string;valueRole?:"pattern-escape";escapeSupported?:boolean;canEscape?:boolean;escapeAttachable?:boolean;predicate?:boolean;scalarOperand?:boolean}{
 let segment=0,between=-1,betweenAnd=-1,comparison=-1;
 for(let i=0;i<nodes.length;i++){
  const node=nodes[i]!;
  if(word(node,"BETWEEN")){between=i;betweenAnd=-1;comparison=i;}
  else if(word(node,"AND")&&between>=0&&betweenAnd<0)betweenAnd=i;
  else if(word(node,"AND")||word(node,"OR")){segment=i+1;between=-1;betweenAnd=-1;comparison=-1;}
  else if((node.kind==="symbol"&&["=","!=","<>","<",">","<=",">=","<=>","~","~*","!~","!~*"].includes(node.text))||["LIKE","ILIKE","IS","IN","REGEXP","RLIKE","GLOB","SIMILAR"].some(key=>word(node,key)))comparison=i;
 }
 const current=nodes.slice(segment),last=current[current.length-1];
 const operator=comparison>=segment?nodes[comparison]:undefined;
 const leftType=operator?expressionType(nodes.slice(segment,comparison).filter(node=>!word(node,"NOT")),options):undefined;
 if(word(last,"IS"))return {phase:"is",type:leftType};
 if(word(last,"NOT")&&word(current[current.length-2],"IS"))return {phase:"is-not",type:leftType};
 if(word(operator,"IS")){
  let right=nodes.slice(comparison+1);if(word(right[0],"NOT"))right=right.slice(1);
  if(word(right[0],"DISTINCT")){
   if(right.length===1)return {phase:"distinct-from",type:leftType};
   if(word(right[1],"FROM"))return right.length===2?{phase:"operand",type:leftType,scalarOperand:true}:{phase:"continuation",predicate:true};
  }
 }
 if(word(last,"NOT")&&current.length>1)return {phase:"not",type:expressionType(current.slice(0,-1),options)};
 const expectsOperand=(part:Node[])=>!part.length||(part[part.length-1]?.kind==="symbol"&&["+","-","*","/","%","||",".","::"].includes(part[part.length-1]!.text));
 if(between>=segment){
  const right=nodes.slice((betweenAnd>=0?betweenAnd:between)+1);
  if(expectsOperand(right))return {phase:"value",type:leftType};
  return betweenAnd<0?{phase:"between-separator",type:leftType}:{phase:"continuation",predicate:true};
 }
 if(operator){
  let right=nodes.slice(comparison+1);
  if(word(operator,"SIMILAR")){
   if(!right.length)return {phase:"similar-to",type:leftType};
   if(word(right[0],"TO"))right=right.slice(1);
  }
  const patternOperator=word(operator,"SIMILAR")?"SIMILAR TO":operator.text;
  const fullOperator=(word(nodes[comparison-1],"NOT")?"NOT ":"")+patternOperator;
  const escapeType=sqlPatternEscapeType(fullOperator,options.dialect??"");
  const escape=right.findIndex(node=>word(node,"ESCAPE"));
  if(escape>0&&!expectsOperand(right.slice(0,escape))){
   return expectsOperand(right.slice(escape+1))?{phase:"value",type:escapeType,valueRole:"pattern-escape",escapeSupported:Boolean(escapeType)}:{phase:"continuation",predicate:true};
  }
  const isPattern=SQL_PATTERN_WORDS.some(key=>word(operator,key))||operator.kind==="symbol"&&["~","~*","!~","!~*"].includes(operator.text);
  const pattern=sqlPatternValueType(fullOperator,options.dialect??"");
  if(word(operator,"IN")&&!right.length)return {phase:"open-in",type:leftType};
  return expectsOperand(right)?{phase:"value",type:isPattern?pattern:leftType}:{phase:"continuation",predicate:true,canEscape:Boolean(escapeType),escapeAttachable:["LIKE","ILIKE","SIMILAR TO"].includes(patternOperator.toUpperCase())};
 }
 if(!current.length||word(last,"NOT")||expectsOperand(current))return {phase:"operand",scalarOperand:last?.kind==="symbol"&&["+","-","*","/","%","||"].includes(last.text)};
 if(word(current[0],"EXISTS")||(current.length===1&&((last?.kind==="atom"&&last.predicate)||["TRUE","FALSE","NULL"].some(key=>word(last,key)))))return {phase:"continuation",predicate:true};
 return {phase:"operator",type:expressionType(current,options)};
}

/** Fold nested expressions before deciding the current predicate grammar slot. */
export function sqlPredicateContext(options:Options):PredicateContext {
 const lexical=sqlCompletionTokens(options.condition,options.cursorOffset,options.dialect,options.identifierQuote);
 const blocked=!lexical.complete||lexical.region==="literal"||lexical.region==="comment";
 const lastToken=lexical.tokens[lexical.tokens.length-1];
 const consumedKeyword=lastToken?.kind==="word"&&lastToken.end===options.cursorOffset&&keywords.has(lastToken.text.toUpperCase());
 const fallback:PredicateContext={phase:"operand",canAppendPredicate:false,blocked,consumedKeyword,structural:false};if(blocked)return fallback;
 const tokens=lexical.tokens.filter(token=>!(token.start>=options.replacementStart&&(token.kind==="word"||token.kind==="identifier")&&!keywords.has(token.text.toUpperCase())));
 const frames:Frame[]=[{kind:"root",nodes:[],start:0}];
 for(const token of tokens){
  let frame=frames[frames.length-1]!;
  if(word(token,"CASE")){if(frames.length>=128)return {...fallback,blocked:true};frames.push({kind:"case",nodes:[],start:token.start});continue;}
  if(word(token,"END")&&frame.kind==="case"){
   frames.pop();frames[frames.length-1]!.nodes.push({kind:"atom",text:"CASE",start:frame.start,end:token.end,type:caseType(frame.nodes,options)});continue;
  }
  if(token.kind==="symbol"&&token.text==="("){
   if(frames.length>=128)return {...fallback,blocked:true};
   const last=frame.nodes[frame.nodes.length-1];let kind:Frame["kind"]="group",callee:string|undefined,start=token.start;
   if(word(last,"IN"))kind="in";
   else if(last&&isIdentifier(last)){
    const names:Node[]=[frame.nodes.pop()!];
    while(frame.nodes[frame.nodes.length-1]?.text==="."&&frame.nodes[frame.nodes.length-2]&&isIdentifier(frame.nodes[frame.nodes.length-2]!)){names.unshift(frame.nodes.pop()!);names.unshift(frame.nodes.pop()!);}
    callee=names.map(node=>node.text).join("");start=names[0]!.start;kind="call";
   }
   let scalar=kind==="call"||kind==="in"||Boolean(frame.scalar)||frame.kind==="call"||frame.kind==="in";
   if(!scalar){const parent=predicateNodes(frame.nodes),phase=phaseFor(parent.nodes,options);scalar=parent.role==="scalar"||phase.phase==="value"||Boolean(phase.scalarOperand);}
   frames.push({kind,nodes:[],callee,start,scalar});continue;
  }
  if(token.kind==="symbol"&&token.text===")"&&frames.length>1&&frame.kind!=="case"){
   frames.pop();const query=frame.nodes.some(node=>word(node,"SELECT")||word(node,"WITH"));
   const context=phaseFor(predicateNodes(frame.nodes).nodes,options);
   const type=frame.kind==="call"?callType(frame,options):query?undefined:expressionType(frame.nodes,options);
   frames[frames.length-1]!.nodes.push({kind:"atom",text:frame.callee??"()",start:frame.start,end:token.end,type,predicate:frame.kind!=="call"&&!query&&context.predicate});continue;
  }
  frame.nodes.push(token);
 }
 const frame=frames[frames.length-1]!,query=frame.nodes.some(node=>word(node,"SELECT")||word(node,"WITH"));
 if(frames.some(value=>value.kind==="call"&&/^(?:TRY_|SAFE_)?CAST$/iu.test(value.callee??"")&&value.nodes.some(node=>word(node,"AS"))))return {...fallback,phase:"type"};
 for(const value of frames){
  let cast=-1;for(let i=value.nodes.length-1;i>=0;i--)if(value.nodes[i]?.kind==="symbol"&&value.nodes[i]?.text==="::"){cast=i;break;}
  if(cast<0)continue;
  const tail=value.nodes.slice(cast+1),typing=lastToken?.end===options.cursorOffset&&(lastToken.kind==="word"||lastToken.kind==="identifier");
  const typeTokens=tail.every((node,index)=>node.kind==="identifier"||node.kind==="atom"||node.kind==="symbol"&&[".","[","]"].includes(node.text)||node.kind==="word"&&(!keywords.has(node.text.toUpperCase())||typing&&index===tail.length-1&&(index===0||tail[index-1]?.text===".")));
  if(typeTokens&&(!tail.length||typing))return {...fallback,phase:"type"};
 }
 const prepared=predicateNodes(frame.nodes);
 fallback.structural=frame.kind==="root"||frame.kind==="case"||frame.kind==="group"&&(!query||prepared.role==="predicate");
 if(query&&prepared.role==="relation")return {...fallback,phase:"relation"};
 let nodes=prepared.nodes;
 if(frame.kind==="call"||frame.kind==="in")nodes=split(nodes,",").pop()!;
 const context=phaseFor(nodes,options);
 if(frame.kind==="in"&&!query&&["operator","continuation"].includes(context.phase))return {...fallback,phase:"in-continuation",blocked:false};
 if(frame.kind==="case"){
  if(!frame.nodes.some(node=>word(node,"WHEN"))&&context.phase==="operator")return {...fallback,phase:"case-when"};
  if(prepared.role==="predicate"&&context.phase==="continuation")return {...fallback,phase:"case-then"};
  if(prepared.role==="scalar"&&["operator","continuation"].includes(context.phase))return {...fallback,phase:frame.nodes.some(node=>word(node,"ELSE"))?"case-end":"case-result"};
 }
 if(frame.kind==="call"&&["operator","continuation"].includes(context.phase))return {...fallback,phase:"argument-continuation",type:context.type};
 const scalar=frame.kind==="call"||frame.kind==="case"&&prepared.role==="scalar"||(query?prepared.role==="scalar":frame.scalar);
 const phase=context.phase;
 let type=context.type;
 if(frame.kind==="in"&&!query&&phase==="operand"){
  type=phaseFor(frames[frames.length-2]?.nodes??[],options).type;
 }
 return {...fallback,phase:frame.kind==="in"&&!query&&phase==="operand"?"value":phase,type,...(context.valueRole?{valueRole:context.valueRole,escapeSupported:context.escapeSupported}:{}),...(context.canEscape?{canEscape:true}:{}),...(context.escapeAttachable?{escapeAttachable:true}:{}),canAppendPredicate:!scalar&&!context.scalarOperand&&phase==="operand"&&frame.kind!=="in"&&!nodes.some(node=>node.kind==="symbol"&&["+","-","*","/","%","."].includes(node.text)),blocked:false};
}
