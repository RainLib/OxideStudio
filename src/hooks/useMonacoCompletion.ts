/**
 * @deprecated QueryEditor owns SQL LSP completion registration directly.
 * This hook remains only for legacy callers that need the Monaco instance.
 */

import { useMonaco } from "@monaco-editor/react";

export interface MonacoCompletionOptions {
  connectionId?: string;
  currentSchema?: string;
  debounceDelay?: number;
}

/**
 * Legacy Monaco hook - returns Monaco instance when ready.
 *
 * @param options - Configuration options (currently unused)
 * @returns Monaco editor instance or null
 */
export function useMonacoCompletion() {
  return useMonaco();
}
