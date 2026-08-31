import Editor from "@monaco-editor/react";
import {
  Binary,
  Braces,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  CircleSlash2,
  Clipboard,
  FileText,
  Hash,
  Image,
  LoaderCircle,
  ListTree,
  Code2,
  ToggleLeft,
  Type,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  parseJsonPreview,
  parseArrayPreview,
  parseMapPreview,
  parseXmlPreview,
  parseImagePreview,
  parseGeometryPreview,
  type ValueEditorKind,
  type ValueEditorState,
} from "@/lib/valueEditor";
import {
  tableCellExpression,
  validateTableCellExpression,
} from "@/lib/tableCellExpression";
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
  expression?: string | null;
  expressionAllowed?: boolean;
  readOnlyReason?:
    | "query-result"
    | "generated-column"
    | "hidden-column"
    | "unclassified-column";
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
    case "map":
      return <Braces {...props} />;
    case "xml":
      return <Code2 {...props} />;
    case "image":
      return <Image {...props} />;
    case "geometry":
      return <ListTree {...props} />;
    case "array":
      return <ListTree {...props} />;
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
  const [editMode, setEditMode] = useState<"value" | "expression">("value");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [jsonPresentation, setJsonPresentation] = useState<"text" | "tree">(
    "text",
  );

  useEffect(() => {
    if (!open || !target) return;
    const isExpression = Boolean(target.expression);
    setSemanticState(isExpression ? "value" : valueEditorState(target.value));
    setDraft(isExpression ? target.expression || "" : valueEditorDraft(target.value, kind));
    setEditMode(isExpression ? "expression" : "value");
    setError(null);
    setCopied(false);
    setJsonPresentation("text");
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
  const editorLanguage = kind === "json" ? "json" : kind === "xml" ? "xml" : "plaintext";
  const jsonPreview = useMemo(
    () =>
      kind === "json" && semanticState === "value"
        ? parseJsonPreview(draft)
        : null,
    [draft, kind, semanticState],
  );
  const arrayPreview = useMemo(
    () =>
      kind === "array" && semanticState === "value"
        ? parseArrayPreview(draft)
        : null,
    [draft, kind, semanticState],
  );
  const mapPreview = useMemo(
    () =>
      kind === "map" && semanticState === "value"
        ? parseMapPreview(draft)
        : null,
    [draft, kind, semanticState],
  );
  const xmlPreview = useMemo(
    () =>
      kind === "xml" && semanticState === "value"
        ? parseXmlPreview(draft)
        : null,
    [draft, kind, semanticState],
  );
  const geometryPreview = useMemo(
    () =>
      kind === "geometry" && semanticState === "value"
        ? parseGeometryPreview(draft)
        : null,
    [draft, kind, semanticState],
  );
  const imagePreview = useMemo(
    () =>
      kind === "image" && semanticState === "value"
        ? parseImagePreview(draft)
        : null,
    [draft, kind, semanticState],
  );
  const structuredPreview =
    kind === "array"
      ? arrayPreview
      : kind === "map"
        ? mapPreview
        : kind === "xml"
          ? xmlPreview
          : kind === "geometry"
            ? geometryPreview
          : jsonPreview;
  const canShowStructuredTree = structuredPreview?.ok === true;
  const canShowPreview = kind === "image"
    ? imagePreview?.ok === true
    : canShowStructuredTree;
  const previewError = kind === "image"
    ? imagePreview && !imagePreview.ok
      ? imagePreview.error
      : undefined
    : structuredPreview && !structuredPreview.ok
      ? structuredPreview.error
      : undefined;

  if (!target) return null;

  const isReadOnly = !target.editable;
  const readOnlyMessage =
    target.readOnlyReason === "generated-column"
      ? "Generated database columns are computed and cannot be edited."
      : target.readOnlyReason === "hidden-column"
        ? "Hidden database columns cannot be edited here."
        : target.readOnlyReason === "unclassified-column"
          ? "Column write metadata is unavailable, so editing is disabled."
        : "Query results are read-only.";

  const selectState = (next: ValueEditorState) => {
    if (next === "empty" && !canUseEmpty) return;
    if (next === "null" && !target.nullable) return;
    if (next !== "value") setEditMode("value");
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
    if (editMode === "expression") {
      const result = validateTableCellExpression(draft);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onStageValue(tableCellExpression(result.value));
      onOpenChange(false);
      return;
    }
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
                selected: semanticState === "value" && editMode === "value",
              })}
              onClick={() => {
                setEditMode("value");
                selectState("value");
              }}
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
            {target.expressionAllowed && (
              <button
                type="button"
                className={valueEditorStateButtonVariants({
                  selected: editMode === "expression",
                })}
                onClick={() => {
                  setEditMode("expression");
                  setSemanticState("value");
                  setDraft(target.expression || "");
                  setError(null);
                }}
                disabled={isReadOnly}
              >
                <span className="mt-0.5 text-[hsl(var(--wb-accent))]">
                  <Code2 size={14} />
                </span>
                <span>
                  <span className="block text-[11px] font-medium">Expression</span>
                  <span className="mt-0.5 block text-[9px] leading-3 opacity-70">
                    Explicit SQL only
                  </span>
                </span>
              </button>
            )}
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
                {editMode === "expression" ? <Code2 size={13} /> : kindIcon(kind)}
                {editMode === "expression" ? "SQL expression" : kindLabel(kind)}
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
                {editMode === "value" && kind === "json" && semanticState === "value" && (
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
                {editMode === "value" && (kind === "json" || kind === "xml" || kind === "array" || kind === "map" || kind === "geometry" || kind === "image") &&
                  semanticState === "value" && (
                    <button
                      type="button"
                      className={cn(
                        toolbarButtonVariants({ size: "sm" }),
                        jsonPresentation === "tree" &&
                          "bg-[hsl(var(--wb-active-strong))] text-[hsl(var(--wb-text))]",
                      )}
                      title={
                        canShowPreview
                          ? jsonPresentation === "tree"
                            ? `Show ${kindLabel(kind)} text`
                            : kind === "image"
                              ? "Preview image"
                              : `Inspect ${kindLabel(kind)} as a tree`
                          : kind === "image"
                            ? previewError || "Image preview is unavailable"
                            : previewError || "Tree preview is unavailable"
                      }
                      aria-label={
                        jsonPresentation === "tree"
                          ? `Show ${kindLabel(kind)} text`
                          : kind === "image"
                            ? "Preview image"
                            : `Inspect ${kindLabel(kind)} as a tree`
                      }
                      aria-pressed={jsonPresentation === "tree"}
                      disabled={!canShowPreview}
                      onClick={() =>
                        setJsonPresentation((current) =>
                          current === "tree" ? "text" : "tree",
                        )
                      }
                    >
                      {kind === "image" ? "Preview" : "Tree"}
                    </button>
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
              {editMode === "expression" ? (
                <Editor
                  theme={mode === "dark" ? "vs-dark" : "light"}
                  language="sql"
                  value={draft}
                  onChange={(value) => {
                    setDraft(value || "");
                    setError(null);
                  }}
                  options={{ ...editorOptions, readOnly: isReadOnly }}
                />
              ) : semanticState === "unloaded" ? (
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
              ) : kind === "image" && jsonPresentation === "tree" && imagePreview?.ok ? (
                <div className="flex h-full min-h-0 items-center justify-center overflow-auto bg-[hsl(var(--wb-panel))] p-6">
                  <img
                    src={imagePreview.dataUrl}
                    alt="Database image value preview"
                    className="max-h-full max-w-full rounded-[4px] object-contain"
                  />
                </div>
              ) : (kind === "json" || kind === "xml" || kind === "array" || kind === "map" || kind === "geometry") &&
                jsonPresentation === "tree" &&
                structuredPreview?.ok ? (
                <JsonTreePreview value={structuredPreview.value} />
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
                {readOnlyMessage}
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

const JSON_TREE_ROW_HEIGHT = 24;
const JSON_TREE_OVERSCAN_ROWS = 20;
const JSON_TREE_MAX_ROWS = 100_000;
const JSON_TREE_SUMMARY_COUNT_LIMIT = 10_000;

type JsonTreeParentKind = "root" | "array" | "object";

export interface JsonTreeRow {
  path: string;
  label: string;
  value: unknown;
  depth: number;
  parentKind: JsonTreeParentKind;
  closing?: boolean;
  truncated?: boolean;
}

function isJsonTreeContainer(value: unknown): value is unknown[] | Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function escapeJsonPointerSegment(segment: string) {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

function appendJsonPointer(path: string, segment: string | number) {
  return `${path}/${escapeJsonPointerSegment(String(segment))}`;
}

/**
 * Iterative traversal avoids recursive call-stack growth. Only expanded
 * containers enumerate children; the hard row bound prevents a hostile JSON
 * cell from turning the tree preview into an unbounded renderer allocation.
 */
export function flattenJsonTreeRows(
  value: unknown,
  expandedPaths: ReadonlySet<string>,
  maxRows = JSON_TREE_MAX_ROWS,
): JsonTreeRow[] {
  const rows: JsonTreeRow[] = [];
  const pending: JsonTreeRow[] = [
    { path: "", label: "$", value, depth: 0, parentKind: "root" },
  ];
  const boundedMaxRows = Math.max(1, Math.floor(maxRows));
  let omittedRows = false;

  while (pending.length > 0 && rows.length < boundedMaxRows) {
    const row = pending.pop();
    if (!row) break;
    rows.push(row);
    if (
      row.closing ||
      row.truncated ||
      !isJsonTreeContainer(row.value) ||
      !expandedPaths.has(row.path)
    ) {
      continue;
    }
    pending.push({
      ...row,
      path: `${row.path}/$close\u0000`,
      label: "",
      closing: true,
    });
    // Account for rows already rendered and queued before enumerating a wide
    // container. This bounds both the returned list and the traversal stack;
    // virtualization alone would not protect memory from a million-key object.
    const availableChildren = boundedMaxRows - rows.length - pending.length;
    if (availableChildren <= 0) {
      omittedRows = true;
      continue;
    }
    if (Array.isArray(row.value)) {
      const visibleLength = Math.min(row.value.length, availableChildren);
      omittedRows ||= visibleLength < row.value.length;
      for (let index = visibleLength - 1; index >= 0; index -= 1) {
        pending.push({
          path: appendJsonPointer(row.path, index),
          label: String(index),
          value: row.value[index],
          depth: row.depth + 1,
          parentKind: "array",
        });
      }
    } else {
      const entries: Array<[string, unknown]> = [];
      for (const label in row.value) {
        if (!Object.prototype.hasOwnProperty.call(row.value, label)) continue;
        if (entries.length >= availableChildren) {
          omittedRows = true;
          break;
        }
        entries.push([label, row.value[label]]);
      }
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const [label, child] = entries[index]!;
        pending.push({
          path: appendJsonPointer(row.path, label),
          label,
          value: child,
          depth: row.depth + 1,
          parentKind: "object",
        });
      }
    }
  }
  if (pending.length > 0 || omittedRows) {
    rows.push({
      path: "/$truncated\u0000",
      label: "",
      value: pending.length,
      depth: 0,
      parentKind: "root",
      truncated: true,
    });
  }
  return rows;
}

function JsonTreePreview({ value }: { value: unknown }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set([""]),
  );
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 480 });
  const rows = useMemo(
    () => flattenJsonTreeRows(value, expandedPaths),
    [expandedPaths, value],
  );
  const start = Math.max(
    0,
    Math.floor(viewport.scrollTop / JSON_TREE_ROW_HEIGHT) -
      JSON_TREE_OVERSCAN_ROWS,
  );
  const end = Math.min(
    rows.length,
    Math.ceil((viewport.scrollTop + viewport.height) / JSON_TREE_ROW_HEIGHT) +
      JSON_TREE_OVERSCAN_ROWS,
  );

  useEffect(() => {
    setExpandedPaths(new Set([""]));
    setViewport((current) => ({ ...current, scrollTop: 0 }));
    scrollRef.current?.scrollTo({ top: 0 });
  }, [value]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const updateHeight = () => {
      if (element.clientHeight > 0) {
        setViewport((current) => ({
          ...current,
          height: element.clientHeight,
        }));
      }
    };
    updateHeight();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const togglePath = (path: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-auto px-3 py-3 font-mono text-[11px] text-[hsl(var(--wb-text))]"
      data-json-tree-virtualized="true"
      onScroll={(event) =>
        setViewport({
          scrollTop: event.currentTarget.scrollTop,
          height: event.currentTarget.clientHeight || viewport.height,
        })
      }
    >
      <div
        className="relative min-w-max"
        style={{ height: rows.length * JSON_TREE_ROW_HEIGHT }}
      >
        {rows.slice(start, end).map((row, index) => (
          <JsonTreeVirtualRow
            key={row.path}
            row={row}
            expanded={expandedPaths.has(row.path)}
            top={(start + index) * JSON_TREE_ROW_HEIGHT}
            onToggle={togglePath}
          />
        ))}
      </div>
    </div>
  );
}

function JsonTreeVirtualRow({
  row,
  expanded,
  top,
  onToggle,
}: {
  row: JsonTreeRow;
  expanded: boolean;
  top: number;
  onToggle: (path: string) => void;
}) {
  if (row.truncated) {
    return (
      <div
        className="absolute left-0 flex h-6 items-center text-[hsl(var(--wb-text-muted))]"
        style={{ top }}
      >
        Tree preview reached its {JSON_TREE_MAX_ROWS.toLocaleString()} row safety
        limit. Use the text view to inspect the complete value.
      </div>
    );
  }
  const expandable = isJsonTreeContainer(row.value);
  const summary = expandable ? jsonTreeContainerSummary(row.value) : "";
  return (
    <div
      className="absolute left-0 flex h-6 min-w-full items-center gap-1 whitespace-nowrap rounded-[3px] hover:bg-[hsl(var(--wb-hover))]"
      data-json-path={row.path}
      style={{ top, paddingLeft: row.depth * 14 }}
    >
      {row.closing ? (
        <span className="text-[hsl(var(--wb-text-secondary))]">
          {Array.isArray(row.value) ? "]" : "}"}
        </span>
      ) : (
        <>
          {expandable ? (
            <button
              type="button"
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] text-[hsl(var(--wb-text-muted))] hover:text-[hsl(var(--wb-accent))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))]"
              aria-expanded={expanded}
              aria-label={row.path || "$"}
              onClick={() => onToggle(row.path)}
            >
              {expanded ? (
                <ChevronDown size={12} aria-hidden="true" />
              ) : (
                <ChevronRight size={12} aria-hidden="true" />
              )}
            </button>
          ) : (
            <span className="inline-block w-5 shrink-0" aria-hidden="true" />
          )}
          {row.parentKind !== "root" && (
            <span className="text-[hsl(var(--wb-text-muted))]">
              {row.parentKind === "array" ? `[${row.label}]` : row.label}:
            </span>
          )}
          {row.parentKind === "root" && (
            <span className="text-[hsl(var(--wb-text-muted))]">{row.label}</span>
          )}
          {expandable ? (
            <>
              <span className="text-[hsl(var(--wb-text-secondary))]">
                {Array.isArray(row.value) ? "[" : "{"}
              </span>
              {!expanded && (
                <>
                  <span className="text-[hsl(var(--wb-text-muted))]">{summary}</span>
                  <span className="text-[hsl(var(--wb-text-secondary))]">
                    {Array.isArray(row.value) ? "]" : "}"}
                  </span>
                </>
              )}
            </>
          ) : (
            <span className={jsonPrimitiveClass(row.value)} title={jsonPrimitiveText(row.value)}>
              {jsonPrimitiveText(row.value)}
            </span>
          )}
        </>
      )}
    </div>
  );
}

function jsonTreeContainerSummary(value: unknown) {
  if (Array.isArray(value)) {
    return `[${value.length}${value.length === 1 ? " item" : " items"}]`;
  }
  if (!value || typeof value !== "object") return "";
  const object = value as Record<string, unknown>;
  let count = 0;
  for (const label in object) {
    if (!Object.prototype.hasOwnProperty.call(object, label)) continue;
    count += 1;
    if (count > JSON_TREE_SUMMARY_COUNT_LIMIT) {
      return `{${JSON_TREE_SUMMARY_COUNT_LIMIT.toLocaleString()}+ properties}`;
    }
  }
  return `{${count}${count === 1 ? " property" : " properties"}}`;
}

function jsonPrimitiveText(value: unknown) {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null) return "null";
  return String(value);
}

function jsonPrimitiveClass(value: unknown) {
  if (value === null) return "text-[hsl(var(--wb-text-muted))]";
  if (typeof value === "string") return "text-[hsl(var(--wb-accent))]";
  if (typeof value === "boolean") return "text-[hsl(var(--wb-success))]";
  return "text-[hsl(var(--wb-warning))]";
}
