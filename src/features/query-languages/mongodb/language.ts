import { type MongoDbConsoleCompletion } from "@/features/query-languages/mongodb/types";

export const MONGODB_CONSOLE_LANGUAGE_ID = "mongodb-console";

export const MONGODB_COMPLETION_TRIGGER_CHARACTERS = Array.from(
  new Set(
    ` .({[,\"'$ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-`.split(
      "",
    ),
  ),
);

export function registerMongoDbConsoleLanguage(monaco: any) {
  const registrationKey = "__oxideMongoDbConsoleRegistration";
  if (monaco[registrationKey]) return;
  if (
    !monaco.languages
      .getLanguages()
      .some(
        (language: { id: string }) =>
          language.id === MONGODB_CONSOLE_LANGUAGE_ID,
      )
  ) {
    monaco.languages.register({
      id: MONGODB_CONSOLE_LANGUAGE_ID,
      extensions: [".mongo", ".mongodb"],
      aliases: ["MongoDB Console", "MongoDB"],
    });
  }
  const disposables = [
    monaco.languages.setMonarchTokensProvider(MONGODB_CONSOLE_LANGUAGE_ID, {
      tokenizer: {
        root: [
          [/\/\*/, "comment", "@comment"],
          [/\/\/.*$/, "comment"],
          [
            /\b(db)(\.)(getCollection)\b/,
            ["variable.predefined", "delimiter", "keyword"],
          ],
          [/\b(db)\b/, "variable.predefined"],
          [
            /\b(find|findOne|count|countDocuments|aggregate|distinct|getIndexes|stats|sort|skip|limit)\b(?=\s*\()/,
            "keyword",
          ],
          [/\$(?:[A-Za-z][\w]*)/, "type.identifier"],
          [/[{}()[\]]/, "@brackets"],
          [/-?\d+(?:\.\d+)?/, "number"],
          [/"(?:[^"\\]|\\.)*"/, "string"],
          [/'(?:[^'\\]|\\.)*'/, "string"],
          [/\b(?:true|false|null)\b/, "constant"],
          [/[A-Za-z_][\w-]*(?=\s*:)/, "key"],
        ],
        comment: [
          [/[^/*]+/, "comment"],
          [/\*\//, "comment", "@pop"],
          [/[/*]/, "comment"],
        ],
      },
    }),
    monaco.languages.setLanguageConfiguration(MONGODB_CONSOLE_LANGUAGE_ID, {
      comments: { lineComment: "//", blockComment: ["/*", "*/"] },
      brackets: [
        ["{", "}"],
        ["[", "]"],
        ["(", ")"],
      ],
      autoClosingPairs: [
        { open: "{", close: "}" },
        { open: "[", close: "]" },
        { open: "(", close: ")" },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
      ],
    }),
  ];
  monaco[registrationKey] = disposables;
}

/** Keep semantic completion kinds while still enabling Monaco tab stops. */
export function mongodbCompletionUsesSnippetSyntax(
  item: Pick<MongoDbConsoleCompletion, "insertText" | "kind">,
) {
  return (
    item.kind === "snippet" || /\$\{\d+(?::[^}]*)?\}/u.test(item.insertText)
  );
}
