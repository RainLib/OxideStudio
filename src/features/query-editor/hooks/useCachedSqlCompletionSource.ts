import { useCallback, useEffect, useRef } from "react";
import type { AppSettings } from "@/lib/appSettings";
import {
  cachedSqlJoinTargetContext,
  cachedSqlRelationForFieldCompletion,
  cachedSqlRelationTargetPrefix,
} from "@/lib/queryEditorCachedCompletion";
import { sqlContextKeywordBeforeCursor } from "@/lib/lspCompletion";
import { lspForeignKeyRelationships } from "@/services/lsp/relationshipIndex";
import { loadTableMetadata } from "@/services/tableMetadataCache";
import type {
  ConstraintInfo,
  DatabaseDriver,
  TableInfo,
} from "@/services/tauri/types";
import {
  completionFilterTextForQuery,
  completionMatchScore,
  completionMatches,
  containsHan,
  ensurePinyinCompletionSupport,
} from "../model/completionMatch";
import { mergeCompletionFallbackSuggestions } from "../model/completionFallback";
import {
  sqlForeignKeyJoinCompletions,
  sqlJoinConstraintsFromRelationshipIndex,
} from "../model/sqlJoinCompletion";
import { sqlCompletionIdentifierPrefix } from "../model/sqlCompletionTriggerPolicy";

const SQL_COMPLETION_CONTEXT_MAX_CHARACTERS = 128 * 1024;
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

type CachedSqlCompletionCaches = {
  fields: Map<string, CachedField[]>;
  joinConstraints: Map<string, ConstraintInfo[]>;
};

/**
 * Owns the metadata-sensitive SQL completion fallback independently from the
 * editor component. The returned request factory is stable across renderer
 * updates and reads the latest connection/schema/settings through a ref.
 */
export function useCachedSqlCompletionSource(
  options: CachedSqlCompletionSourceOptions,
) {
  const runtimeRef = useRef(options);
  runtimeRef.current = options;
  const cachesRef = useRef<CachedSqlCompletionCaches>({
    fields: new Map(),
    joinConstraints: new Map(),
  });

  useEffect(() => {
    cachesRef.current.fields.clear();
    cachesRef.current.joinConstraints.clear();
  }, [options.connectionId, options.driver, options.metadataRevision]);

  return useCallback(
    (request: CachedSqlCompletionRequestOptions) =>
      createCachedSqlCompletionRequest(
        runtimeRef.current,
        cachesRef.current,
        request,
      ),
    [],
  );
}

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
  const word = model.getWordUntilPosition(position);
  const range = new monaco.Range(
    position.lineNumber,
    word.startColumn,
    position.lineNumber,
    word.endColumn,
  );
  const query = relationPrefix ?? "";
  return tables
    .filter((table) => completionMatches(table.name, query))
    .map((table) => ({
      label: table.name,
      kind: monaco.languages.CompletionItemKind.Struct,
      detail: "Cached database object",
      documentation: table.comment
        ? { value: table.comment }
        : { value: "Available from cached database metadata." },
      insertText: table.name,
      filterText: completionFilterTextForQuery(table.name, query),
      sortText: completionSortText(table.name, query),
      range,
    }));
}

export function createCachedSqlCompletionRequest(
  runtime: CachedSqlCompletionSourceOptions,
  caches: CachedSqlCompletionCaches,
  request: CachedSqlCompletionRequestOptions,
): CachedSqlCompletionRequest {
  const {
    completionDriver,
    model,
    monaco,
    position,
    textBeforeCursor,
    token,
  } = request;
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
    const databaseName = sourceRelation.database || runtime.databaseName || undefined;
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
    const joinPrefix = joinContext.targetFragment.split(".").pop()?.trim() || "";
    if (
      /^[a-z0-9]+$/iu.test(joinPrefix) &&
      constraints.some((constraint) => containsHan(constraint.referenced_table || ""))
    ) {
      await ensurePinyinCompletionSupport();
    }
    const word = model.getWordUntilPosition(position);
    const range = new monaco.Range(
      position.lineNumber,
      word.startColumn,
      position.lineNumber,
      word.endColumn,
    );
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
    const word = model.getWordUntilPosition(position);
    const range = new monaco.Range(
      position.lineNumber,
      word.startColumn,
      position.lineNumber,
      word.endColumn,
    );

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
          insertText: column,
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
        insertText: column.name,
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
