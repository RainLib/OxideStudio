import { editorExecutionConfirmation } from "@/lib/sqlExecutionGate";
import { useCallback, useEffect, useRef, useState } from "react";

interface UseEditorExecutionConfirmationContext {
  editorRef: React.RefObject<
    import("monaco-editor").editor.IStandaloneCodeEditor | null
  >;
  driver: import("@/services/tauri/types").DatabaseDriver;
  editorSettings: import("@/lib/appSettings").AppSettings["editor"];
}

export function useEditorExecutionConfirmation({
  editorRef,
  driver,
  editorSettings,
}: UseEditorExecutionConfirmationContext) {
  const dangerousExecutionRef = useRef<{
    generation: number;
    resolve: (approved: boolean) => void;
  } | null>(null);
  const dangerousExecutionGenerationRef = useRef(0);
  const [dangerousExecution, setDangerousExecution] = useState<{
    generation: number;
    message: string;
  } | null>(null);

  const resolveDangerousExecution = useCallback((approved: boolean) => {
    const pending = dangerousExecutionRef.current;
    if (!pending) return;
    dangerousExecutionRef.current = null;
    setDangerousExecution(null);
    pending.resolve(approved);
  }, []);
  useEffect(
    () => () => resolveDangerousExecution(false),
    [resolveDangerousExecution],
  );
  const restoreDangerousExecutionFocus = useCallback((event: Event) => {
    // Radix otherwise restores focus to its trigger. Monaco may be the trigger
    // indirectly (keyboard shortcut or toolbar), so restore it only after the
    // close animation and never for a newly opened confirmation.
    event.preventDefault();
    const closingGeneration = dangerousExecutionGenerationRef.current;
    window.requestAnimationFrame(() => {
      if (
        dangerousExecutionRef.current ||
        dangerousExecutionGenerationRef.current !== closingGeneration
      ) {
        return;
      }
      editorRef.current?.focus?.();
    });
  }, []);
  const confirmEditorExecution = useCallback(
    (sql: string, executionDriver = driver): boolean | Promise<boolean> => {
      if (!editorSettings.confirmDestructiveSql) return true;
      const confirmation = editorExecutionConfirmation(sql, executionDriver);
      if (!confirmation.required) return true;
      resolveDangerousExecution(false);
      const generation = dangerousExecutionGenerationRef.current + 1;
      dangerousExecutionGenerationRef.current = generation;
      return new Promise<boolean>((resolve) => {
        dangerousExecutionRef.current = { generation, resolve };
        setDangerousExecution({
          generation,
          message: confirmation.message || "Execute this query?",
        });
      });
    },
    [driver, editorSettings.confirmDestructiveSql, resolveDangerousExecution],
  );

  return {
    resolveDangerousExecution,
    restoreDangerousExecutionFocus,
    confirmEditorExecution,
    dangerousExecution,
  };
}
