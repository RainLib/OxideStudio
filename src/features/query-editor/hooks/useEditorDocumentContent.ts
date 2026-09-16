import { useCallback, useEffect, useRef } from "react";

interface EditorDocumentContentOptions {
  updateTabSql: (id: string, sql: string) => void;
  effectiveTabId: string | null;
  isElasticsearchConsole: boolean;
}

export function useEditorDocumentContent({
  updateTabSql,
  effectiveTabId,
  isElasticsearchConsole,
}: EditorDocumentContentOptions) {
  const pendingElasticsearchSqlRef = useRef<{
    tabId: string;
    value: string;
  } | null>(null);
  const pendingElasticsearchSqlTimerRef = useRef<number | null>(null);

  const commitPendingElasticsearchSql = useCallback(() => {
    if (pendingElasticsearchSqlTimerRef.current !== null) {
      window.clearTimeout(pendingElasticsearchSqlTimerRef.current);
      pendingElasticsearchSqlTimerRef.current = null;
    }
    const pending = pendingElasticsearchSqlRef.current;
    pendingElasticsearchSqlRef.current = null;
    if (pending) updateTabSql(pending.tabId, pending.value);
  }, [updateTabSql]);

  const handleEditorContentChange = useCallback(
    (value: string | undefined) => {
      if (!effectiveTabId) return;
      const nextValue = value || "";
      if (!isElasticsearchConsole) {
        updateTabSql(effectiveTabId, nextValue);
        return;
      }

      pendingElasticsearchSqlRef.current = {
        tabId: effectiveTabId,
        value: nextValue,
      };
      if (pendingElasticsearchSqlTimerRef.current !== null) {
        window.clearTimeout(pendingElasticsearchSqlTimerRef.current);
      }
      pendingElasticsearchSqlTimerRef.current = window.setTimeout(
        commitPendingElasticsearchSql,
        120,
      );
    },
    [
      commitPendingElasticsearchSql,
      effectiveTabId,
      isElasticsearchConsole,
      updateTabSql,
    ],
  );

  useEffect(
    () => () => {
      commitPendingElasticsearchSql();
    },
    [effectiveTabId, commitPendingElasticsearchSql],
  );

  return { handleEditorContentChange };
}
