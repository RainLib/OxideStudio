import type { AssistantProjectFileChange } from "@/ai/assistant/turns";
import { unifiedDiffLines, type DiffLine } from "@/lib/unifiedDiff";
import { cn } from "@/lib/utils";
import {
  projectFilesService,
  type ProjectFileRead,
  type ProjectGitFileDiff,
} from "@/services/tauri/project-files.service";
import { CircleAlert, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

type AssistantToolDiffPreviewProps = {
  projectId: string;
  expectedRoot?: string | null;
  change: AssistantProjectFileChange;
};

type DiffPreview = {
  patch: string;
  additions: number;
  deletions: number;
  truncated: boolean;
  source: "git" | "created-file" | "recorded-additions";
};

type PreviewState =
  | { status: "loading" }
  | { status: "ready"; preview: DiffPreview }
  | { status: "stale" }
  | { status: "binary" }
  | { status: "empty" }
  | { status: "unavailable" };

export function AssistantToolDiffPreview({
  projectId,
  expectedRoot,
  change,
}: AssistantToolDiffPreviewProps) {
  const [state, setState] = useState<PreviewState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    const load = async () => {
      try {
        const diff = await projectFilesService.getGitFileDiff(
          projectId,
          change.relativePath,
          expectedRoot,
          "all",
        );
        if (cancelled) return;

        const revisionState = revisionMatchState(diff, change.revision);
        if (revisionState === "stale") {
          setState({ status: "stale" });
          return;
        }
        if (revisionState === "match") {
          if (diff.binary) {
            setState({ status: "binary" });
            return;
          }
          if (diff.patch) {
            setState({
              status: "ready",
              preview: {
                patch: diff.patch,
                additions: diff.additions,
                deletions: diff.deletions,
                truncated: diff.truncated,
                source: "git",
              },
            });
            return;
          }
        }
        // Without a matching new-side revision, the Git patch cannot be tied
        // to this tool call. Try the recorded write evidence instead.
      } catch {
        // A project does not have to be a Git repository. The recorded write
        // evidence below still gives created files and conservative additions
        // a useful diff-shaped inspection surface.
      }

      const fallback = await loadRecordedWritePreview(
        projectId,
        expectedRoot,
        change,
      );
      if (!cancelled) setState(fallback);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [
    change.introducedLines,
    change.operation,
    change.relativePath,
    change.revision,
    expectedRoot,
    projectId,
  ]);

  return (
    <div
      className="mt-1 min-w-0 overflow-hidden border-l border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-editor))]"
      data-assistant-tool-diff={change.relativePath}
    >
      {state.status === "ready" && (
        <div className="flex min-h-6 min-w-0 items-center justify-end gap-1.5 border-b border-[hsl(var(--wb-border-subtle)/0.75)] px-2 text-[9px]">
          <span
            className="shrink-0 text-[8px] text-[hsl(var(--wb-text-muted))]"
            title={previewSourceLabel(state.preview.source)}
          >
            {previewSourceShortLabel(state.preview.source)}
          </span>
          <span className="shrink-0 text-emerald-600 dark:text-emerald-400">
            +{state.preview.additions}
          </span>
          <span className="shrink-0 text-red-600 dark:text-red-400">
            -{state.preview.deletions}
          </span>
        </div>
      )}

      {state.status === "loading" && (
        <PreviewMessage>
          <Loader2
            size={10}
            className="animate-spin motion-reduce:animate-none"
            aria-hidden="true"
          />
          Loading changed lines
        </PreviewMessage>
      )}
      {state.status === "stale" && (
        <PreviewMessage>
          <CircleAlert size={10} className="shrink-0 text-amber-500" />
          The file changed after this Agent write. Review its current version in
          Changes.
        </PreviewMessage>
      )}
      {state.status === "binary" && (
        <PreviewMessage>Binary file changed; no line diff is available.</PreviewMessage>
      )}
      {state.status === "empty" && (
        <PreviewMessage>No changed lines remain for this recorded write.</PreviewMessage>
      )}
      {state.status === "unavailable" && (
        <PreviewMessage>
          The original changed lines are no longer available for this write.
        </PreviewMessage>
      )}
      {state.status === "ready" && (
        <CompactUnifiedDiff
          preview={state.preview}
          relativePath={change.relativePath}
          introducedLines={
            state.preview.source === "git" ? change.introducedLines : undefined
          }
        />
      )}
    </div>
  );
}

function PreviewMessage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-14 items-center justify-center gap-1.5 px-3 py-3 text-center text-[9px] leading-4 text-[hsl(var(--wb-text-muted))]">
      {children}
    </div>
  );
}

function CompactUnifiedDiff({
  preview,
  relativePath,
  introducedLines,
}: {
  preview: DiffPreview;
  relativePath: string;
  introducedLines?: readonly number[];
}) {
  const lines = useMemo(
    () => visibleDiffLines(unifiedDiffLines(preview.patch)),
    [preview.patch],
  );
  const attributedLines = useMemo(
    () => new Set(introducedLines ?? []),
    [introducedLines],
  );
  const sourceLabel = previewSourceLabel(preview.source);

  return (
    <div
      className="no-scrollbar max-h-56 min-w-0 overflow-x-hidden overflow-y-auto font-mono text-[9px] leading-4"
      role="region"
      aria-label={`Changed lines for ${relativePath}`}
      title={sourceLabel}
    >
      {preview.truncated && (
        <div className="sticky top-0 z-10 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-panel-raised))] px-2 py-1 font-sans text-[8px] text-[hsl(var(--wb-text-muted))]">
          Diff truncated
        </div>
      )}
      {lines.map((line, index) => (
        <DiffRow
          key={`${index}-${line.oldLine}-${line.newLine}`}
          line={line}
          agentAttributed={
            line.kind === "add" &&
            line.newLine !== null &&
            attributedLines.has(line.newLine)
          }
        />
      ))}
    </div>
  );
}

function DiffRow({
  line,
  agentAttributed,
}: {
  line: DiffLine;
  agentAttributed: boolean;
}) {
  return (
    <div
      className={cn(
        "grid min-w-0 grid-cols-[28px_28px_minmax(0,1fr)]",
        line.kind === "add" &&
          "bg-emerald-500/10 text-emerald-700 dark:text-emerald-200",
        line.kind === "remove" &&
          "bg-red-500/10 text-red-700 dark:text-red-200",
        line.kind === "hunk" &&
          "bg-[hsl(var(--wb-accent)/0.08)] text-[hsl(var(--wb-accent))]",
        line.kind === "context" && "text-[hsl(var(--wb-text-muted))]",
        agentAttributed && "shadow-[inset_2px_0_0_hsl(var(--wb-accent))]",
      )}
      data-diff-line-kind={line.kind}
      data-agent-attributed-line={agentAttributed || undefined}
      title={
        agentAttributed
          ? "Verified new-side line from this Agent write"
          : undefined
      }
    >
      <span className="select-none border-r border-[hsl(var(--wb-border-subtle)/0.65)] px-1 text-right text-[hsl(var(--wb-text-muted))]">
        {line.oldLine ?? ""}
      </span>
      <span className="select-none border-r border-[hsl(var(--wb-border-subtle)/0.65)] px-1 text-right text-[hsl(var(--wb-text-muted))]">
        {line.newLine ?? ""}
      </span>
      <span className="min-w-0 whitespace-pre-wrap break-words px-2 [overflow-wrap:anywhere]">
        {line.content || " "}
      </span>
    </div>
  );
}

function visibleDiffLines(lines: DiffLine[]) {
  return lines.filter(
    (line, index) =>
      line.kind !== "meta" ||
      (line.content.length > 0 &&
        !line.content.startsWith("diff --git ") &&
        !line.content.startsWith("index ") &&
        !line.content.startsWith("--- ") &&
        !line.content.startsWith("+++ ") &&
        index < lines.length - 1),
  );
}

function revisionMatchState(
  diff: ProjectGitFileDiff,
  recordedRevision: string,
) {
  if (
    diff.currentSideRevisionStatus === "available" &&
    diff.currentSideRevision !== recordedRevision
  ) {
    return "stale" as const;
  }
  if (diff.currentSideRevisionStatus === "missing") return "stale" as const;
  if (diff.currentSideRevisionStatus === "available") return "match" as const;
  return "unverified" as const;
}

function previewSourceLabel(source: DiffPreview["source"]) {
  if (source === "git") return "Git diff against HEAD · revision matched";
  if (source === "created-file") return "Recorded created file";
  return "Recorded Agent additions";
}

function previewSourceShortLabel(source: DiffPreview["source"]) {
  if (source === "git") return "HEAD";
  if (source === "created-file") return "created";
  return "recorded";
}

async function loadRecordedWritePreview(
  projectId: string,
  expectedRoot: string | null | undefined,
  change: AssistantProjectFileChange,
): Promise<PreviewState> {
  let file: ProjectFileRead;
  try {
    file = await projectFilesService.readProjectFile(
      projectId,
      change.relativePath,
      expectedRoot,
    );
  } catch {
    return { status: "unavailable" };
  }
  if (file.revision !== change.revision) return { status: "stale" };

  if (change.operation === "created") {
    const contentLines = fileContentLines(file.content);
    if (contentLines.length === 0) return { status: "empty" };
    return {
      status: "ready",
      preview: {
        patch: createdFilePatch(change.relativePath, contentLines),
        additions: contentLines.length,
        deletions: 0,
        truncated: false,
        source: "created-file",
      },
    };
  }

  const introducedLines = [...new Set(change.introducedLines ?? [])]
    .filter((line) => Number.isInteger(line) && line > 0)
    .sort((left, right) => left - right);
  if (introducedLines.length === 0) return { status: "unavailable" };
  const contentLines = fileContentLines(file.content);
  const availableLines = introducedLines.filter(
    (line) => line <= contentLines.length,
  );
  if (availableLines.length === 0) return { status: "unavailable" };
  return {
    status: "ready",
    preview: {
      patch: recordedAdditionsPatch(contentLines, availableLines),
      additions: availableLines.length,
      deletions: 0,
      truncated: Boolean(change.lineEvidenceTruncated),
      source: "recorded-additions",
    },
  };
}

function fileContentLines(content: string) {
  if (!content) return [];
  const lines = content.replace(/\r\n/gu, "\n").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function createdFilePatch(relativePath: string, lines: string[]) {
  return [
    "--- /dev/null",
    `+++ b/${relativePath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
  ].join("\n");
}

function recordedAdditionsPatch(contentLines: string[], lineNumbers: number[]) {
  const groups: number[][] = [];
  for (const lineNumber of lineNumbers) {
    const last = groups[groups.length - 1];
    const previousLine = last?.[last.length - 1];
    if (last && previousLine !== undefined && lineNumber === previousLine + 1) {
      last.push(lineNumber);
    } else groups.push([lineNumber]);
  }
  return groups
    .flatMap((group) => [
      `@@ -${group[0]},0 +${group[0]},${group.length} @@`,
      ...group.map((lineNumber) => `+${contentLines[lineNumber - 1]}`),
    ])
    .join("\n");
}
