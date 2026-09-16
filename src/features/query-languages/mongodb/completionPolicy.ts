import { mongodbConsoleCompletionContext } from "@/features/query-languages/mongodb/completionContext";
import { matches } from "@/features/query-languages/mongodb/completionItems";
import { VALUE_COMPLETIONS } from "@/features/query-languages/mongodb/jsonCatalog";
import { type MongoDbCompletionArea } from "@/features/query-languages/mongodb/types";

/** Compatibility shape used by the auto-suggest lifecycle. */
export function mongodbCompletionArea(
  source: string,
  cursorOffset: number,
): MongoDbCompletionArea | "unknown" {
  const area = mongodbConsoleCompletionContext(source, cursorOffset).area;
  if (
    area === "root" ||
    area === "shell-root" ||
    area === "shell-qualified" ||
    area === "shell-method" ||
    area === "shell-chain"
  )
    return "key";
  if (
    area === "field" ||
    area === "query-operator" ||
    area === "update-operator" ||
    area === "push-modifier" ||
    area === "pipeline-stage" ||
    area === "accumulator" ||
    area === "expression"
  ) {
    return "key";
  }
  return area;
}

export function shouldOfferMongoDbCompletions(
  source: string,
  cursorOffset: number,
) {
  const context = mongodbConsoleCompletionContext(source, cursorOffset);
  if (context.area === "unknown") return false;
  if (context.area !== "value") return true;
  return (
    !context.quoted &&
    (!context.typed ||
      VALUE_COMPLETIONS.some((item) => matches(item.label, context.typed)))
  );
}

const MONGODB_AUTOMATIC_TRIGGER = /[A-Za-z0-9_$.-]/u;

export function shouldTriggerMongoDbCompletions(
  source: string,
  cursorOffset: number,
  insertedText: string,
) {
  const lastCharacter = insertedText[insertedText.length - 1];
  return Boolean(
    lastCharacter &&
      (lastCharacter === '"' ||
        lastCharacter === "'" ||
        lastCharacter === "." ||
        lastCharacter === "(" ||
        lastCharacter === "{" ||
        lastCharacter === "[" ||
        lastCharacter === "," ||
        lastCharacter === ":" ||
        MONGODB_AUTOMATIC_TRIGGER.test(lastCharacter)) &&
      shouldOfferMongoDbCompletions(source, cursorOffset),
  );
}
