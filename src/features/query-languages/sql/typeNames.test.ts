import {expect,it} from "vitest";
import {postgresBuiltinType} from "./typeNames";
it.each([
 ["PG_CATALOG . int4","integer",false],['"pg_catalog"."bool"',"boolean",false],['"int4"',"integer",false],
 ["char","character",false],["pg_catalog.char",'"char"',false],["character varying(8)","varchar",false],
 ["timestamp(3) with time zone","timestamptz",false],["float(24)","real",false],
 ["pg_catalog._bool","boolean",true],["pg_catalog.bool [2][]","boolean",true],["integer ARRAY[3]","integer",true],
])("resolves builtin identity %s",(type,name,array)=>{expect(postgresBuiltinType(type,"postgres")).toMatchObject({name,array});});
it.each(['public.int4','"PG_CATALOG".int4','pg_catalog."INT4"','"pg_catalog.int4"','pg_catalog.integer','"boolean"','pg_catalog.int4(2)','bool trailing','numeric(1,2,3)','timestamp(7)','float(54)','pg_catalog._integer','int4[bad]','int4[2] trailing','"in""t4"','pg_catalog.int4.other',"int4".repeat(257)])("keeps unresolved or over-budget identity %s unknown",type=>{expect(postgresBuiltinType(type,"postgres")).toBeUndefined();});
it.each(["mysql","sqlserver","sqlite","duckdb","clickhouse","hive",undefined])("does not reinterpret a catalog name in %s",profile=>{expect(postgresBuiltinType("pg_catalog.bool",profile)).toBeUndefined();});
