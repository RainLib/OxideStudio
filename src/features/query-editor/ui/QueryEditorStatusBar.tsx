import { StatusBarPortal } from "@/components/workspace/StatusBarPortal";
import { cn } from "@/lib/utils";
import { LockKeyhole } from "lucide-react";

interface QueryEditorStatusBarContext {
  cursorPosition: { line: number; column: number };
  editorSettings: import("@/lib/appSettings").AppSettings["editor"];
  vimStatusNodeRef: React.RefObject<HTMLSpanElement | null>;
  inlineCompletionStatus: import("@/lib/inlineCompletion").InlineCompletionStatus;
  executionNotice: string | null;
  canUseLsp: boolean;
  lspError: string | null;
  isElasticsearchConsole: boolean;
  usesGenericSqlLsp: boolean;
  lspStatus: ReturnType<
    typeof import("@/hooks/useLspClient").useLspClient
  >["status"];
  visibleLspSemanticPresentation:
    | import("@/lib/lspSemanticStatus").LspSemanticStatusPresentation
    | null;
  lspReady: boolean;
}

export function QueryEditorStatusBar({
  cursorPosition,
  editorSettings,
  vimStatusNodeRef,
  inlineCompletionStatus,
  executionNotice,
  canUseLsp,
  lspError,
  isElasticsearchConsole,
  usesGenericSqlLsp,
  lspStatus,
  visibleLspSemanticPresentation,
  lspReady,
}: QueryEditorStatusBarContext) {
  return (
    <StatusBarPortal>
      <div className="flex h-full items-center text-[10px] text-[hsl(var(--wb-text-muted))]">
        <span className="whitespace-nowrap px-2">
          {cursorPosition.line}:{cursorPosition.column}
        </span>
        <span className="wb-editor-status-secondary whitespace-nowrap px-2">
          LF
        </span>
        <span className="wb-editor-status-secondary whitespace-nowrap px-2">
          UTF-8
        </span>
        <span className="wb-editor-status-secondary whitespace-nowrap px-2">
          {editorSettings.tabSize} spaces
        </span>
        {editorSettings.keybindingMode === "vim" && (
          <span
            ref={vimStatusNodeRef}
            className="min-w-28 max-w-72 flex-1 truncate px-2 font-mono text-[9px] text-[hsl(var(--wb-accent))] [&_input]:h-5 [&_input]:max-w-48 [&_input]:border-0 [&_input]:bg-transparent [&_input]:font-mono [&_input]:text-[hsl(var(--wb-text))] [&_input]:outline-none"
            aria-label="Vim status"
          />
        )}
        {editorSettings.inlineCompletion.enabled && (
          <span
            className="wb-editor-status-secondary whitespace-nowrap px-2"
            title={
              inlineCompletionStatus === "error"
                ? "Inline AI request failed. Check the Inline Completion endpoint, API key, model and timeout in Settings."
                : inlineCompletionStatus === "unconfigured"
                  ? "Configure Inline Completion in Settings. It uses a separate provider from the CLI assistant."
                  : "Inline AI completion. Default keys: Alt+\\ to trigger, Tab to accept. Language-server suggestions remain available separately."
            }
          >
            AI {inlineCompletionStatus}
          </span>
        )}
        {executionNotice && (
          <span
            role="status"
            aria-live="polite"
            className="max-w-64 truncate px-2 text-[hsl(var(--wb-accent))]"
            title={executionNotice}
          >
            {executionNotice}
          </span>
        )}
        <span
          className="flex h-full w-7 items-center justify-center"
          title="SQL execution is permission-gated"
        >
          <LockKeyhole size={11} />
        </span>
        {canUseLsp && (
          <span
            className="wb-editor-status-lsp flex items-center gap-1 whitespace-nowrap px-2"
            title={
              lspError ||
              `${
                isElasticsearchConsole
                  ? "Elasticsearch DSL completion"
                  : usesGenericSqlLsp
                    ? "Generic SQL completion: catalog objects are available, but vendor-specific syntax diagnostics are not claimed"
                    : "SQL language service"
              }: ${lspStatus}${
                visibleLspSemanticPresentation
                  ? ` — ${visibleLspSemanticPresentation.title}`
                  : ""
              }`
            }
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                lspStatus === "error"
                  ? "bg-red-400"
                  : !lspReady || visibleLspSemanticPresentation?.attention
                    ? "bg-amber-400"
                    : lspReady
                      ? "bg-emerald-400"
                      : "bg-amber-400",
              )}
            />
            {isElasticsearchConsole
              ? "DSL"
              : usesGenericSqlLsp
                ? "SQL generic"
                : "SQL"}{" "}
            {lspReady ? "ready" : lspStatus === "error" ? "error" : "starting"}
            {visibleLspSemanticPresentation
              ? ` · ${visibleLspSemanticPresentation.label}`
              : ""}
          </span>
        )}
      </div>
    </StatusBarPortal>
  );
}
