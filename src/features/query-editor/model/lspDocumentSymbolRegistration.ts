type Disposable = { dispose: () => void };
/** Monaco's outline cache keys the provider objects, not semantic metadata.
 * Refresh this one registration without editing SQL or rebuilding the other
 * core providers when a catalog/source grant changes. */
export function registerLspDocumentSymbols<T extends object>(
  languages: { registerDocumentSymbolProvider: (language: string, provider: T) => Disposable },
  language: string,
  provider: T,
) {
  let disposed = false;
  let registration = languages.registerDocumentSymbolProvider(language, { ...provider });
  return {
    refresh() {
      if (disposed) return;
      registration.dispose();
      registration = languages.registerDocumentSymbolProvider(language, { ...provider });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      registration.dispose();
    },
  };
}
