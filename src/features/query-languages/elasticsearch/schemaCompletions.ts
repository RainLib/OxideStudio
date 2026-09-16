import { elasticsearchCompletionExpectsMappingField } from "@/features/query-languages/elasticsearch/completionContext";
import {
  type ElasticsearchConsoleCompletionContext,
  type ElasticsearchMappingField,
  type ElasticsearchSchemaCompletion,
} from "@/features/query-languages/elasticsearch/types";

/**
 * Narrows schema/LSP results to the responsibility of the current Console
 * context. Built-in DSL keywords are deliberately owned by the Console
 * provider because it inserts complete, valid property snippets.
 */
export function elasticsearchSchemaCompletionsForContext<
  T extends ElasticsearchSchemaCompletion,
>(
  items: T[],
  context: ElasticsearchConsoleCompletionContext,
  preferredIndex?: string,
): T[] {
  const normalizedPreferred = preferredIndex?.toLowerCase();
  if (
    context.area === "method" ||
    context.area === "operation" ||
    context.area === "body-start"
  ) {
    return [];
  }

  if (context.area === "path") {
    return items
      .filter((item) => /elasticsearch index/i.test(item.detail || ""))
      .filter(
        (item, index, rows) =>
          rows.findIndex(
            (candidate) =>
              candidate.label.toLowerCase() === item.label.toLowerCase(),
          ) === index,
      )
      .sort((left, right) => {
        const leftPreferred =
          left.label.toLowerCase() === normalizedPreferred ? 0 : 1;
        const rightPreferred =
          right.label.toLowerCase() === normalizedPreferred ? 0 : 1;
        return (
          leftPreferred - rightPreferred ||
          left.label.localeCompare(right.label, undefined, {
            sensitivity: "base",
            numeric: true,
          })
        );
      })
      .map((item, index) => ({
        ...item,
        insertText: `/${item.label}`,
        insertTextFormat: 1,
        sortText: String(index).padStart(3, "0"),
        detail: item.detail || "Elasticsearch index",
      }));
  }

  const expectsMappingField =
    elasticsearchCompletionExpectsMappingField(context);
  if (!expectsMappingField) return [];

  const mappingItems = items.filter((item) =>
    /elasticsearch field in /i.test(item.detail || ""),
  );
  const scopedItems = normalizedPreferred
    ? mappingItems.filter((item) => {
        const detail = item.detail?.toLowerCase() || "";
        const indexPrefix = `elasticsearch field in ${normalizedPreferred}`;
        return detail === indexPrefix || detail.startsWith(`${indexPrefix}:`);
      })
    : mappingItems;

  return scopedItems
    .sort((left, right) => {
      return left.label.localeCompare(right.label, undefined, {
        sensitivity: "base",
        numeric: true,
      });
    })
    .filter(
      (item, index, rows) =>
        rows.findIndex(
          (candidate) =>
            candidate.label.toLowerCase() === item.label.toLowerCase(),
        ) === index,
    )
    .map((item, index) => ({
      ...item,
      sortText: String(index).padStart(3, "0"),
    }));
}

export function elasticsearchMappingFieldCompletions(
  fields: ElasticsearchMappingField[],
  context: ElasticsearchConsoleCompletionContext,
  indexName: string,
): ElasticsearchSchemaCompletion[] {
  const expectsMappingField =
    elasticsearchCompletionExpectsMappingField(context);
  if (!expectsMappingField) return [];

  const normalizedTyped = context.typed.toLowerCase();
  const uniqueNames = new Set<string>();
  return fields
    .filter((field) => {
      const normalizedName = field.name.toLowerCase();
      if (uniqueNames.has(normalizedName)) return false;
      uniqueNames.add(normalizedName);
      return !normalizedTyped || normalizedName.startsWith(normalizedTyped);
    })
    .sort((left, right) =>
      left.name.localeCompare(right.name, undefined, {
        sensitivity: "base",
        numeric: true,
      }),
    )
    .map((field, index) => ({
      label: field.name,
      insertText: JSON.stringify(field.name),
      detail: `${field.dataType || "field"} · Elasticsearch field in ${indexName}`,
      insertTextFormat: 1,
      sortText: String(index).padStart(4, "0"),
    }));
}
