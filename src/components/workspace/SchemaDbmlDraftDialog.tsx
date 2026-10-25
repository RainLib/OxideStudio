import Editor from "@monaco-editor/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, FileCode2, GitCompareArrows, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { serializeSchemaSnapshotToDbml } from "@/features/schema-diff/model/schemaDbml";
import {
  createSchemaDbmlSnapshot,
  parseSchemaDbml,
} from "@/features/schema-diff/model/schemaDbmlImport";
import { schemaService } from "@/services/tauri/schema.service";
import type { SchemaSnapshot } from "@/services/tauri/types";
import { useTabStore } from "@/store/useTabStore";

type SchemaDbmlDraftDialogProps = {
  open: boolean;
  snapshot: SchemaSnapshot;
  onClose: () => void;
};

export function SchemaDbmlDraftDialog({
  open,
  snapshot,
  onClose,
}: SchemaDbmlDraftDialogProps) {
  const openSchemaDiffTab = useTabStore((state) => state.openSchemaDiffTab);
  const [source, setSource] = useState("");
  const [debouncedSource, setDebouncedSource] = useState("");
  const [operationError, setOperationError] = useState<string | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const completionDisposableRef = useRef<{ dispose: () => void } | null>(null);

  const registerDbmlLanguage = useCallback((monaco: any) => {
    if (!monaco.languages.getLanguages().some((language: any) => language.id === "dbml")) {
      monaco.languages.register({ id: "dbml" });
      monaco.languages.setMonarchTokensProvider("dbml", {
        tokenizer: {
          root: [
            [/\/\/.*/, "comment"],
            [/\b(Table|TableGroup|Ref|Enum|Note|Project)\b/, "keyword"],
            [/\b(pk|unique|not null|increment|default|ref)\b/, "keyword"],
            [/"[^"\n]*"/, "string"],
          ],
        },
      });
    }
  }, []);

  const handleDbmlMount = useCallback((editor: any, monaco: any) => {
    completionDisposableRef.current?.dispose();
    completionDisposableRef.current = monaco.languages.registerCompletionItemProvider("dbml", {
      triggerCharacters: [" ", "[", ":", ".", ">", "<", "-"],
      provideCompletionItems: (model: any, position: any) => {
        const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
        const word = model.getWordUntilPosition(position);
        const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
        const tables = Array.from(
          model.getValue().matchAll(/^\s*Table\s+([\w.]+)/gm),
          (match: RegExpMatchArray) => match[1],
        ).filter((table): table is string => Boolean(table));
        const settings = ["pk", "not null", "unique", "increment", "default:", "ref:"];
        const suggestions = line.includes("[")
          ? settings.map((label) => ({ label, kind: monaco.languages.CompletionItemKind.Keyword, insertText: label, range }))
          : [
              { label: "Table", detail: "DBML table", insertText: "Table ${1:name} {\n  ${2:id} ${3:int} [pk]\n}", kind: monaco.languages.CompletionItemKind.Snippet, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
              { label: "Ref", detail: "DBML relationship", insertText: "Ref: ${1:table}.${2:column} > ${3:table}.${4:column}", kind: monaco.languages.CompletionItemKind.Snippet, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
              { label: "Enum", detail: "DBML enum", insertText: "Enum ${1:name} {\n  ${2:value}\n}", kind: monaco.languages.CompletionItemKind.Snippet, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
              { label: "TableGroup", detail: "DBML table group", insertText: "TableGroup ${1:name} {\n  ${2:table}\n}", kind: monaco.languages.CompletionItemKind.Snippet, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, range },
              ...tables.map((table: string) => ({ label: table, detail: "DBML table", kind: monaco.languages.CompletionItemKind.Reference, insertText: table, range })),
            ];
        return { suggestions };
      },
    });
    editor.focus();
  }, []);

  useEffect(() => () => completionDisposableRef.current?.dispose(), []);

  useEffect(() => {
    if (!open) return;
    const content = serializeSchemaSnapshotToDbml(snapshot).content;
    setSource(content);
    setDebouncedSource(content);
    setOperationError(null);
  }, [open, snapshot]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSource(source), 250);
    return () => window.clearTimeout(timer);
  }, [source]);

  const parseOutcome = useMemo(() => {
    if (!open || !debouncedSource.trim()) {
      return { parsed: null, error: null as string | null };
    }
    try {
      return {
        parsed: parseSchemaDbml(debouncedSource, snapshot.schemaName),
        error: null as string | null,
      };
    } catch (error) {
      return {
        parsed: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [debouncedSource, open, snapshot.schemaName]);
  const parsed = parseOutcome.parsed;
  const visibleError = operationError || parseOutcome.error;

  const reviewDiff = async () => {
    if (!parsed || parsed.relations.length === 0 || parseOutcome.error || isReviewing) return;
    setIsReviewing(true);
    setOperationError(null);
    try {
      const draft = createSchemaDbmlSnapshot(
        {
          projectId: snapshot.projectId,
          connectionId: snapshot.connectionId,
          connectionName: snapshot.connectionName,
          driver: snapshot.driver,
          databaseName: snapshot.databaseName,
          schemaName: snapshot.schemaName,
        },
        "Diagram DBML draft",
        source,
      );
      const plan = await schemaService.compareSchemaSnapshots(draft, snapshot);
      openSchemaDiffTab(plan, draft, snapshot);
      onClose();
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsReviewing(false);
    }
  };

  const ready = Boolean(parsed && parsed.relations.length > 0 && !parseOutcome.error);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !isReviewing && onClose()}>
      <DialogContent layout="custom" className="grid h-[min(760px,calc(100vh-32px))] w-[min(980px,calc(100vw-32px))] max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-[4px] bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-accent))]">
              <FileCode2 size={14} />
            </span>
            <div>
              <DialogTitle className="text-[13px] tracking-normal">DBML draft · {snapshot.schemaName}</DialogTitle>
              <DialogDescription className="text-[9px] text-[hsl(var(--wb-text-muted))]">
                Local review source · 250 ms diagnostics · never executed directly
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_250px]">
          <Editor
            beforeMount={registerDbmlLanguage}
            onMount={handleDbmlMount}
            language="dbml"
            value={source}
            onChange={(value) => {
              setSource(value || "");
              setOperationError(null);
            }}
            options={{
              minimap: { enabled: false },
              fontSize: 11,
              lineHeight: 17,
              wordWrap: "on",
              automaticLayout: true,
              padding: { top: 12, bottom: 12 },
              scrollBeyondLastLine: false,
              suggest: { showKeywords: true, showSnippets: true },
            }}
          />
          <aside className="min-h-0 overflow-auto border-l border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel)/0.72)] p-3">
            <div className="text-[8px] uppercase tracking-[0.12em] wb-muted">Draft diagnostics</div>
            <div className="mt-2 grid grid-cols-[1fr_auto] gap-y-1.5 text-[9px]">
              <span className="wb-muted">Relations</span>
              <span>{parsed?.relations.length || 0}</span>
              <span className="wb-muted">Warnings</span>
              <span>{parsed?.warnings.length || 0}</span>
              <span className="wb-muted">Characters</span>
              <span>{source.length.toLocaleString()}</span>
            </div>
            {visibleError && (
              <div className="mt-3 flex items-start gap-1.5 rounded-[4px] border border-red-400/20 bg-red-400/5 px-2 py-2 text-[9px] leading-4 text-red-300">
                <AlertCircle size={11} className="mt-0.5 shrink-0" />
                <span>{visibleError}</span>
              </div>
            )}
            {!visibleError && parsed && parsed.warnings.length > 0 && (
              <div className="mt-3 space-y-1 border-t border-[hsl(var(--wb-border-subtle))] pt-2">
                {parsed.warnings.slice(0, 24).map((warning) => (
                  <div key={warning} className="text-[8px] leading-4 text-amber-200/80">
                    {warning}
                  </div>
                ))}
                {parsed.warnings.length > 24 && (
                  <div className="text-[8px] wb-muted">+{parsed.warnings.length - 24} more</div>
                )}
              </div>
            )}
            <p className="mt-3 border-t border-[hsl(var(--wb-border-subtle))] pt-2 text-[8px] leading-4 wb-muted">
              Review compares this desired DBML snapshot with the captured snapshot currently open in the diagram. The resulting artifact is offline and Apply stays disabled.
            </p>
          </aside>
        </div>

        <DialogFooter className="flex-row items-center justify-between border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-4 py-3 sm:justify-between sm:space-x-0">
          <span className="text-[9px] wb-muted">
            {ready ? "Draft is ready for a read-only diff." : "Resolve diagnostics before review."}
          </span>
          <div className="flex gap-2">
            <button type="button" className="wb-text-button h-7 px-3 text-[10px]" disabled={isReviewing} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="wb-primary-button h-7 min-w-28 justify-center gap-1.5 px-3 text-[10px]"
              disabled={!ready || isReviewing}
              onClick={() => void reviewDiff()}
            >
              {isReviewing ? <Loader2 size={11} className="animate-spin" /> : <GitCompareArrows size={11} />}
              Review diff
            </button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
