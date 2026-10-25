/** Builtin identities used for completion hints, without resolving domains or
 * crossing a profile/schema boundary. Matches the bounded Rust type owner. */
export type PostgresBuiltinType={name:string;modifiers:string;array:boolean};
const internalTypes=new Map(Object.entries({bool:"boolean",int2:"smallint",int4:"integer",int8:"bigint",float4:"real",float8:"double precision",bpchar:"character",char:'"char"',...Object.fromEntries("numeric money text varchar name bytea bit varbit date time timetz timestamp timestamptz interval uuid json jsonb xml inet cidr macaddr macaddr8 tsvector tsquery oid xid xid8 cid pg_lsn regclass regtype regproc regprocedure regoper regoperator regnamespace regrole regcollation regconfig regdictionary point line lseg box path polygon circle int4range int8range numrange tsrange tstzrange daterange int4multirange int8multirange nummultirange tsmultirange tstzmultirange datemultirange".split(" ").map(name=>[name,name]))}));
const aliases:Record<string,string>={integer:"integer",int:"integer",smallint:"smallint",bigint:"bigint",boolean:"boolean",real:"real",decimal:"numeric",character:"character",char:"character",float:"double precision"};
const keyword=(input:string,word:string)=>input.slice(0,word.length).toLowerCase()===word&&!/[a-z0-9_$]/iu.test(input[word.length]??"")?input.slice(0,input.length-input.slice(word.length).trimStart().length):undefined;
function identifier(input:string){
 const match=/^(?:"([^"]*)"|([a-z_][a-z0-9_$]*))\s*/iu.exec(input);
 return match?{name:match[1]??match[2]!.toLowerCase(),quoted:match[1]!==undefined,rest:input.slice(match[0].length)}:undefined;
}
export function postgresBuiltinType(value:string,profile:string|undefined):PostgresBuiltinType|undefined {
 if(!["postgres","postgresql","pgsql","psql"].includes(profile??"")||value.length>1024)return undefined;
 const first=identifier(value.trim());if(!first)return undefined;
 let {name,quoted,rest:tail}=first,qualified=false;
 if(tail.startsWith(".")){
  if(name!=="pg_catalog")return undefined;
  const second=identifier(tail.slice(1).trimStart());if(!second)return undefined;
  ({name,quoted,rest:tail}=second);qualified=true;
 }
 const sqlAlias=!quoted&&!qualified;
 if(sqlAlias){
  if(name==="double"){const word=keyword(tail,"precision");if(!word)return undefined;tail=tail.slice(word.length);name="float8";}
  if(["character","char","bit"].includes(name)){const word=keyword(tail,"varying");if(word){tail=tail.slice(word.length);name=name==="bit"?"varbit":"varchar";}}
 }
 const internalArray=name.startsWith("_"),identity=internalArray?name.slice(1):name;
 let canonical=internalTypes.get(identity)??(sqlAlias&&!internalArray?aliases[identity]:undefined);
 if(!canonical)return undefined;
 if(sqlAlias&&name==="char")canonical="character";
 let modifiers="";
 if(tail.startsWith("(")){
  const match=/^\(\s*([+-]?\d+)\s*(?:,\s*([+-]?\d+)\s*)?\)/u.exec(tail);if(!match)return undefined;
  const width=Number(match[1]),scale=match[2]===undefined?undefined:Number(match[2]);
  if(![width,...(scale===undefined?[]:[scale])].every(value=>Number.isSafeInteger(value)&&value>=-2147483648&&value<=2147483647))return undefined;
  if(scale!==undefined&&canonical!=="numeric"||!["numeric","character","varchar","bit","varbit","time","timetz","timestamp","timestamptz"].includes(canonical)&&!(sqlAlias&&name==="float"))return undefined;
  if(["time","timetz","timestamp","timestamptz"].includes(canonical)){if(width<0||width>6)return undefined;}else if(width<=0)return undefined;
  if(sqlAlias&&name==="float"){if(width>53)return undefined;canonical=width<=24?"real":"double precision";}
  modifiers=match[0];tail=tail.slice(modifiers.length).trimStart();
 }
 if(sqlAlias&&["time","timestamp"].includes(name)){
  for(const qualifier of ["with","without"]){
   const first=keyword(tail,qualifier);if(!first)continue;
   tail=tail.slice(first.length);const time=keyword(tail,"time");if(!time)return undefined;
   tail=tail.slice(time.length);const zone=keyword(tail,"zone");if(!zone)return undefined;
   tail=tail.slice(zone.length);canonical=qualifier==="with"?(name==="time"?"timetz":"timestamptz"):name;break;
  }
 }
 if(!tail)return {name:canonical,modifiers,array:internalArray};
 const arrayKeyword=keyword(tail,"array");let array=internalArray||Boolean(arrayKeyword);
 if(arrayKeyword)tail=tail.slice(arrayKeyword.length);
 while(tail.startsWith("[")){const match=/^\[\s*\d*\s*\]\s*/u.exec(tail);if(!match)return undefined;array=true;tail=tail.slice(match[0].length);}
 return tail?undefined:{name:canonical,modifiers,array};
}
