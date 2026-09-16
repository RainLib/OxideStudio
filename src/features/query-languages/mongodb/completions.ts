import { mongodbConsoleCompletionContext } from "@/features/query-languages/mongodb/completionContext";
import {
  fieldReferenceItems,
  matches,
  operatorItems,
  propertyItems,
  shellOptionItems,
  stageOptionItems,
} from "@/features/query-languages/mongodb/completionItems";
import {
  ACCUMULATORS,
  COMMAND_OPTIONS,
  EXPRESSION_OPERATORS,
  MAX_MONGODB_COMPLETION_ITEMS,
  PIPELINE_STAGES,
  PUSH_MODIFIERS,
  QUERY_OPERATORS,
  ROOT_COMMANDS,
  UPDATE_OPERATORS,
  VALUE_COMPLETIONS,
} from "@/features/query-languages/mongodb/jsonCatalog";
import {
  MONGODB_SHELL_CHAIN_COMPLETIONS,
  MONGODB_SHELL_COUNT_COMPLETION,
  MONGODB_SHELL_DATABASE_COMPLETIONS,
  MONGODB_SHELL_METHOD_COMPLETIONS,
  MONGODB_SHELL_ROOT_COMPLETIONS,
} from "@/features/query-languages/mongodb/shellCatalog";
import {
  type MongoDbCompletionInput,
  type MongoDbConsoleCompletion,
} from "@/features/query-languages/mongodb/types";

export function buildMongoDbConsoleCompletions(
  source: string,
  cursorOffset: number,
  input: MongoDbCompletionInput = {},
) {
  const context = mongodbConsoleCompletionContext(source, cursorOffset);
  const typedForMetadata = context.typed
    .replace(/^\$/u, "")
    .toLocaleLowerCase();
  const collections = [...new Set(input.collections || [])]
    .filter(
      (name) =>
        !typedForMetadata ||
        name.toLocaleLowerCase().startsWith(typedForMetadata),
    )
    .sort((left, right) => left.localeCompare(right));
  const fields = [
    ...new Map(
      (input.fields || [])
        .filter(
          (field) =>
            !typedForMetadata ||
            field.name.toLocaleLowerCase().startsWith(typedForMetadata),
        )
        .map((field) => [field.name.toLocaleLowerCase(), field]),
    ).values(),
  ].sort((left, right) => left.name.localeCompare(right.name));
  let items: MongoDbConsoleCompletion[];
  switch (context.area) {
    case "shell-root":
      items = MONGODB_SHELL_ROOT_COMPLETIONS.filter((item) =>
        matches(item.label, context.typed),
      );
      break;
    case "shell-qualified": {
      const dot = context.typed.lastIndexOf(".");
      const collectionPrefix = context.typed.slice(0, dot);
      const methodPrefix = context.typed.slice(dot + 1);
      const exactCollection = (input.collections || []).some(
        (name) =>
          name.toLocaleLowerCase() === collectionPrefix.toLocaleLowerCase(),
      );
      const qualifiedCollections = [...new Set(input.collections || [])]
        .filter((name) =>
          name
            .toLocaleLowerCase()
            .startsWith(context.typed.toLocaleLowerCase()),
        )
        .sort((left, right) => left.localeCompare(right))
        .map((name) => ({
          label: name,
          detail: "MongoDB collection",
          insertText: `getCollection(${JSON.stringify(name)})`,
          filterText: name,
          kind: "value" as const,
        }));
      const qualifiedMethods = MONGODB_SHELL_METHOD_COMPLETIONS.filter((item) =>
        matches(item.label, methodPrefix),
      ).map((item) => ({
        ...item,
        insertText: `${collectionPrefix}.${item.insertText}`,
        filterText: `${collectionPrefix}.${item.label}`,
      }));
      items = exactCollection
        ? [...qualifiedMethods, ...qualifiedCollections]
        : [...qualifiedCollections, ...qualifiedMethods];
      break;
    }
    case "shell-method":
      items = MONGODB_SHELL_METHOD_COMPLETIONS.filter((item) =>
        matches(item.label, context.typed),
      );
      break;
    case "shell-chain":
      items = MONGODB_SHELL_CHAIN_COMPLETIONS.filter((item) =>
        matches(item.label, context.typed),
      );
      if (
        context.parentKey === "find-countable" &&
        matches(MONGODB_SHELL_COUNT_COMPLETION.label, context.typed)
      ) {
        items.push(MONGODB_SHELL_COUNT_COMPLETION);
      }
      break;
    case "shell-option":
      items = shellOptionItems(context.parentKey, context.typed);
      break;
    case "root":
      items = ROOT_COMMANDS.filter((item) =>
        matches(item.label, context.typed),
      );
      break;
    case "collection":
      items = collections
        .filter((name) => matches(name, context.typed))
        .map((name) => ({
          label: name,
          detail: "MongoDB collection",
          insertText:
            context.syntax === "shell" && !/^[\p{L}\p{N}_-]+$/u.test(name)
              ? `getCollection(${JSON.stringify(name)})`
              : name,
          kind: "value",
        }));
      if (context.syntax === "shell") {
        items.push(
          ...MONGODB_SHELL_DATABASE_COMPLETIONS.filter((item) =>
            matches(item.label, context.typed),
          ),
        );
      }
      break;
    case "field":
      items = fields
        .filter((field) => matches(field.name, context.typed))
        .map((field) => ({
          label: field.name,
          detail: field.dataType || "MongoDB field",
          insertText: field.name,
          kind: "field",
        }));
      break;
    case "query-operator":
      items = operatorItems(
        QUERY_OPERATORS,
        context.typed,
        "MongoDB query operator",
      );
      break;
    case "update-operator":
      items = operatorItems(
        UPDATE_OPERATORS,
        context.typed,
        "MongoDB update operator",
      );
      break;
    case "push-modifier":
      items = operatorItems(
        PUSH_MODIFIERS,
        context.typed,
        "MongoDB array update modifier",
      );
      break;
    case "pipeline-stage":
      items = operatorItems(
        PIPELINE_STAGES,
        context.typed,
        "MongoDB aggregation stage",
      );
      break;
    case "accumulator":
      items = operatorItems(
        ACCUMULATORS,
        context.typed,
        "MongoDB group accumulator",
      );
      break;
    case "expression":
      items = operatorItems(
        EXPRESSION_OPERATORS,
        context.typed,
        "MongoDB aggregation expression",
      );
      break;
    case "field-reference":
      items = fieldReferenceItems(fields, context.typed);
      break;
    case "stage-option":
      items = stageOptionItems(context.parentKey, context.typed);
      break;
    case "value":
      items = context.quoted
        ? []
        : VALUE_COMPLETIONS.filter((item) =>
            matches(item.label, context.typed),
          );
      break;
    case "key":
      items = propertyItems(
        COMMAND_OPTIONS[context.parentKey || ""] || [
          "filter",
          "projection",
          "sort",
          "limit",
          "skip",
          "database",
        ],
        context.typed,
        "MongoDB command option",
      );
      break;
    default:
      items = [];
  }
  return { context, items: items.slice(0, MAX_MONGODB_COMPLETION_ITEMS) };
}
