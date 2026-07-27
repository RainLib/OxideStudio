import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  ChevronRight,
  CircleAlert,
  FileDiff,
  Loader2,
  RefreshCw,
  SquareArrowOutUpRight,
} from "lucide-react";
import type { AssistantTurn } from "@/ai/assistant/turns";
import {
  projectFilesService,
  type ProjectGitChangeSet,
  type ProjectGitDiffScope,
  type ProjectGitFileChange,
  type ProjectGitFileDiff,
} from "@/services/tauri/project-files.service";
import { openProjectFileInEditor } from "@/lib/projectFileOpen";
import {
  assistantFileChangeAttributions,
  attributionPathsForFilter,
  isAvailableAttributionFilter,
  type AssistantChangeFilter,
  type AssistantFileChangeAttribution,
} from "@/lib/assistantFileChanges";
import { unifiedDiffLines } from "@/lib/unifiedDiff";
import { cn } from "@/lib/utils";
import { requestEditorRangeReveal } from "@/lib/editorNavigation";

interface AssistantChangesPanelProps {
  projectId: string;
  expectedRoot?: string | null;
  refreshKey: string;
  turns: readonly AssistantTurn[];
}

export function AssistantChangesPanel({
  projectId,
  expectedRoot,
  refreshKey,
  turns,
}: AssistantChangesPanelProps) {
  const [open, setOpen] = useState(false);
  const [changes, setChanges] = useState<ProjectGitChangeSet | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [diff, setDiff] = useState<ProjectGitFileDiff | null>(null);
  const [changesLoading, setChangesLoading] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [changeFilter, setChangeFilter] =
    useState<AssistantChangeFilter>("all");
  const [diffScope, setDiffScope] = useState<ProjectGitDiffScope>("all");

  const attributions = useMemo(
    () => assistantFileChangeAttributions(turns),
    [turns],
  );
  const attributedPaths = useMemo(
    () => attributionPathsForFilter(attributions, changeFilter),
    [attributions, changeFilter],
  );
  const attributionCountByPath = useMemo(() => {
    const counts = new Map<string, number>();
    for (const change of attributions) {
      if (
        changeFilter.startsWith("turn:") &&
        changeFilter !== `turn:${change.turnId}`
      ) {
        continue;
      }
      counts.set(change.relativePath, (counts.get(change.relativePath) ?? 0) + 1);
    }
    return counts;
  }, [attributions, changeFilter]);
  const filteredFiles = useMemo(
    () =>
      (changes?.files ?? []).filter(
        (file) => attributedPaths === null || attributedPaths.has(file.relativePath),
      ),
    [attributedPaths, changes?.files],
  );
  const turnsWithChanges = useMemo(
    () => [...turns].filter((turn) => turn.fileChanges?.length).reverse(),
    [turns],
  );
  const selectedFile = useMemo(
    () => changes?.files.find((file) => file.relativePath === selectedPath) ?? null,
    [changes?.files, selectedPath],
  );
  const selectedAttributions = useMemo(
    () =>
      selectedPath
        ? attributions.filter(
            (change) =>
              change.relativePath === selectedPath &&
              (!changeFilter.startsWith("turn:") ||
                changeFilter === `turn:${change.turnId}`),
          )
        : [],
    [attributions, changeFilter, selectedPath],
  );
  const selectedMatchingAttribution = useMemo(
    () =>
      diff
        ? matchingAttributionForDiff(selectedAttributions, diff)
        : undefined,
    [diff, selectedAttributions],
  );
  const loading = changesLoading || diffLoading;

  useEffect(() => {
    if (!isAvailableAttributionFilter(attributions, changeFilter)) {
      setChangeFilter("all");
    }
  }, [attributions, changeFilter]);

  useEffect(() => {
    setSelectedPath((current) =>
      current && filteredFiles.some((file) => file.relativePath === current)
        ? current
        : filteredFiles[0]?.relativePath || null,
    );
  }, [filteredFiles]);

  useEffect(() => {
    if (!selectedFile || isDiffScopeAvailable(selectedFile, diffScope)) return;
    setDiffScope("all");
  }, [diffScope, selectedFile]);

  useEffect(() => {
    if (!projectId || !expectedRoot) {
      setChanges(null);
      setSelectedPath(null);
      setDiff(null);
      return;
    }
    let disposed = false;
    const timer = window.setTimeout(() => {
      setChangesLoading(true);
      setError(null);
      void projectFilesService
        .getGitChanges(projectId, expectedRoot)
        .then((next) => {
          if (disposed) return;
          setChanges(next);
          setSelectedPath((current) =>
            current && next.files.some((file) => file.relativePath === current)
              ? current
              : next.files[0]?.relativePath || null,
          );
        })
        .catch((reason) => {
          if (!disposed) {
            setError(reason instanceof Error ? reason.message : String(reason));
          }
        })
        .finally(() => {
          if (!disposed) setChangesLoading(false);
        });
    }, refreshVersion === 0 ? 350 : 0);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [expectedRoot, projectId, refreshKey, refreshVersion]);

  useEffect(() => {
    if (!open || !selectedPath || !expectedRoot) {
      setDiff(null);
      setDiffLoading(false);
      return;
    }
    let disposed = false;
    setDiff(null);
    setDiffLoading(true);
    setError(null);
    void projectFilesService
      .getGitFileDiff(projectId, selectedPath, expectedRoot, diffScope)
      .then((next) => {
        if (!disposed) setDiff(next);
      })
      .catch((reason) => {
        if (!disposed) {
          setError(reason instanceof Error ? reason.message : String(reason));
          setDiff(null);
        }
      })
      .finally(() => {
        if (!disposed) setDiffLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [diffScope, expectedRoot, open, projectId, selectedPath, refreshVersion]);

  if (!expectedRoot) return null;
  const changeCount = changes?.files.length ?? 0;
  const visibleChangeCount = filteredFiles.length;
  const attributedFileCount = new Set(
    attributions.map((change) => change.relativePath),
  ).size;

  return (
    <section className="shrink-0 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar)/0.5)]">
      <div className="flex min-h-8 items-center gap-1 px-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[4px] px-1 py-1 text-left text-[10px] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--wb-accent))]"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-controls="assistant-project-changes"
        >
          <ChevronRight
            size={10}
            className={cn("shrink-0 transition-transform", open && "rotate-90")}
            aria-hidden="true"
          />
          <FileDiff size={11} className="shrink-0" aria-hidden="true" />
          <span className="truncate">Changes</span>
          {changes?.isRepository && (
            <span className="shrink-0 rounded-[3px] bg-[hsl(var(--wb-active))] px-1 py-0.5 text-[9px] tabular-nums">
              {changeCount}
            </span>
          )}
          {changes?.branch && (
            <span className="ml-auto truncate font-mono text-[9px]">
              {changes.branch}
            </span>
          )}
          {attributedFileCount > 0 && (
            <span
              className="shrink-0 text-[8px] text-[hsl(var(--wb-accent))]"
              title={`${attributedFileCount} files written by Agent turns`}
            >
              AI {attributedFileCount}
            </span>
          )}
        </button>
        <button
          type="button"
          className="wb-icon-button h-6 w-6"
          onClick={() => setRefreshVersion((current) => current + 1)}
          disabled={loading}
          title="Refresh project changes"
          aria-label="Refresh project changes"
        >
          {loading ? (
            <Loader2 size={10} className="animate-spin motion-reduce:animate-none" />
          ) : (
            <RefreshCw size={10} />
          )}
        </button>
      </div>

      {open && (
        <div
          id="assistant-project-changes"
          className="max-h-[46vh] overflow-hidden border-t border-[hsl(var(--wb-border-subtle))]"
        >
          {error && (
            <div className="flex items-start gap-1.5 px-2 py-2 text-[9px] leading-4 text-[hsl(var(--destructive))]" role="alert">
              <CircleAlert size={10} className="mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">{error}</span>
            </div>
          )}
          {changes && !changes.isRepository && !error && (
            <div className="px-3 py-3 text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
              This project root is not inside a Git repository.
            </div>
          )}
          {changes?.isRepository && changeCount === 0 && !error && (
            <div className="px-3 py-3 text-[10px] text-[hsl(var(--wb-text-muted))]">
              Working tree clean
            </div>
          )}
          {changes?.isRepository && changeCount > 0 && (
            <div className="grid h-[min(360px,46vh)] min-h-0 grid-rows-[auto_minmax(0,1fr)]">
              <div className="custom-scrollbar flex max-h-28 flex-col overflow-auto border-b border-[hsl(var(--wb-border-subtle))] py-1">
                {attributions.length > 0 && (
                  <label className="flex items-center gap-1.5 px-2 pb-1">
                    <Bot size={10} className="shrink-0 text-[hsl(var(--wb-accent))]" aria-hidden="true" />
                    <span className="sr-only">Change attribution</span>
                    <select
                      value={changeFilter}
                      onChange={(event) => {
                        const next = event.currentTarget.value;
                        if (isAvailableAttributionFilter(attributions, next)) {
                          setChangeFilter(next);
                        }
                      }}
                      className="min-w-0 flex-1 rounded-[4px] border border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))] px-1.5 py-1 text-[9px] text-[hsl(var(--wb-text))] outline-none focus:border-[hsl(var(--wb-accent))]"
                      aria-label="Change attribution filter"
                    >
                      <option value="all">All working tree changes ({changeCount})</option>
                      <option value="agent">All Agent-written files ({attributedFileCount})</option>
                      {turnsWithChanges.map((turn) => (
                        <option key={turn.id} value={`turn:${turn.id}`}>
                          Turn · {truncateTurnLabel(turn.userMessage)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {changes.truncated && (
                  <div className="px-2 py-1 text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">
                    Showing the first 500 changed files
                  </div>
                )}
                {filteredFiles.map((file) => (
                  <ChangeFileButton
                    key={file.relativePath}
                    file={file}
                    selected={file.relativePath === selectedPath}
                    onSelect={() => setSelectedPath(file.relativePath)}
                    agentWriteCount={
                      attributionCountByPath.get(file.relativePath) ?? 0
                    }
                  />
                ))}
                {visibleChangeCount === 0 && (
                  <div className="px-3 py-2 text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">
                    No current Git diff remains for this Agent selection.
                  </div>
                )}
              </div>
              <div className="flex min-h-0 flex-col overflow-hidden">
                {selectedPath && (
                  <div className="shrink-0 border-b border-[hsl(var(--wb-border-subtle))]">
                    <div className="flex h-7 items-center gap-2 px-2">
                      <span className="min-w-0 flex-1 truncate font-mono text-[9px] text-[hsl(var(--wb-text-muted))]" title={selectedPath}>
                        {selectedPath}
                      </span>
                      {diff && (
                        <span className="shrink-0 font-mono text-[9px]">
                          <span className="text-emerald-500">+{diff.additions}</span>{" "}
                          <span className="text-red-500">−{diff.deletions}</span>
                        </span>
                      )}
                      <button
                        type="button"
                        className="wb-icon-button h-5 w-5"
                        onClick={() => void openProjectFileInEditor(selectedPath)}
                        disabled={selectedFile?.status === "deleted"}
                        title="Open file in editor"
                        aria-label={`Open ${selectedPath} in editor`}
                      >
                        <SquareArrowOutUpRight size={9} />
                      </button>
                    </div>
                    <div className="flex h-6 items-center gap-2 border-t border-[hsl(var(--wb-border-subtle)/0.65)] px-2">
                      <AttributionRevisionBadge
                        attributions={selectedAttributions}
                        diff={diff}
                        scope={diffScope}
                      />
                      {selectedMatchingAttribution?.introducedLines?.length ? (
                        <span
                          className="min-w-0 truncate text-[8px] text-[hsl(var(--wb-text-muted))]"
                          title="Only marked new-side lines are conservatively verified against the matching Agent write."
                        >
                          Marked = verified Agent additions
                        </span>
                      ) : null}
                      {selectedFile && (
                        <div className="ml-auto">
                          <DiffScopeControl
                            file={selectedFile}
                            value={diffScope}
                            onChange={setDiffScope}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <UnifiedDiffView
                  diff={diff}
                  loading={diffLoading}
                  scope={diffScope}
                  attributions={selectedAttributions}
                  onOpenLine={
                    selectedPath &&
                    selectedFile?.status !== "deleted"
                      ? async (line) => {
                          setError(null);
                          try {
                            const tabId = await openProjectFileInEditor(
                              selectedPath,
                            );
                            window.requestAnimationFrame(() =>
                              requestEditorRangeReveal({
                                tabId,
                                range: {
                                  startLine: line,
                                  startColumn: 1,
                                  endLine: line,
                                  endColumn: 1,
                                },
                                focus: true,
                              }),
                            );
                          } catch (reason) {
                            setError(
                              reason instanceof Error
                                ? reason.message
                                : String(reason),
                            );
                          }
                        }
                      : undefined
                  }
                />
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

const DIFF_SCOPES: readonly {
  value: ProjectGitDiffScope;
  label: string;
  title: string;
}[] = [
  { value: "all", label: "All", title: "Changes compared with HEAD" },
  { value: "staged", label: "Staged", title: "Changes in the Git index" },
  { value: "working", label: "Working", title: "Unstaged and untracked changes" },
];

function isDiffScopeAvailable(
  file: ProjectGitFileChange,
  scope: ProjectGitDiffScope,
) {
  if (scope === "staged") return file.staged;
  if (scope === "working") return file.unstaged || file.untracked;
  return true;
}

function DiffScopeControl({
  file,
  value,
  onChange,
}: {
  file: ProjectGitFileChange;
  value: ProjectGitDiffScope;
  onChange: (scope: ProjectGitDiffScope) => void;
}) {
  return (
    <div
      className="flex h-5 shrink-0 overflow-hidden rounded-[4px] border border-[hsl(var(--wb-border-subtle))]"
      role="group"
      aria-label="Diff scope"
    >
      {DIFF_SCOPES.map((scope) => {
        const available = isDiffScopeAvailable(file, scope.value);
        return (
          <button
            key={scope.value}
            type="button"
            className={cn(
              "border-r border-[hsl(var(--wb-border-subtle))] px-1.5 text-[8px] text-[hsl(var(--wb-text-muted))] last:border-r-0 hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[hsl(var(--wb-accent))] disabled:cursor-not-allowed disabled:opacity-35",
              value === scope.value &&
                "bg-[hsl(var(--wb-active))] text-[hsl(var(--wb-text))]",
            )}
            onClick={() => onChange(scope.value)}
            disabled={!available}
            aria-pressed={value === scope.value}
            title={available ? scope.title : `${scope.title} (none)`}
          >
            {scope.label}
          </button>
        );
      })}
    </div>
  );
}

function ChangeFileButton({
  file,
  selected,
  onSelect,
  agentWriteCount,
}: {
  file: ProjectGitFileChange;
  selected: boolean;
  onSelect: () => void;
  agentWriteCount: number;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-6 items-center gap-1.5 px-2 text-left text-[10px] text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[hsl(var(--wb-accent))]",
        selected && "bg-[hsl(var(--wb-active))] text-[hsl(var(--wb-text))]",
      )}
      onClick={onSelect}
    >
      <span className={cn("w-3 shrink-0 text-center font-mono text-[9px]", statusTone(file))}>
        {statusLetter(file)}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono" title={file.relativePath}>
        {file.relativePath}
      </span>
      {file.staged && <span className="shrink-0 text-[8px] uppercase">S</span>}
      {file.unstaged && <span className="shrink-0 text-[8px] uppercase">W</span>}
      {agentWriteCount > 0 && (
        <span
          className="shrink-0 rounded-[3px] bg-[hsl(var(--wb-accent)/0.12)] px-1 text-[8px] text-[hsl(var(--wb-accent))]"
          title={`Agent wrote this path${agentWriteCount > 1 ? ` ${agentWriteCount} times` : ""}; the current content may differ`}
        >
          AI{agentWriteCount > 1 ? ` ${agentWriteCount}` : ""}
        </span>
      )}
    </button>
  );
}

function AttributionRevisionBadge({
  attributions,
  diff,
  scope,
}: {
  attributions: readonly AssistantFileChangeAttribution[];
  diff: ProjectGitFileDiff | null;
  scope: ProjectGitDiffScope;
}) {
  if (!diff || attributions.length === 0) return null;
  const matchingAttribution = matchingAttributionForDiff(attributions, diff);
  const scopeDescription = currentSideDescription(scope);
  let label: string;
  let title: string;
  let tone: string;

  if (matchingAttribution) {
    const lineCount = matchingAttribution.introducedLines?.length ?? 0;
    const lineLabel =
      lineCount > 0
        ? ` · ${lineCount}${matchingAttribution.lineEvidenceTruncated ? "+" : ""} ${lineCount === 1 ? "line" : "lines"}`
        : "";
    label = `AI match${lineLabel}`;
    title = `${scopeDescription} exactly matches an Agent-written version from “${truncateTurnLabel(matchingAttribution.userMessage)}”. Numbered line evidence is conservative and only claims new-side lines absent from the pre-write file.`;
    tone = "text-emerald-600 dark:text-emerald-400";
  } else if (diff.currentSideRevisionStatus === "available") {
    label = "AI differs";
    title = `${scopeDescription} does not match any Agent-written version in this selection.`;
    tone = "text-amber-600 dark:text-amber-400";
  } else if (diff.currentSideRevisionStatus === "missing") {
    label = "AI missing";
    title = `${scopeDescription} has no current content to compare with the recorded Agent version.`;
    tone = "text-red-600 dark:text-red-400";
  } else {
    label = "AI unverified";
    title = `${scopeDescription} could not be revision-verified within the safe file boundary.`;
    tone = "text-[hsl(var(--wb-text-muted))]";
  }

  return (
    <span
      className={cn("flex shrink-0 items-center gap-0.5 text-[8px]", tone)}
      role="status"
      aria-label={title}
      title={title}
    >
      <Bot size={8} aria-hidden="true" />
      {label}
    </span>
  );
}

function matchingAttributionForDiff(
  attributions: readonly AssistantFileChangeAttribution[],
  diff: ProjectGitFileDiff,
) {
  return [...attributions]
    .reverse()
    .find((change) => change.revision === diff.currentSideRevision);
}

function currentSideDescription(scope: ProjectGitDiffScope) {
  if (scope === "staged") return "Staged content";
  if (scope === "working") return "Working tree content";
  return "Current file content";
}

function truncateTurnLabel(message: string) {
  const normalized = message.replace(/\s+/gu, " ").trim();
  return normalized.length <= 52 ? normalized : `${normalized.slice(0, 49)}...`;
}

function UnifiedDiffView({
  diff,
  loading,
  scope,
  attributions,
  onOpenLine,
}: {
  diff: ProjectGitFileDiff | null;
  loading: boolean;
  scope: ProjectGitDiffScope;
  attributions: readonly AssistantFileChangeAttribution[];
  onOpenLine?: (line: number) => Promise<void> | void;
}) {
  const lines = useMemo(() => (diff ? unifiedDiffLines(diff.patch) : []), [diff]);
  const matchingAttribution = useMemo(
    () => (diff ? matchingAttributionForDiff(attributions, diff) : undefined),
    [attributions, diff],
  );
  const introducedLines = useMemo(
    () => new Set(matchingAttribution?.introducedLines ?? []),
    [matchingAttribution],
  );
  const agentLineCountByHunk = useMemo(() => {
    const counts = new Map<number, number>();
    for (const line of lines) {
      if (
        line.kind !== "add" ||
        line.newLine === null ||
        line.hunkIndex === null ||
        !introducedLines.has(line.newLine)
      ) {
        continue;
      }
      counts.set(line.hunkIndex, (counts.get(line.hunkIndex) ?? 0) + 1);
    }
    return counts;
  }, [introducedLines, lines]);
  if (loading && !diff) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center gap-1.5 text-[9px] text-[hsl(var(--wb-text-muted))]">
        <Loader2 size={10} className="animate-spin motion-reduce:animate-none" /> Loading diff
      </div>
    );
  }
  if (!diff) return null;
  if (diff.binary) {
    return <div className="px-3 py-3 text-[10px] text-[hsl(var(--wb-text-muted))]">Binary file changed</div>;
  }
  if (!diff.patch) {
    return (
      <div className="px-3 py-3 text-[10px] leading-4 text-[hsl(var(--wb-text-muted))]">
        {emptyDiffMessage(scope)}
      </div>
    );
  }
  return (
    <div className="custom-scrollbar min-h-0 flex-1 overflow-auto bg-[hsl(var(--wb-editor))] font-mono text-[9px] leading-4" role="region" aria-label={`Diff for ${diff.relativePath}`}>
      {diff.truncated && (
        <div className="sticky top-0 z-10 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel-raised))] px-2 py-1 text-[hsl(var(--wb-text-muted))]">
          Diff truncated at 1 MiB
        </div>
      )}
      {lines.map((line, index) => {
        const isVerifiedAgentLine =
          line.kind === "add" &&
          line.newLine !== null &&
          introducedLines.has(line.newLine);
        const agentLinesInHunk =
          line.kind === "hunk" && line.hunkIndex !== null
            ? agentLineCountByHunk.get(line.hunkIndex) ?? 0
            : 0;
        return (
          <div
            key={`${index}-${line.oldLine}-${line.newLine}`}
            data-agent-attributed-line={isVerifiedAgentLine || undefined}
            title={
              isVerifiedAgentLine
                ? "Verified new-side line from the matching Agent write"
                : undefined
            }
            className={cn(
              "grid min-w-max grid-cols-[34px_34px_minmax(0,1fr)]",
              line.kind === "add" &&
                "bg-emerald-500/10 text-emerald-700 dark:text-emerald-200",
              line.kind === "remove" &&
                "bg-red-500/10 text-red-700 dark:text-red-200",
              line.kind === "hunk" &&
                "bg-[hsl(var(--wb-accent)/0.08)] text-[hsl(var(--wb-accent))]",
              line.kind === "meta" &&
                "text-[hsl(var(--wb-text-muted))]",
              isVerifiedAgentLine &&
                "shadow-[inset_2px_0_0_hsl(var(--wb-accent))]",
            )}
          >
            <span className="select-none border-r border-[hsl(var(--wb-border-subtle)/0.65)] px-1 text-right text-[hsl(var(--wb-text-muted))]">
              {line.oldLine || ""}
            </span>
            {line.newLine && onOpenLine ? (
              <button
                type="button"
                className="select-none border-r border-[hsl(var(--wb-border-subtle)/0.65)] px-1 text-right text-[hsl(var(--wb-text-muted))] hover:bg-[hsl(var(--wb-hover))] hover:text-[hsl(var(--wb-text))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[hsl(var(--wb-accent))]"
                onClick={() => void onOpenLine(line.newLine!)}
                title={`Open line ${line.newLine} in ${diff.relativePath}`}
                aria-label={`Open line ${line.newLine} in ${diff.relativePath}`}
              >
                {line.newLine}
              </button>
            ) : (
              <span className="select-none border-r border-[hsl(var(--wb-border-subtle)/0.65)] px-1 text-right text-[hsl(var(--wb-text-muted))]">
                {line.newLine || ""}
              </span>
            )}
            <span
              className={cn(
                "px-2",
                line.kind === "hunk"
                  ? "flex items-center gap-2"
                  : "whitespace-pre",
              )}
            >
              <span>{line.content || " "}</span>
              {agentLinesInHunk > 0 && (
                <span
                  className="rounded-[3px] bg-[hsl(var(--wb-accent)/0.14)] px-1 text-[8px] font-sans font-medium text-[hsl(var(--wb-accent))]"
                  title={`${agentLinesInHunk} added ${agentLinesInHunk === 1 ? "line" : "lines"} in this hunk are verified against the matching Agent write`}
                >
                  AI {agentLinesInHunk}
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function emptyDiffMessage(scope: ProjectGitDiffScope) {
  if (scope === "staged") return "No staged textual changes for this file.";
  if (scope === "working") {
    return "No working tree textual changes for this file.";
  }
  return "No textual changes compared with HEAD for this file.";
}

function statusLetter(file: ProjectGitFileChange) {
  if (file.conflicted) return "!";
  if (file.untracked) return "?";
  if (file.status === "added") return "A";
  if (file.status === "deleted") return "D";
  if (file.status === "renamed") return "R";
  return "M";
}

function statusTone(file: ProjectGitFileChange) {
  if (file.conflicted) return "text-red-500";
  if (file.untracked || file.status === "added") return "text-emerald-500";
  if (file.status === "deleted") return "text-red-500";
  if (file.status === "renamed") return "text-sky-500";
  return "text-amber-500";
}
