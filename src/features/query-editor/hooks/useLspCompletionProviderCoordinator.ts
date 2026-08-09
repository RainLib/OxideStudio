import { useEffect, useRef } from "react";

type Disposable = { dispose: () => void };

export type MonacoCompletionProvider = (
  model: any,
  position: any,
  context: any,
  token: { isCancellationRequested?: boolean },
) => Promise<{ suggestions: any[]; incomplete?: boolean }>;

export type LspCompletionProviderCoordinatorOptions = {
  editorLanguageId: string;
  isActivePane: boolean;
  monaco: any;
  ownerKey: string;
  provideCompletionItems: MonacoCompletionProvider;
  rankByUsage: boolean;
  recordUsage: (scope: string, label: string) => void;
  triggerChainedCompletion: () => void;
  usageCommandId: string;
  usageScope: string;
  triggerCharacters: string[];
};

type CompletionRuntime = Pick<
  LspCompletionProviderCoordinatorOptions,
  | "ownerKey"
  | "provideCompletionItems"
  | "rankByUsage"
  | "recordUsage"
  | "triggerChainedCompletion"
  | "usageScope"
>;

export function registerLspCompletionProvider(options: {
  editorLanguageId: string;
  getRuntime: () => CompletionRuntime;
  monaco: any;
  triggerCharacters: string[];
  usageCommandId: string;
}): Disposable {
  const {
    editorLanguageId,
    getRuntime,
    monaco,
    triggerCharacters,
    usageCommandId,
  } = options;
  const command = monaco.editor.registerCommand(
    usageCommandId,
    (
      _accessor: unknown,
      scope: string,
      label: string,
      chainCompletion = false,
      commandOwnerKey?: string,
    ) => {
      const runtime = getRuntime();
      if (
        scope !== runtime.usageScope ||
        (commandOwnerKey !== undefined && commandOwnerKey !== runtime.ownerKey)
      ) {
        return;
      }
      if (runtime.rankByUsage) {
        runtime.recordUsage(scope, label);
      }
      if (chainCompletion) runtime.triggerChainedCompletion();
    },
  );
  const provider = monaco.languages.registerCompletionItemProvider(
    editorLanguageId,
    {
      triggerCharacters,
      provideCompletionItems: async (
        model: any,
        position: any,
        context: any,
        token: { isCancellationRequested?: boolean },
      ) => {
        const runtime = getRuntime();
        const result = await runtime.provideCompletionItems(
          model,
          position,
          context,
          token,
        );
        if (
          token?.isCancellationRequested ||
          getRuntime().ownerKey !== runtime.ownerKey
        ) {
          return { suggestions: [] };
        }
        return result;
      },
    },
  );

  return {
    dispose: () => {
      command.dispose();
      provider.dispose();
    },
  };
}

export function useLspCompletionProviderCoordinator(
  options: LspCompletionProviderCoordinatorOptions,
) {
  const runtimeRef = useRef<CompletionRuntime>(options);
  runtimeRef.current = options;
  const triggerSignature = options.triggerCharacters.join("\u0000");

  useEffect(() => {
    if (!options.isActivePane || !options.monaco) return;
    return registerLspCompletionProvider({
      editorLanguageId: options.editorLanguageId,
      getRuntime: () => runtimeRef.current,
      monaco: options.monaco,
      triggerCharacters: options.triggerCharacters,
      usageCommandId: options.usageCommandId,
    }).dispose;
  }, [
    options.editorLanguageId,
    options.isActivePane,
    options.monaco,
    options.usageCommandId,
    triggerSignature,
  ]);
}
