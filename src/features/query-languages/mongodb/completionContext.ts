import { mongodbJsonCompletionContext } from "./jsonContext";
import { mongodbShellCompletionContext } from "./shellContext";
import type { MongoDbCompletionContext } from "./types";

/** Select the syntax once; shell arguments delegate directly to JSON analysis. */
export function mongodbConsoleCompletionContext(
  source: string,
  cursorOffset: number,
): MongoDbCompletionContext {
  return (
    mongodbShellCompletionContext(source, cursorOffset) ??
    mongodbJsonCompletionContext(source, cursorOffset)
  );
}
