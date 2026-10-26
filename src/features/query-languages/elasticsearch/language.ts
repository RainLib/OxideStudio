import { elasticsearchConsoleCompletionContext } from "@/features/query-languages/elasticsearch/completionContext";
import { elasticsearchConsoleCompletions } from "@/features/query-languages/elasticsearch/completions";
import { formatElasticsearchConsole } from "@/features/query-languages/elasticsearch/formatting";
import {
  ELASTICSEARCH_COMPLETION_TRIGGER_CHARACTERS,
  ELASTICSEARCH_CONSOLE_LANGUAGE_ID,
} from "@/features/query-languages/elasticsearch/languagePolicy";
import { elasticsearchJsonKeyReplacementRange } from "@/features/query-languages/elasticsearch/replacementRange";
import { type ElasticsearchServerVersion } from "@/features/query-languages/elasticsearch/types";

const registrations = new WeakMap<object, {
  version: number;
  disposables: Array<{ dispose: () => void }>;
}>();

export function registerElasticsearchConsoleLanguage(monaco: any) {
  const registrationKey = "__oxideElasticsearchConsoleRegistration";
  // Bundled Monaco is an immutable ESM namespace. Keep owned state outside it.
  const previousRegistration = (registrations.get(monaco) ?? monaco[registrationKey]) as
    | { version: number; disposables: Array<{ dispose: () => void }> }
    | Array<{ dispose: () => void }>
    | undefined;
  const registrationVersion = 4;
  if (
    !Array.isArray(previousRegistration) &&
    previousRegistration?.version === registrationVersion
  ) {
    return;
  }
  const previousDisposables = Array.isArray(previousRegistration)
    ? previousRegistration
    : previousRegistration?.disposables;
  previousDisposables?.forEach((disposable) => disposable.dispose());

  const isLanguageRegistered = monaco.languages
    .getLanguages()
    .some(
      (language: { id: string }) =>
        language.id === ELASTICSEARCH_CONSOLE_LANGUAGE_ID,
    );
  if (!isLanguageRegistered) {
    monaco.languages.register({
      id: ELASTICSEARCH_CONSOLE_LANGUAGE_ID,
      extensions: [".es", ".esdsl"],
      aliases: ["Elasticsearch Console", "Elasticsearch Query DSL"],
    });
  }

  const disposables: Array<{ dispose: () => void }> = [];
  disposables.push(
    monaco.languages.setMonarchTokensProvider(
      ELASTICSEARCH_CONSOLE_LANGUAGE_ID,
      {
        tokenizer: {
          root: [
            [
              /^(\s*)(GET|POST|PUT|PATCH|DELETE|HEAD)(\s+)(\/?\S+)/,
              ["white", "keyword", "white", "string"],
            ],
            [/^\s*#.*$/, "comment"],
            [/\/\/.*$/, "comment"],
            [/[{}[\]]/, "@brackets"],
            [/[,:]/, "delimiter"],
            [/"([^"\\]|\\.)*"(?=\s*:)/, "key"],
            [/"([^"\\]|\\.)*"/, "string"],
            [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, "number"],
            [/\b(?:true|false|null)\b/, "keyword"],
          ],
        },
      },
    ),
  );
  disposables.push(
    monaco.languages.setLanguageConfiguration(
      ELASTICSEARCH_CONSOLE_LANGUAGE_ID,
      {
        comments: {
          lineComment: "//",
        },
        brackets: [
          ["{", "}"],
          ["[", "]"],
        ],
        autoClosingPairs: [
          { open: "{", close: "}" },
          { open: "[", close: "]" },
          { open: '"', close: '"' },
        ],
      },
    ),
  );
  disposables.push(
    monaco.languages.registerCompletionItemProvider(
      ELASTICSEARCH_CONSOLE_LANGUAGE_ID,
      {
        triggerCharacters: ELASTICSEARCH_COMPLETION_TRIGGER_CHARACTERS,
        provideCompletionItems(model: any, position: any) {
          const offset = model.getOffsetAt(position);
          const word = model.getWordUntilPosition(position);
          const defaultRange = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };
          const kindMap = {
            keyword: monaco.languages.CompletionItemKind.Keyword,
            property: monaco.languages.CompletionItemKind.Property,
            snippet: monaco.languages.CompletionItemKind.Snippet,
          };

          const lineBeforeCursor = model
            .getLineContent(position.lineNumber)
            .slice(0, position.column - 1);
          const pathMatch = lineBeforeCursor.match(
            /^(\s*(?:GET|POST|PUT|PATCH|DELETE|HEAD)\s+)(.*)$/i,
          );
          const keyFragment = lineBeforeCursor.match(/"[\w.@*-]*"?$/u)?.[0];
          const keyReplacement = elasticsearchJsonKeyReplacementRange(
            model.getValue(),
            offset,
          );
          const keyReplacementRange = keyReplacement
            ? {
                startLineNumber: model.getPositionAt(keyReplacement.startOffset)
                  .lineNumber,
                startColumn: model.getPositionAt(keyReplacement.startOffset)
                  .column,
                endLineNumber: model.getPositionAt(keyReplacement.endOffset)
                  .lineNumber,
                endColumn: model.getPositionAt(keyReplacement.endOffset).column,
              }
            : null;
          const completionContext = elasticsearchConsoleCompletionContext(
            model.getValue(),
            offset,
          );
          const pathText = pathMatch?.[2] || "";
          const normalizedPath = pathText.replace(/^\/+/, "");
          const firstSlash = normalizedPath.indexOf("/");
          const operationStartInPath = normalizedPath.startsWith("_")
            ? pathText.length - normalizedPath.length
            : firstSlash >= 0
              ? pathText.length - normalizedPath.length + firstSlash + 1
              : pathText.length;
          const operationRange = pathMatch
            ? {
                ...defaultRange,
                startColumn: pathMatch[1]!.length + operationStartInPath + 1,
                endColumn: position.column,
              }
            : defaultRange;
          const completions = elasticsearchConsoleCompletions(
            model.getValue(),
            offset,
            (
              model as {
                __oxideElasticsearchServerVersion?: ElasticsearchServerVersion;
              }
            ).__oxideElasticsearchServerVersion,
          );

          return {
            incomplete: true,
            suggestions: completions.map((completion, index) => ({
              ...completion,
              kind: kindMap[completion.kind],
              range:
                completionContext.area === "operation"
                  ? operationRange
                  : pathMatch
                    ? {
                        ...defaultRange,
                        startColumn: pathMatch[1]!.length + 1,
                        endColumn: position.column,
                      }
                    : completion.kind === "property" && keyReplacementRange
                      ? keyReplacementRange
                      : defaultRange,
              sortText: String(index).padStart(3, "0"),
              filterText:
                completionContext.area === "path"
                  ? `${pathText}${completion.label}`
                  : keyFragment?.startsWith('"')
                    ? `"${completion.label}"`
                    : completion.label,
              insertTextRules:
                monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            })),
          };
        },
      },
    ),
  );
  disposables.push(
    monaco.languages.registerDocumentFormattingEditProvider(
      ELASTICSEARCH_CONSOLE_LANGUAGE_ID,
      {
        provideDocumentFormattingEdits(model: any) {
          const formatted = formatElasticsearchConsole(model.getValue());
          if (!formatted || formatted === model.getValue()) return [];
          return [
            {
              range: model.getFullModelRange(),
              text: formatted,
            },
          ];
        },
      },
    ),
  );
  disposables.push(
    monaco.languages.registerCodeActionProvider(
      ELASTICSEARCH_CONSOLE_LANGUAGE_ID,
      {
        provideCodeActions(model: any, range: any, context: any) {
          const line = model.getLineContent(range.startLineNumber);
          const match = line.match(
            /^(\s*(?:GET|POST|PUT|PATCH|DELETE|HEAD)\s+)(\S+)/i,
          );
          if (!match) return { actions: [], dispose: () => undefined };
          const originalPath = match[2]!;
          let canonicalPath = originalPath.replace(/["']/g, "");
          if (!canonicalPath.startsWith("/"))
            canonicalPath = `/${canonicalPath}`;
          if (canonicalPath === originalPath) {
            return { actions: [], dispose: () => undefined };
          }
          const pathStartColumn = match[1]!.length + 1;
          return {
            actions: [
              {
                title: `Use Console path ${canonicalPath}`,
                kind: "quickfix",
                diagnostics: context.markers,
                isPreferred: true,
                edit: {
                  edits: [
                    {
                      resource: model.uri,
                      versionId: model.getVersionId(),
                      textEdit: {
                        range: {
                          startLineNumber: range.startLineNumber,
                          startColumn: pathStartColumn,
                          endLineNumber: range.startLineNumber,
                          endColumn: pathStartColumn + originalPath.length,
                        },
                        text: canonicalPath,
                      },
                    },
                  ],
                },
              },
            ],
            dispose: () => undefined,
          };
        },
      },
    ),
  );
  registrations.set(monaco, {
    version: registrationVersion,
    disposables,
  });
}
