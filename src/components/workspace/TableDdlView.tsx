import { useEffect, useState } from "react";
import Editor from "@monaco-editor/react";
import { Check, Copy, RefreshCw } from "lucide-react";
import { useTheme } from "@/theme/useTheme";
import { cn } from "@/lib/utils";

interface TableDdlViewProps {
  ddl: string;
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
}

const ddlEditorOptions = {
  readOnly: true,
  domReadOnly: true,
  minimap: { enabled: false },
  fontSize: 12,
  fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
  lineHeight: 20,
  lineNumbers: "on" as const,
  lineNumbersMinChars: 3,
  glyphMargin: false,
  folding: true,
  automaticLayout: true,
  scrollBeyondLastLine: false,
  wordWrap: "on" as const,
  renderLineHighlight: "none" as const,
  overviewRulerBorder: false,
  hideCursorInOverviewRuler: true,
  padding: { top: 10, bottom: 16 },
  scrollbar: {
    verticalScrollbarSize: 10,
    horizontalScrollbarSize: 10,
    useShadows: false,
  },
};

export function TableDdlView({
  ddl,
  isLoading,
  error,
  onRefresh,
}: TableDdlViewProps) {
  const { mode } = useTheme();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  const copyDdl = async () => {
    if (!ddl) return;
    await navigator.clipboard.writeText(ddl);
    setCopied(true);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[hsl(var(--wb-editor))]">
      <div className="flex h-7 shrink-0 items-center border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-2">
        <span className="text-[10px] wb-muted">Generated DDL · read-only</span>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            className="wb-icon-button"
            onClick={() => void copyDdl()}
            disabled={!ddl || isLoading}
            title="Copy DDL"
            aria-label="Copy DDL"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
          <button
            type="button"
            className="wb-icon-button"
            onClick={onRefresh}
            disabled={isLoading}
            title="Refresh DDL"
            aria-label="Refresh DDL"
          >
            <RefreshCw
              size={12}
              className={cn(isLoading && "motion-safe:animate-spin")}
            />
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {error ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-xs text-destructive">
            {error}
          </div>
        ) : !ddl && isLoading ? (
          <div className="space-y-2 px-12 py-8" role="status" aria-label="Loading DDL">
            {[72, 54, 84, 62, 46].map((width, index) => (
              <div
                key={index}
                className="h-3 rounded-[2px] bg-[hsl(var(--wb-border-subtle))] motion-safe:animate-pulse"
                style={{ width: `${width}%` }}
              />
            ))}
          </div>
        ) : (
          <Editor
            height="100%"
            language="sql"
            value={ddl || "-- DDL is not available for this object."}
            theme={mode === "light" ? "vs" : "oxide-dark"}
            beforeMount={(monaco) => {
              monaco.editor.defineTheme("oxide-dark", {
                base: "vs-dark",
                inherit: true,
                rules: [],
                colors: { "editor.background": "#1c1d20" },
              });
            }}
            options={ddlEditorOptions}
          />
        )}
      </div>
    </div>
  );
}
