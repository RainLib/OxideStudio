import type { AppSettings } from "@/lib/appSettings";
import { sqlContextKeywordBeforeCursor } from "@/lib/lspCompletion";
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
import { mergeCompletionFallbackSuggestions } from "../model/completionFallback";
import {
  completionFilterTextForQuery,
  completionMatchScore,
  completionMatches,
  containsHan,
  ensurePinyinCompletionSupport,
} from "../model/completionMatch";
import {
  sqlCompletionIdentifierFragment,
  sqlCompletionIdentifierPrefix,
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
  const word = model.getWordUntilPosition(position);
  const line = model.getLineContent?.(position.lineNumber) || "";
  const consumesClosingQuote =
    replacement.closingQuote !== undefined &&
    line[position.column - 1] === replacement.closingQuote;
  return new monaco.Range(
    position.lineNumber,
    replacement.replacementLength > 0
      ? position.column - replacement.replacementLength
      : word.startColumn,
    position.lineNumber,
    consumesClosingQuote ? position.column + 1 : word.endColumn,
  );
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
  completionDriver: string;
  model: any;
  monaco: any;
  position: any;
  textBeforeCursor: string;
  token: CompletionCancellationToken;
};

export type CachedSqlCompletionRequest = {
  joinSuggestions: () => Promise<any[]>;
  metadataSuggestions: () => Promise<any[]>;
  suggestions: () => Promise<any[]>;
};

export type CachedSqlCompletionCaches = {
  fields: Map<string, CachedField[]>;
  joinConstraints: Map<string, ConstraintInfo[]>;
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
  const range = cachedCompletionRange(monaco, model, position, replacement);
  const query = relationPrefix ?? "";
  return tables
    .map((table, index) => ({
      table,
      index,
      score: completionMatchScore(table.name, query),
    }))
    .filter(({ score }) => score >= 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, MAX_CACHED_RELATION_COMPLETION_ITEMS)
    .map(({ table, score }) => ({
      label: table.name,
      kind: monaco.languages.CompletionItemKind.Struct,
      detail: "Cached database object",
      documentation: table.comment
        ? { value: table.comment }
        : { value: "Available from cached database metadata." },
      insertText: quotedCompletionInsertText(table.name, replacement),
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
  const { completionDriver, model, monaco, position, textBeforeCursor, token } =
    request;
  const nonSqlDocument = ["elasticsearch", "elastic", "mongodb"].includes(
    completionDriver,
  );

  const relationSuggestions = async () => {
    if (nonSqlDocument) return [];
    const relationPrefix = cachedSqlRelationTargetPrefix(textBeforeCursor);
    if (
      relationPrefix &&
      /^[a-z0-9]+$/iu.test(relationPrefix) &&
      runtime.schemaTables.some((table) => containsHan(table.name))
    ) {
      await ensurePinyinCompletionSupport();
    }
    return cachedRelationCompletionSuggestions(
      monaco,
      model,
      position,
      runtime.schemaTables,
      textBeforeCursor,
    );
  };

  const joinSuggestions = async () => {
    if (!runtime.connectionId || nonSqlDocument) return [];
    const joinContext = cachedSqlJoinTargetContext(textBeforeCursor);
    const sourceRelation = joinContext?.sourceRelations
      .slice()
      .reverse()
      .find((relation) => !relation.isCte);
    if (!joinContext || !sourceRelation) return [];

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

  const fieldSuggestions = async () => {
    if (!runtime.connectionId || nonSqlDocument) return [];
    if (
      RELATION_COMPLETION_CONTEXTS.has(
        sqlContextKeywordBeforeCursor(textBeforeCursor) || "",
      )
    ) {
      return [];
    }
    const relation = cachedSqlRelationForFieldCompletion(textBeforeCursor);
    if (!relation) return [];
    const fieldQuery = sqlCompletionIdentifierPrefix(textBeforeCursor);
    const replacement = sqlCompletionIdentifierFragment(textBeforeCursor);
    const range = cachedCompletionRange(monaco, model, position, replacement);

    if (relation.isCte || relation.isDerived) {
      const relationKind = relation.isDerived ? "Derived table" : "CTE";
      const declaredColumns = relation.cteColumns || [];
      if (
        /^[a-z0-9]+$/iu.test(fieldQuery) &&
        declaredColumns.some(containsHan)
      ) {
        await ensurePinyinCompletionSupport();
      }
      return declaredColumns
        .filter((column) => completionMatches(column, fieldQuery))
        .map((column) => ({
          label: column,
          kind: monaco.languages.CompletionItemKind.Field,
          detail: `${relationKind} column`,
          documentation: {
            value: `Column declared by ${relationKind.toLocaleLowerCase()} ${relation.table}.`,
          },
          insertText: quotedCompletionInsertText(column, replacement),
          filterText: completionFilterTextForQuery(column, fieldQuery),
          sortText: completionSortText(column, fieldQuery),
          range,
        }));
    }

    const schema =
      relation.schema ||
      runtime.targetSchema ||
      runtime.currentSchema ||
      runtime.databaseName ||
      undefined;
    if (!schema) return [];
    const databaseName = relation.database || runtime.databaseName || undefined;
    const cacheKey = completionCacheKey(runtime, databaseName, schema, [
      relation.table,
    ]);
    let columns = caches.fields.get(cacheKey);
    if (!columns) {
      try {
        const metadata = await loadTableMetadata({
          projectId: runtime.activeProjectId || undefined,
          connectionId: runtime.connectionId,
          driver: runtime.driver,
          databaseName,
          schema,
          table: relation.table,
          includeIndexes: false,
          includeConstraints: false,
        });
        columns = metadata.columns.map((column) => ({
          name: column.name,
          dataType: column.data_type || "column",
          comment: column.comment,
        }));
        caches.fields.set(cacheKey, columns);
      } catch (error) {
        console.debug(
          `[QueryEditor] Cached field metadata unavailable for ${relation.table}`,
          error,
        );
        return [];
      }
    }
    if (token?.isCancellationRequested) return [];
    if (
      /^[a-z0-9]+$/iu.test(fieldQuery) &&
      columns.some((column) => containsHan(column.name))
    ) {
      await ensurePinyinCompletionSupport();
    }
    return columns
      .filter((column) => completionMatches(column.name, fieldQuery))
      .map((column) => ({
        label: column.name,
        kind: monaco.languages.CompletionItemKind.Field,
        detail: `Cached ${column.dataType}`,
        documentation: column.comment
          ? { value: column.comment }
          : { value: `Column from cached metadata for ${relation.table}.` },
        insertText: quotedCompletionInsertText(column.name, replacement),
        filterText: completionFilterTextForQuery(column.name, fieldQuery),
        sortText: completionSortText(column.name, fieldQuery),
        range,
      }));
  };

  const metadataSuggestions = async () => {
    const fields = await fieldSuggestions();
    return fields.length > 0 ? fields : relationSuggestions();
  };
  const suggestions = async () =>
    mergeCompletionFallbackSuggestions(
      await joinSuggestions(),
      await metadataSuggestions(),
    );

  return { joinSuggestions, metadataSuggestions, suggestions };
}

function completionCacheKey(
  runtime: CachedSqlCompletionSourceOptions,
  databaseName: string | undefined,
  schema: string,
  suffix: string[],
) {
  return [
    runtime.activeProjectId || "local",
    runtime.connectionId,
    runtime.driver,
    databaseName || "",
    schema,
    ...suffix,
  ].join("\u0000");
}

function completionSortText(name: string, query: string) {
  const score = Math.max(0, completionMatchScore(name, query));
  return `0:${String(9_999 - score).padStart(4, "0")}:${name.toLocaleLowerCase()}`;
}
