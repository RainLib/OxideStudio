import { describe, expect, it, vi } from "vitest";
import { registerElasticsearchConsoleLanguage } from "./elasticsearch/language";
import { registerMongoDbConsoleLanguage } from "./mongodb/language";

function immutableMonacoNamespace() {
  const registerProvider = () => vi.fn(() => ({ dispose: vi.fn() }));
  const languages = {
    getLanguages: () => [],
    register: vi.fn(),
    setMonarchTokensProvider: registerProvider(),
    setLanguageConfiguration: registerProvider(),
    registerCompletionItemProvider: registerProvider(),
    registerDocumentFormattingEditProvider: registerProvider(),
    registerCodeActionProvider: registerProvider(),
  };
  return Object.freeze({ languages });
}

describe.each([
  ["Elasticsearch", registerElasticsearchConsoleLanguage],
  ["MongoDB", registerMongoDbConsoleLanguage],
] as const)("%s language registration", (_name, registerLanguage) => {
  it("supports immutable ESM namespaces when opening and reopening editors", () => {
    const monaco = immutableMonacoNamespace();
    expect(() => registerLanguage(monaco)).not.toThrow();
    expect(() => registerLanguage(monaco)).not.toThrow();
    expect(monaco.languages.register).toHaveBeenCalledTimes(1);
    expect(monaco.languages.setMonarchTokensProvider).toHaveBeenCalledTimes(1);
    expect(monaco.languages.setLanguageConfiguration).toHaveBeenCalledTimes(1);
    expect(Object.keys(monaco)).toEqual(["languages"]);
  });

  it("registers independently for separate Monaco runtimes", () => {
    const first = immutableMonacoNamespace();
    const second = immutableMonacoNamespace();
    registerLanguage(first);
    registerLanguage(second);
    expect(first.languages.register).toHaveBeenCalledTimes(1);
    expect(second.languages.register).toHaveBeenCalledTimes(1);
  });
});
