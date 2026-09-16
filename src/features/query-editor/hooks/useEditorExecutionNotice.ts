import { useCallback, useEffect, useRef, useState } from "react";

interface EditorExecutionNoticeOptions {}

export function useEditorExecutionNotice({}: EditorExecutionNoticeOptions) {
  const [executionNotice, setExecutionNotice] = useState<string | null>(null);
  const executionNoticeTimerRef = useRef<number | null>(null);

  const showExecutionNotice = useCallback((message: string) => {
    setExecutionNotice(message);
    if (executionNoticeTimerRef.current !== null) {
      window.clearTimeout(executionNoticeTimerRef.current);
    }
    executionNoticeTimerRef.current = window.setTimeout(() => {
      executionNoticeTimerRef.current = null;
      setExecutionNotice(null);
    }, 3000);
  }, []);
  const showNoExecutableTarget = useCallback(
    () => showExecutionNotice("No executable statement at cursor"),
    [showExecutionNotice],
  );
  useEffect(
    () => () => {
      if (executionNoticeTimerRef.current !== null) {
        window.clearTimeout(executionNoticeTimerRef.current);
      }
    },
    [],
  );

  return { executionNotice, showExecutionNotice, showNoExecutableTarget };
}
