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
  dataGridDetailNavigationDelta,
  dataGridDetailNavigationUsesNativeKeys,
  type DataGridDetailNavigationAxis,
  type DataGridDetailNavigationDelta,
} from "@/features/data-grid/model/dataGridDetailNavigation";
import { useValueEditorDraft } from "@/features/value-editor/hooks/useValueEditorDraft";
import { createValueEditorActions } from "@/features/value-editor/model/createValueEditorActions";
import { type ValueEditorDialogProps } from "@/features/value-editor/model/valueEditorTypes";
import { JsonTreePreview } from "@/features/value-editor/ui/JsonTreePreview";
import {
  editorOptions,
  initialValueDescription,
  kindIcon,
  stateIcon,
  stateLabel,
  StatePlaceholder,
} from "@/features/value-editor/ui/valueEditorPresentation";
import { kindLabel } from "@/lib/valueEditor";
import { cn } from "@/styles/utils";
import {
  toolbarButtonVariants,
  valueEditorStateButtonVariants,
} from "@/styles/variants";
import { useTheme } from "@/theme/useTheme";
import Editor from "@monaco-editor/react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CalendarClock,
  Check,
  CircleSlash2,
  Clipboard,
  Code2,
  LoaderCircle,
  Type,
} from "lucide-react";

export function ValueEditorDialog({
  open,
  target,
  onOpenChange,
  onStageValue,
  navigation,
  onNavigate,
}: ValueEditorDialogProps) {
  const { mode } = useTheme();
  const {
    canUseEmpty,
    setEditMode,
    setSemanticState,
    setError,
    semanticState,
    draft,
    setCopied,
    setDraft,
    editMode,
    kind,
    binaryBytes,
    textBytes,
    jsonPresentation,
    canShowPreview,
    previewError,
    setJsonPresentation,
    copied,
    imagePreview,
    structuredPreview,
    editorLanguage,
    error,
  } = useValueEditorDraft({
    target,
    open,
  });

  if (!target) return null;

  const isReadOnly = !target.editable;
  const canNavigate = (
    axis: DataGridDetailNavigationAxis,
    delta: DataGridDetailNavigationDelta,
  ) =>
    navigation?.[
      axis === "row"
        ? delta < 0
          ? "up"
          : "down"
        : delta < 0
          ? "left"
          : "right"
    ] === true;
  const navigate = (
    axis: DataGridDetailNavigationAxis,
    delta: DataGridDetailNavigationDelta,
  ) => {
    if (!isReadOnly || !onNavigate || !canNavigate(axis, delta)) return;
    onNavigate(axis, delta);
  };
  const readOnlyMessage =
    target.readOnlyReason === "generated-column"
      ? "Generated database columns are computed and cannot be edited."
      : target.readOnlyReason === "hidden-column"
        ? "Hidden database columns cannot be edited here."
        : target.readOnlyReason === "unclassified-column"
          ? "Column write metadata is unavailable, so editing is disabled."
          : "Query results are read-only.";

  const { stageValue, selectState, formatJson, copyValue } =
    createValueEditorActions({
      canUseEmpty,
      target,
      setEditMode,
      setSemanticState,
      setError,
      semanticState,
      draft,
      setCopied,
      setDraft,
      editMode,
      onStageValue,
      onOpenChange,
      kind,
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[min(700px,calc(100vh-32px))] w-[min(980px,calc(100vw-32px))] max-w-none flex-col gap-0 overflow-hidden rounded-[7px] border-[hsl(var(--wb-border))] bg-[hsl(var(--wb-editor))] p-0 text-[hsl(var(--wb-text))] shadow-[0_24px_72px_rgba(0,0,0,0.52)] [&>button]:right-3 [&>button]:top-3 [&>button]:text-[hsl(var(--wb-text-muted))]"
        onKeyDown={(event) => {
          if (
            isReadOnly &&
            !event.altKey &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.shiftKey &&
            !dataGridDetailNavigationUsesNativeKeys(event.target)
          ) {
            const detailNavigation = dataGridDetailNavigationDelta(event.key);
            if (
              detailNavigation &&
              canNavigate(detailNavigation.axis, detailNavigation.delta)
            ) {
              event.preventDefault();
              event.stopPropagation();
              navigate(detailNavigation.axis, detailNavigation.delta);
              return;
            }
          }
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
            {isReadOnly && navigation && onNavigate && (
              <div
                className="ml-auto mr-5 flex shrink-0 items-center gap-0.5"
                aria-label="Navigate result details"
              >
                {(
                  [
                    ["row", -1, ArrowUp, "Previous row"],
                    ["row", 1, ArrowDown, "Next row"],
                    ["column", -1, ArrowLeft, "Previous column"],
                    ["column", 1, ArrowRight, "Next column"],
                  ] as const
                ).map(([axis, delta, Icon, label]) => (
                  <button
                    key={label}
                    type="button"
                    className={toolbarButtonVariants({ size: "sm" })}
                    disabled={!canNavigate(axis, delta)}
                    title={`${label} · ${axis === "row" ? (delta < 0 ? "↑" : "↓") : delta < 0 ? "←" : "→"}`}
                    aria-label={label}
                    onClick={() => navigate(axis, delta)}
                  >
                    <Icon size={12} />
                  </button>
                ))}
              </div>
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
                  <span className="block text-[11px] font-medium">
                    Expression
                  </span>
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
                {editMode === "expression" ? (
                  <Code2 size={13} />
                ) : (
                  kindIcon(kind)
                )}
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
                {editMode === "value" &&
                  kind === "json" &&
                  semanticState === "value" && (
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
                {editMode === "value" &&
                  (kind === "json" ||
                    kind === "xml" ||
                    kind === "array" ||
                    kind === "map" ||
                    kind === "geometry" ||
                    kind === "image") &&
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
              ) : kind === "image" &&
                jsonPresentation === "tree" &&
                imagePreview?.ok ? (
                <div className="flex h-full min-h-0 items-center justify-center overflow-auto bg-[hsl(var(--wb-panel))] p-6">
                  <img
                    src={imagePreview.dataUrl}
                    alt="Database image value preview"
                    className="max-h-full max-w-full rounded-[4px] object-contain"
                  />
                </div>
              ) : (kind === "json" ||
                  kind === "xml" ||
                  kind === "array" ||
                  kind === "map" ||
                  kind === "geometry") &&
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

export { flattenJsonTreeRows } from "@/features/value-editor/model/jsonTree";
export type { JsonTreeRow } from "@/features/value-editor/model/jsonTree";
export type { ValueEditorTarget } from "@/features/value-editor/model/valueEditorTypes";
