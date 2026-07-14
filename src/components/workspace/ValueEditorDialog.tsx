import Editor from "@monaco-editor/react";
import {
  Binary,
  Braces,
  CalendarClock,
  Check,
  CircleSlash2,
  Clipboard,
  FileText,
  Hash,
  LoaderCircle,
  ToggleLeft,
  Type,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  formatJsonDraft,
  inferValueEditorKind,
  kindLabel,
  parseValueEditorDraft,
  valueEditorDraft,
  valueEditorState,
  valueEditorSupportsEmpty,
  type ValueEditorKind,
  type ValueEditorState,
} from "@/lib/valueEditor";
import { cn } from "@/styles/utils";
import {
  toolbarButtonVariants,
  valueEditorStateButtonVariants,
} from "@/styles/variants";
import { useTheme } from "@/theme/useTheme";

export interface ValueEditorTarget {
  key: string;
  columnName: string;
  columnType?: string | null;
  rowLabel: string;
  value: unknown;
  originalValue: unknown;
  editable: boolean;
  nullable: boolean;
  pending: boolean;
  defaultValue?: string | null;
}

interface ValueEditorDialogProps {
  open: boolean;
  target: ValueEditorTarget | null;
  onOpenChange: (open: boolean) => void;
  onStageValue: (value: unknown) => void;
}

const editorOptions = {
  automaticLayout: true,
  minimap: { enabled: false },
  fontSize: 12,
  fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
  lineHeight: 20,
  glyphMargin: false,
  folding: true,
  scrollBeyondLastLine: false,
  wordWrap: "on" as const,
  overviewRulerBorder: false,
  hideCursorInOverviewRuler: true,
  padding: { top: 12, bottom: 18 },
  scrollbar: {
    verticalScrollbarSize: 10,
    horizontalScrollbarSize: 10,
    useShadows: false,
  },
};

function kindIcon(kind: ValueEditorKind) {
  const props = { size: 13, "aria-hidden": true };
  switch (kind) {
    case "json":
      return <Braces {...props} />;
    case "binary":
      return <Binary {...props} />;
    case "date":
      return <CalendarClock {...props} />;
    case "number":
      return <Hash {...props} />;
    case "boolean":
      return <ToggleLeft {...props} />;
    default:
      return <FileText {...props} />;
  }
}

function stateIcon(state: ValueEditorState): ReactNode {
  switch (state) {
    case "unloaded":
      return <LoaderCircle size={14} />;
    case "null":
      return <CircleSlash2 size={14} />;
    case "empty":
      return <Type size={14} />;
    default:
      return <FileText size={14} />;
  }
}

function stateLabel(state: ValueEditorState) {
  switch (state) {
    case "unloaded":
      return "Not loaded";
    case "null":
      return "NULL";
    case "empty":
      return "Empty string";
    default:
      return "Value";
  }
}

function initialValueDescription(value: unknown) {
  const state = valueEditorState(value);
  if (state === "unloaded") return "Not loaded / database default";
  if (state === "null") return "NULL";
  if (state === "empty") return "Empty string (0 characters)";
  if (typeof value === "string")
    return `${value.length.toLocaleString()} characters`;
  if (Array.isArray(value)) return `${value.length.toLocaleString()} items`;
  if (typeof value === "object") return "Structured value";
  return String(value);
}

export function ValueEditorDialog({
  open,
  target,
  onOpenChange,
  onStageValue,
}: ValueEditorDialogProps) {
  const { mode } = useTheme();
  const kind = useMemo(
    () => inferValueEditorKind(target?.columnType, target?.value),
    [target?.columnType, target?.value],
  );
  const [semanticState, setSemanticState] =
    useState<ValueEditorState>("unloaded");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !target) return;
    setSemanticState(valueEditorState(target.value));
    setDraft(valueEditorDraft(target.value, kind));
    setError(null);
    setCopied(false);
  }, [kind, open, target]);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1_600);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  const binaryBytes = useMemo(() => {
    if (
      kind !== "binary" ||
      (!draft.startsWith("\\x") && !draft.startsWith("0x")) ||
      (draft.length - 2) % 2 !== 0
    ) {
      return null;
    }
    return (draft.length - 2) / 2;
  }, [draft, kind]);
  const textBytes = useMemo(
    () =>
      draft.length <= 1_000_000 ? new TextEncoder().encode(draft).length : null,
    [draft],
  );
  const canUseEmpty = valueEditorSupportsEmpty(kind);
  const editorLanguage = kind === "json" ? "json" : "plaintext";

  if (!target) return null;

  const isReadOnly = !target.editable;

  const selectState = (next: ValueEditorState) => {
    if (next === "empty" && !canUseEmpty) return;
    if (next === "null" && !target.nullable) return;
    setSemanticState(next);
    setError(null);
  };

  const copyValue = async () => {
    const text =
      semanticState === "null"
        ? "NULL"
        : semanticState === "unloaded"
          ? ""
          : semanticState === "empty"
            ? ""
            : draft;
    await navigator.clipboard.writeText(text);
    setCopied(true);
  };

  const formatJson = (compact: boolean) => {
    const result = formatJsonDraft(draft, compact);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDraft(String(result.value));
    setError(null);
  };

  const stageValue = () => {
    const result = parseValueEditorDraft({
      state: semanticState,
      draft,
      kind,
      columnType: target.columnType,
      nullable: target.nullable,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onStageValue(result.value);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[min(700px,calc(100vh-32px))] w-[min(980px,calc(100vw-32px))] max-w-none flex-col gap-0 overflow-hidden rounded-[7px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] p-0 text-[hsl(var(--wb-text))] shadow-[0_24px_72px_rgba(0,0,0,0.52)] [&>button]:right-3 [&>button]:top-3 [&>button]:text-[hsl(var(--wb-text-muted))]"
        onKeyDown={(event) => {
          if (
            !isReadOnly &&
            (event.metaKey || event.ctrlKey) &&
            event.key === "Enter"
          ) {
            event.preventDefault();
            stageValue();
          }
        }}
      >
        <DialogHeader className="shrink-0 space-y-0 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))] px-4 py-3 pr-11 text-left">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] text-[hsl(var(--wb-accent))]">
              {kindIcon(kind)}
            </span>
            <div className="min-w-0">
              <DialogTitle className="truncate text-[13px] font-semibold leading-5 tracking-normal">
                {target.columnName}
              </DialogTitle>
              <DialogDescription className="truncate text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
                {target.rowLabel} · {target.columnType || "unknown type"}
              </DialogDescription>
            </div>
            {target.pending && (
              <span className="ml-1 rounded-[3px] border border-[hsl(var(--wb-accent))] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--wb-accent))]">
                Draft
              </span>
            )}
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
          <aside className="flex w-[168px] shrink-0 flex-col border-r border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] p-2">
            <div className="px-2 pb-1.5 pt-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--wb-text-muted))]">
              Cell state
            </div>
            {semanticState === "unloaded" && (
              <button
                type="button"
                className={valueEditorStateButtonVariants({ selected: true })}
                disabled
              >
                <span className="mt-0.5 text-[hsl(var(--wb-accent))]">
                  {stateIcon("unloaded")}
                </span>
                <span>
                  <span className="block text-[11px] font-medium">
                    Not loaded
                  </span>
                  <span className="mt-0.5 block text-[9px] leading-3 opacity-70">
                    No value is staged
                  </span>
                </span>
              </button>
            )}
            <button
              type="button"
              className={valueEditorStateButtonVariants({
                selected: semanticState === "value",
              })}
              onClick={() => selectState("value")}
              disabled={isReadOnly}
            >
              <span className="mt-0.5 text-[hsl(var(--wb-accent))]">
                {stateIcon("value")}
              </span>
              <span>
                <span className="block text-[11px] font-medium">Value</span>
                <span className="mt-0.5 block text-[9px] leading-3 opacity-70">
                  Edit as {kindLabel(kind).toLowerCase()}
                </span>
              </span>
            </button>
            <button
              type="button"
              className={valueEditorStateButtonVariants({
                selected: semanticState === "empty",
              })}
              onClick={() => selectState("empty")}
              disabled={isReadOnly || !canUseEmpty}
            >
              <span className="mt-0.5 text-[hsl(var(--wb-accent))]">
                {stateIcon("empty")}
              </span>
              <span>
                <span className="block text-[11px] font-medium">
                  Empty string
                </span>
                <span className="mt-0.5 block text-[9px] leading-3 opacity-70">
                  Loaded, zero characters
                </span>
              </span>
            </button>
            <button
              type="button"
              className={valueEditorStateButtonVariants({
                selected: semanticState === "null",
              })}
              onClick={() => selectState("null")}
              disabled={isReadOnly || !target.nullable}
            >
              <span className="mt-0.5 text-[hsl(var(--wb-accent))]">
                {stateIcon("null")}
              </span>
              <span>
                <span className="block text-[11px] font-medium">NULL</span>
                <span className="mt-0.5 block text-[9px] leading-3 opacity-70">
                  SQL null value
                </span>
              </span>
            </button>

            <div className="mt-auto border-t border-[hsl(var(--wb-border-subtle))] px-2 pt-2">
              <div className="text-[9px] uppercase tracking-[0.1em] text-[hsl(var(--wb-text-muted))]">
                Initial state
              </div>
              <div className="mt-1 text-[10px] leading-4 text-[hsl(var(--wb-text))]">
                {initialValueDescription(target.originalValue)}
              </div>
              {target.defaultValue && target.originalValue === undefined && (
                <div className="mt-1 break-all font-mono text-[9px] leading-3 text-[hsl(var(--wb-text-muted))]">
                  Default: {target.defaultValue}
                </div>
              )}
            </div>
          </aside>

          <section className="flex min-w-0 flex-1 flex-col">
            <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-2">
              <span className="flex items-center gap-1.5 text-[10px] font-medium text-[hsl(var(--wb-text))]">
                {kindIcon(kind)}
                {kindLabel(kind)}
              </span>
              <span className="h-3 w-px bg-[hsl(var(--wb-border-subtle))]" />
              <span className="text-[9px] text-[hsl(var(--wb-text-muted))]">
                {stateLabel(semanticState)}
              </span>
              {semanticState === "value" && (
                <span className="text-[9px] text-[hsl(var(--wb-text-muted))]">
                  {kind === "binary" && binaryBytes !== null
                    ? `${binaryBytes.toLocaleString()} bytes`
                    : `${draft.length.toLocaleString()} chars${
                        textBytes === null
                          ? " · large value"
                          : ` · ${textBytes.toLocaleString()} bytes`
                      }`}
                </span>
              )}
              <div className="ml-auto flex items-center gap-1">
                {kind === "json" && semanticState === "value" && (
                  <>
                    <button
                      type="button"
                      className={toolbarButtonVariants({ size: "sm" })}
                      onClick={() => formatJson(false)}
                    >
                      Format
                    </button>
                    <button
                      type="button"
                      className={toolbarButtonVariants({ size: "sm" })}
                      onClick={() => formatJson(true)}
                    >
                      Compact
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className={cn(
                    toolbarButtonVariants({ size: "sm" }),
                    "min-w-[66px] justify-center",
                  )}
                  onClick={() => void copyValue()}
                  disabled={semanticState === "unloaded"}
                >
                  {copied ? <Check size={11} /> : <Clipboard size={11} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>

            <div className="relative min-h-0 flex-1 bg-[hsl(var(--wb-editor))]">
              {semanticState === "unloaded" ? (
                <StatePlaceholder
                  icon={<LoaderCircle size={18} />}
                  title="No value is loaded"
                  detail="For a new row this leaves the column to its database default. Choose a state before staging a change."
                />
              ) : semanticState === "null" ? (
                <StatePlaceholder
                  icon={<CircleSlash2 size={18} />}
                  title="NULL"
                  detail="This is SQL NULL, not an empty string or zero."
                />
              ) : semanticState === "empty" ? (
                <StatePlaceholder
                  icon={<Type size={18} />}
                  title="Empty string"
                  detail="The value is loaded and contains exactly zero characters."
                />
              ) : kind === "boolean" ? (
                <div className="flex h-full items-center justify-center">
                  <div className="grid w-[280px] grid-cols-2 gap-2 rounded-[6px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))] p-2">
                    {["true", "false"].map((value) => (
                      <button
                        key={value}
                        type="button"
                        className={cn(
                          "h-10 rounded-[4px] border text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))]",
                          draft.toLowerCase() === value
                            ? "border-[hsl(var(--wb-accent))] bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-text))]"
                            : "border-[hsl(var(--wb-border-subtle))] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))]",
                        )}
                        onClick={() => setDraft(value)}
                        disabled={isReadOnly}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                </div>
              ) : kind === "date" ? (
                <div className="flex h-full items-start justify-center px-8 py-12">
                  <label className="w-full max-w-[620px]">
                    <span className="mb-2 flex items-center gap-1.5 text-[10px] font-medium text-[hsl(var(--wb-text-muted))]">
                      <CalendarClock size={12} /> Exact database value
                    </span>
                    <input
                      autoFocus
                      value={draft}
                      onChange={(event) => {
                        setDraft(event.target.value);
                        setError(null);
                      }}
                      readOnly={isReadOnly}
                      spellCheck={false}
                      className="h-9 w-full rounded-[4px] border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel-raised))] px-3 font-mono text-[12px] text-[hsl(var(--wb-text))] outline-none focus:border-[hsl(var(--wb-accent))] read-only:opacity-70"
                    />
                    <span className="mt-2 block text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">
                      Timezone and fractional-second text is preserved exactly;
                      validation runs before staging.
                    </span>
                  </label>
                </div>
              ) : (
                <Editor
                  height="100%"
                  language={editorLanguage}
                  value={draft}
                  onChange={(value) => {
                    setDraft(value ?? "");
                    setError(null);
                  }}
                  theme={mode === "light" ? "vs" : "vs-dark"}
                  options={{
                    ...editorOptions,
                    readOnly: isReadOnly,
                    domReadOnly: isReadOnly,
                    lineNumbers: kind === "binary" ? "off" : "on",
                    folding: kind !== "binary",
                    largeFileOptimizations: true,
                    maxTokenizationLineLength: 50_000,
                    wordWrap: kind === "binary" ? "off" : "on",
                    renderLineHighlight: isReadOnly ? "none" : "line",
                  }}
                />
              )}
            </div>
          </section>
        </div>

        <DialogFooter className="flex-row items-center gap-2 border-t border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel))] px-3 py-2 sm:justify-between sm:space-x-0">
          <div className="min-w-0 flex-1">
            {error ? (
              <div
                role="alert"
                className="break-words text-[10px] leading-4 text-[hsl(var(--destructive))]"
              >
                {error}
              </div>
            ) : isReadOnly ? (
              <div className="text-[10px] text-[hsl(var(--wb-text-muted))]">
                Query results are read-only.
              </div>
            ) : (
              <div className="text-[10px] text-[hsl(var(--wb-text-muted))]">
                Stage this cell, then use Submit changes in the table toolbar to
                write it.
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 rounded-[4px] px-3 text-[11px]"
              onClick={() => onOpenChange(false)}
            >
              {isReadOnly ? "Close" : "Cancel"}
            </Button>
            {!isReadOnly && (
              <Button
                type="button"
                size="sm"
                className="h-7 rounded-[4px] px-3 text-[11px]"
                onClick={stageValue}
                disabled={semanticState === "unloaded"}
                title="Stage cell change (Ctrl/Command+Enter)"
              >
                Stage change
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatePlaceholder({
  icon,
  title,
  detail,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex h-full items-center justify-center px-8 text-center">
      <div className="max-w-[360px]">
        <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-full border border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-panel))] text-[hsl(var(--wb-accent))]">
          {icon}
        </span>
        <div className="mt-3 text-[12px] font-medium text-[hsl(var(--wb-text))]">
          {title}
        </div>
        <div className="mt-1 text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
          {detail}
        </div>
      </div>
    </div>
  );
}
