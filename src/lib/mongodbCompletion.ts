// Compatibility entry. JSON and shell context analysis live in separate modules.
export { mongodbConsoleCompletionContext } from "@/features/query-languages/mongodb/completionContext";
export {
  mongodbCompletionArea,
  shouldOfferMongoDbCompletions,
  shouldTriggerMongoDbCompletions,
} from "@/features/query-languages/mongodb/completionPolicy";
export { buildMongoDbConsoleCompletions } from "@/features/query-languages/mongodb/completions";
export {
  MONGODB_COMPLETION_TRIGGER_CHARACTERS,
  MONGODB_CONSOLE_LANGUAGE_ID,
  mongodbCompletionUsesSnippetSyntax,
  registerMongoDbConsoleLanguage,
} from "@/features/query-languages/mongodb/language";
export type {
  MongoDbCompletionArea,
  MongoDbCompletionContext,
  MongoDbCompletionInput,
  MongoDbConsoleCompletion,
} from "@/features/query-languages/mongodb/types";
