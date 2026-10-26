import type { AppSettings } from "@/lib/appSettings";
import { cachedIdentifierRange, cachedIdentifierInsertion } from "./cached-completion/identifierEdits";
import { searchCachedColumns, boundedCachedComment } from "./cached-completion/metadataSearch";
import { rememberCachedFields, cachedMetadataKey as completionCacheKey } from "./cached-completion/fieldCache";
import { cachedSqlDocumentContext } from "./cached-completion/documentContext";
import { createCachedLocalMetadataResolver } from "./cached-completion/localMetadata";
import type { CachedSqlRelationReference } from "./cached-completion/types";
import type { CachedColumnSet } from "./cached-completion/metadataSearch";
import { cachedPhysicalNamespaceSupported, cachedCatalogNamespaceMatches } from "./cached-completion/namespace";
import { cachedSqlRelationTargetFragment } from "./cached-completion/relations";
import { sqlContextKeywordBeforeCursor } from "@/lib/lspCompletion";
import {projectionSourceContext, sqlProjectionSourceCompletions} from "./sqlProjectionSourceCompletion";
import { completionRelationCatalog, type RelationCatalogCache } from "./cached-completion/relationCatalog";
import {
  cachedSqlJoinTargetContext,
  cachedSqlRelationForFieldCompletion,
  cachedSqlRelationTargetPrefix,
} from "@/lib/queryEditorCachedCompletion";
import { lspForeignKeyRelationships } from "@/services/lsp/relationshipIndex";
import { loadTableMetadata } from "@/services/tableMetadataCache";
import type {
  ConstraintInfo,
  DatabaseDriver,
  TableInfo,
} from "@/services/tauri/types";
import {captureCompletionContext, type CompletionContextSnapshot} from "@/services/lsp/semanticContext";
import { mergeCompletionFallbackSuggestions } from "../model/completionFallback";
import {
  completionFilterTextForQuery,
  completionMatchScore,
  containsHan,
  ensurePinyinCompletionSupport,
} from "../model/completionMatch";
import {
  sqlCompletionIdentifierFragment,
  type SqlCompletionIdentifierFragment,
} from "../model/sqlCompletionTriggerPolicy";
import {
  sqlForeignKeyJoinCompletions,
  sqlJoinConstraintsFromRelationshipIndex,
} from "../model/sqlJoinCompletion";

const SQL_COMPLETION_CONTEXT_MAX_CHARACTERS = 128 * 1024;
const MAX_CACHED_RELATION_COMPLETION_ITEMS = 512;

function cachedCompletionRange(
  monaco: any,
  model: any,
  position: any,
  replacement: SqlCompletionIdentifierFragment,
) {
  return cachedIdentifierRange(monaco,model,position,replacement);
}

function quotedCompletionInsertText(
  value: string,
  replacement: SqlCompletionIdentifierFragment,
) {
  if (!replacement.openingQuote || !replacement.closingQuote) return value;
  const escaped = value
    .split(replacement.closingQuote)
    .join(replacement.closingQuote + replacement.closingQuote);
  return `${replacement.openingQuote}${escaped}${replacement.closingQuote}`;
}
const RELATION_COMPLETION_CONTEXTS = new Set([
  "from",
  "join",
  "into",
  "update",
  "table",
  "truncate",
  "describe",
  "desc",
]);

type SqlCompletionSettings = AppSettings["editor"]["sqlCompletion"];
type SqlFormattingSettings = AppSettings["editor"]["sqlFormatting"];
type CompletionCancellationToken = { isCancellationRequested?: boolean };
type CachedField = { name: string; dataType: string; comment?: string | null };

export type CachedSqlCompletionSourceOptions = {
  cacheScope?: unknown;
  activeProjectId?: string | null;
  connectionId?: string | null;
  currentSchema?: string | null;
  databaseName?: string | null;
  driver: DatabaseDriver;
  metadataRevision: number;
  schemaTables: TableInfo[];
  sqlCompletion: SqlCompletionSettings;
  sqlFormatting: SqlFormattingSettings;
  targetSchema?: string | null;
};

export type CachedSqlCompletionRequestOptions = {
  context?: CompletionContextSnapshot;
  completionDriver: string;
  model: any;
  monaco: any;
  position: any;
  textBeforeCursor: string;
  token: CompletionCancellationToken;
};

export type CachedSqlCompletionRequest = {
  isIncomplete?: () => boolean;
  joinSuggestions: () => Promise<any[]>;
  metadataSuggestions: () => Promise<any[]>;
  suggestions: () => Promise<any[]>;
};

export type CachedSqlCompletionCaches = {
  fields: Map<string, CachedField[]>;
  joinConstraints: Map<string, ConstraintInfo[]>;
  relationCatalog?: RelationCatalogCache;
};

export function boundedSqlCompletionTextBeforeCursor(
  monaco: any,
  model: any,
  position: any,
) {
  if (
    typeof model.getOffsetAt !== "function" ||
    typeof model.getPositionAt !== "function"
  ) {
    return model.getValueInRange(
      new monaco.Range(1, 1, position.lineNumber, position.column),
    );
  }
  const cursorOffset = model.getOffsetAt(position);
  const requestedStart = Math.max(
    0,
    cursorOffset - SQL_COMPLETION_CONTEXT_MAX_CHARACTERS,
  );
  const requestedPosition = model.getPositionAt(requestedStart);
  return model.getValueInRange(
    new monaco.Range(
      requestedPosition.lineNumber,
      1,
      position.lineNumber,
      position.column,
    ),
  );
}

export function cachedRelationCompletionSuggestions(
  monaco: any,
  model: any,
  position: any,
  tables: TableInfo[],
  textBeforeCursor = boundedSqlCompletionTextBeforeCursor(
    monaco,
    model,
    position,
  ),
  onIncomplete?: (value: boolean) => void,
) {
  const relationPrefix = cachedSqlRelationTargetPrefix(textBeforeCursor);
  if (
    relationPrefix === null &&
    !RELATION_COMPLETION_CONTEXTS.has(
      sqlContextKeywordBeforeCursor(textBeforeCursor) || "",
    )
  ) {
    return [];
  }
  const replacement = sqlCompletionIdentifierFragment(textBeforeCursor);
  const completedKeyword=Boolean(sqlContextKeywordBeforeCursor(textBeforeCursor))&&!/\s$/u.test(textBeforeCursor);
  const range = completedKeyword?new monaco.Range(position.lineNumber,position.column,position.lineNumber,position.column):cachedCompletionRange(monaco, model, position, replacement);
  const query = relationPrefix ?? "";
  const matches=tables
    .map((table, index) => ({
      table,
      index,
      score: completionMatchScore(table.name, query),
    }))
    .filter(({ score }) => score >= 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  onIncomplete?.(matches.length>MAX_CACHED_RELATION_COMPLETION_ITEMS);
  return matches.slice(0, MAX_CACHED_RELATION_COMPLETION_ITEMS)
    .map(({ table, score }) => ({
      label: table.name,
      kind: monaco.languages.CompletionItemKind.Struct,
      detail: "Cached database object",
      documentation: table.comment
        ? { value: table.comment }
        : { value: "Available from cached database metadata." },
      insertText: `${completedKeyword?" ":""}${quotedCompletionInsertText(table.name, completedKeyword?{prefix:"",replacementLength:0}:replacement)}`,
      filterText: completionFilterTextForQuery(table.name, query),
      sortText: `0:${String(9_999 - Math.max(0, score)).padStart(4, "0")}:${table.name.toLocaleLowerCase()}`,
      range,
    }));
}

export function createCachedSqlCompletionRequest(
  runtime: CachedSqlCompletionSourceOptions,
  caches: CachedSqlCompletionCaches,
  request: CachedSqlCompletionRequestOptions,
): CachedSqlCompletionRequest {
  const context = request.context || captureCompletionContext();
  const canUsePhysical = () => context.isCurrent() && context.metadataAllowed;
  const { completionDriver, model, monaco, position, textBeforeCursor, token } =
    request;
  let incomplete=false;
  const nonSqlDocument = ["elasticsearch", "elastic", "mongodb"].includes(
    completionDriver,
  );
  const relationTables = () => completionRelationCatalog({
    tables: runtime.schemaTables, connectionId: runtime.connectionId, database: runtime.databaseName,
    schema: runtime.targetSchema || runtime.currentSchema || runtime.databaseName,
    cache: caches.relationCatalog ??= new Map(),
    allowed: () => canUsePhysical() && !token?.isCancellationRequested,
  });

  const relationSuggestions = async () => {
    if (nonSqlDocument||token?.isCancellationRequested||!canUsePhysical()) return [];
    const fragment=cachedSqlRelationTargetFragment(textBeforeCursor);
    if(fragment!==null&&!cachedCatalogNamespaceMatches(fragment,{databaseName:runtime.databaseName,schema:runtime.targetSchema||runtime.currentSchema||runtime.databaseName}))return [];
    const relationPrefix = cachedSqlRelationTargetPrefix(textBeforeCursor);
    if (relationPrefix === null && !RELATION_COMPLETION_CONTEXTS.has(sqlContextKeywordBeforeCursor(textBeforeCursor) || "")) return [];
    const tables = await relationTables();
    if (
      relationPrefix &&
      /^[a-z0-9]+$/iu.test(relationPrefix) &&
      tables.some((table) => containsHan(table.name))
    ) {
      await ensurePinyinCompletionSupport();
    }
    if(token?.isCancellationRequested)return [];
    return cachedRelationCompletionSuggestions(
      monaco,
      model,
      position,
      tables,
      textBeforeCursor,
      value=>{incomplete=value;},
    );
  };

  const joinSuggestions = async () => {
    if (!runtime.connectionId || nonSqlDocument||token?.isCancellationRequested||!canUsePhysical()) return [];
    const joinContext = cachedSqlJoinTargetContext(textBeforeCursor);
    const sourceRelation = joinContext?.sourceRelations
      .slice()
      .reverse()
      .find((relation) => !relation.isCte && !relation.isDerived);
    if (!joinContext || !sourceRelation) return [];
    if(!cachedPhysicalNamespaceSupported(sourceRelation)||!cachedCatalogNamespaceMatches(joinContext.targetFragment,{databaseName:runtime.databaseName,schema:runtime.targetSchema||runtime.currentSchema||runtime.databaseName}))return [];

    const schema =
      sourceRelation.schema ||
      runtime.targetSchema ||
      runtime.currentSchema ||
      runtime.databaseName ||
      undefined;
    if (!schema) return [];
    const databaseName =
      sourceRelation.database || runtime.databaseName || undefined;
    const cacheKey = completionCacheKey(runtime, databaseName, schema, [
      sourceRelation.table,
      "foreign-keys",
    ]);
    const modelVersion = model.getVersionId();
    let constraints = caches.joinConstraints.get(cacheKey);
    if (!constraints) {
      const indexedConstraints = sqlJoinConstraintsFromRelationshipIndex(
        sourceRelation,
        schema,
        lspForeignKeyRelationships({
          connectionId: runtime.connectionId,
          driver: runtime.driver,
          databaseName,
          schema,
        }),
      );
      try {
        const metadata = await loadTableMetadata({
          projectId: runtime.activeProjectId || undefined,
          connectionId: runtime.connectionId,
          driver: runtime.driver,
          databaseName,
          schema,
          table: sourceRelation.table,
          includeIndexes: false,
          includeConstraints: true,
        });
        constraints = [...indexedConstraints, ...metadata.constraints];
      } catch (error) {
        console.debug(
          `[QueryEditor] Foreign-key metadata unavailable for ${sourceRelation.table}`,
          error,
        );
        constraints = indexedConstraints;
      }
      if (!canUsePhysical()) return [];
      caches.joinConstraints.set(cacheKey, constraints);
    }
    if (
      token?.isCancellationRequested ||
      model.getVersionId() !== modelVersion
    ) {
      return [];
    }
    const joinPrefix =
      joinContext.targetFragment.split(".").pop()?.trim() || "";
    if (
      /^[a-z0-9]+$/iu.test(joinPrefix) &&
      constraints.some((constraint) =>
        containsHan(constraint.referenced_table || ""),
      )
    ) {
      await ensurePinyinCompletionSupport();
    }
    const replacement = sqlCompletionIdentifierFragment(textBeforeCursor);
    const range = cachedCompletionRange(monaco, model, position, replacement);
    return sqlForeignKeyJoinCompletions(
      joinContext,
      sourceRelation,
      constraints,
      {
        driver: runtime.driver,
        defaultSchema: schema,
        keywordCase:
          runtime.sqlFormatting.keywordCase === "preserve"
            ? undefined
            : runtime.sqlFormatting.keywordCase,
      },
    ).map((completion) => ({
      ...completion,
      kind: monaco.languages.CompletionItemKind.Reference,
      documentation: { value: completion.documentation },
      range,
    }));
  };

  const physicalWork = new Map<string, Promise<CachedColumnSet>>();
  const physicalColumns = (relation: CachedSqlRelationReference): Promise<CachedColumnSet> => {
    const unavailable=()=>Promise.resolve({columns:[],complete:false});
    if(!canUsePhysical()||!cachedPhysicalNamespaceSupported(relation))return unavailable();
    const schema = relation.schema || runtime.targetSchema || runtime.currentSchema || runtime.databaseName || undefined;
    if (!schema || !runtime.connectionId || token?.isCancellationRequested) return unavailable();
    const databaseName = relation.database || runtime.databaseName || undefined;
    const cacheKey = completionCacheKey(runtime,databaseName,schema,[relation.table]);
    const pending = physicalWork.get(cacheKey);
    if (pending) return pending;
    if(physicalWork.size>=16){incomplete=true;return unavailable();}
    const cached = caches.fields.get(cacheKey);
    if(cached){const found=Promise.resolve({columns:cached,complete:true});physicalWork.set(cacheKey,found);return found;}
    const work = (async () => {
      try {
        const metadata = await loadTableMetadata({projectId:runtime.activeProjectId||undefined,connectionId:runtime.connectionId!,driver:runtime.driver,databaseName,schema,table:relation.table,includeIndexes:false,includeConstraints:false});
        const columns = metadata.columns.map(column=>({name:column.name,dataType:column.data_type||"column",comment:boundedCachedComment(column.comment,8192)}));
        if (!canUsePhysical()) return {columns:[],complete:false};
        rememberCachedFields(caches.fields,cacheKey,columns);
        return {columns,complete:true};
      } catch (error) { console.debug(`[QueryEditor] Cached field metadata unavailable for ${relation.table}`,error); return {columns:[],complete:false}; }
    })();
    physicalWork.set(cacheKey,work);
    return work;
  };

  const fieldSuggestions = async () => {
    if (nonSqlDocument||token?.isCancellationRequested) return [];
    const document = cachedSqlDocumentContext(model, position, textBeforeCursor);
    if (!document) { incomplete = true; return []; }
    const prefix = { source: document.source.slice(0, document.cursorOffset), masked: document.masked.slice(0, document.cursorOffset) };
    if (!prefix.masked.trim()) return [];
    if(cachedSqlRelationTargetPrefix(prefix.source,prefix)!==null)return [];
    if (
      RELATION_COMPLETION_CONTEXTS.has(
        sqlContextKeywordBeforeCursor(prefix.source) || "",
      )
    ) {
      return [];
    }
    const relation = cachedSqlRelationForFieldCompletion(prefix.source, document);
    if (!relation) return [];
    const completedKeyword=Boolean(sqlContextKeywordBeforeCursor(prefix.source))&&!/\s$/u.test(prefix.source);
    const replacement = completedKeyword?{prefix:"",replacementLength:0}:sqlCompletionIdentifierFragment(prefix.source);
    if(replacement.unsupported)return [];
    const fieldQuery = replacement.prefix;
    const range = completedKeyword?new monaco.Range(position.lineNumber,position.column,position.lineNumber,position.column):cachedCompletionRange(monaco, model, position, replacement);
    const insertField=(name:string)=>`${completedKeyword?" ":""}${cachedIdentifierInsertion(name,replacement,runtime.driver)}`;

    if (relation.isCte || relation.isDerived) {
      const relationKind = relation.isDerived ? "Derived table" : "CTE";
      const resolver = createCachedLocalMetadataResolver(document, physicalColumns, {driver:runtime.driver,token,onIncomplete:()=>{incomplete=true;}});
      const columns = await resolver.resolve(relation);
      const matched=await searchCachedColumns(columns,fieldQuery,token);
      incomplete ||= matched.incomplete;
      return matched.items.map(({column,filterText,sortText}) => ({
          label: column.name,
          kind: monaco.languages.CompletionItemKind.Field,
          detail: column.dataType === "column" ? `${relationKind} column` : `Cached ${column.dataType}`,
          documentation: {
            value: column.comment || `Column declared by ${relationKind.toLocaleLowerCase()} ${relation.table}.`,
          },
          insertText: insertField(column.name),
          filterText,
          sortText,
          range,
        }));
    }

    const {columns} = await physicalColumns(relation);
    if (token?.isCancellationRequested) return [];
    const matched=await searchCachedColumns(columns,fieldQuery,token);
    incomplete=matched.incomplete;
    return matched.items
      .map(({column,filterText,sortText}) => ({
        label: column.name,
        kind: monaco.languages.CompletionItemKind.Field,
        detail: `Cached ${column.dataType}`,
        documentation: column.comment
          ? { value: column.comment }
          : { value: `Column from cached metadata for ${relation.table}.` },
        insertText: insertField(column.name),
        filterText,
        sortText,
        range,
      }));
  };

  const metadataSuggestions = async () => {
    const fields = await fieldSuggestions();
    if(fields.length>0)return fields;
    if(canUsePhysical()&&!nonSqlDocument&&projectionSourceContext(model,position,textBeforeCursor)){
      const sources=sqlProjectionSourceCompletions({model,position,prefix:textBeforeCursor,monaco,tables:await relationTables(),driver:runtime.driver,database:runtime.databaseName,schema:runtime.targetSchema||runtime.currentSchema,keywordCase:runtime.sqlFormatting.keywordCase});
      if(sources.length)return sources;
    }
    return relationSuggestions();
  };
  let metadataWork:Promise<any[]>|undefined,joinWork:Promise<any[]>|undefined;
  const guard = async (load:()=>Promise<any[]>) => {
    if(token?.isCancellationRequested||!context.isCurrent())return [];
    const items=await load();
    return token?.isCancellationRequested||!context.isCurrent()?[]:items;
  };
  const memoMetadata=()=>guard(()=>(metadataWork??=metadataSuggestions()));
  const memoJoins=()=>guard(()=>(joinWork??=joinSuggestions()));
  const suggestions = async () =>
    mergeCompletionFallbackSuggestions(
      await memoJoins(),
      await memoMetadata(),
    );

  return { joinSuggestions:memoJoins, metadataSuggestions:memoMetadata, suggestions, isIncomplete:()=>incomplete };
}
