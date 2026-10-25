import type {TabData} from "@/features/workspace-tabs/model/types";
import type {AppSettings} from "@/lib/appSettings";
import type {LspSchemaDefinition} from "@/services/lsp/schemaConfig";
import type {LspConfigurationPayload} from "@/services/lsp/configDispatch";

export function fileQuerySchema(tab:TabData):LspSchemaDefinition[]{
  return [{id:tab.fileQuery!.session?.id??tab.id,database:"main",driver:tab.fileQuery!.driverId,source_uri:null,functions:[],tables:[{
    name:"data",object_type:"view",comment:null,source_location:null,indexes:[],constraints:[],
    columns:(tab.fileQuery!.schema??[]).map(column=>({name:column.name,data_type:column.data_type,nullable:true,primary_key:false,unique:false,indexed:false,comment:null,source_location:null})),
  }]}];
}
export function fileQueryConfiguration(tab:TabData,uri:string,dialect:string,completion:AppSettings["editor"]["sqlCompletion"],format:AppSettings["editor"]["sqlFormatting"]):LspConfigurationPayload{
  return {defaultDialect:dialect,fileSchemas:{[uri]:tab.fileQuery!.session?.id??tab.id},fileDialects:{[uri]:dialect},schemas:fileQuerySchema(tab),
    completionPreferences:{keywordCase:completion.keywordCase,functionCase:completion.functionCase,tableAlias:completion.tableAlias},
    formattingPreferences:{keywordCase:format.keywordCase,functionCase:format.functionCase,logicalOperatorNewline:format.logicalOperatorNewline,fromClauseLayout:format.fromClauseLayout}};
}
