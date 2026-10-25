import { confirmAction } from "@/lib/appDialogs";
import type { GitFileDiffPreview } from "@/lib/projectGitDiff";
import { openProjectGitDiffInEditor } from "@/lib/projectFileOpen";
import { unifiedDiffHunkPatch, unifiedDiffLines } from "@/lib/unifiedDiff";
import {
  projectFilesService,
  projectGitService,
  type ProjectGitFileDiff,
} from "@/services/tauri";
import { useProjectGitStore } from "@/store/useProjectGitStore";
import { useTabStore } from "@/store/useTabStore";
import {
  ChevronLeft,
  ChevronRight,
  GitCompareArrows,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export function GitFileDiffReviewBar({ preview }: { preview: GitFileDiffPreview }) {
  const [diff, setDiff] = useState<ProjectGitFileDiff | null>(null);
  const [hunkPosition, setHunkPosition] = useState(0);
  const [operation, setOperation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshRepository = useProjectGitStore((state) => state.refresh);
  const hunkIndexes = useMemo(
    () =>
      unifiedDiffLines(diff?.patch ?? "")
        .filter((line) => line.kind === "hunk" && line.hunkIndex !== null)
        .map((line) => line.hunkIndex as number),
    [diff?.patch],
  );

  useEffect(() => {
    let disposed = false;
    void projectFilesService
      .getGitFileDiff(
        preview.projectId,
        preview.relativePath,
        preview.expectedRoot,
        preview.scope,
      )
      .then((value) => {
        if (!disposed) {
          setDiff(value);
          setHunkPosition(0);
          setError(null);
        }
      })
      .catch((reason) => {
        if (!disposed) setError(errorMessage(reason));
      });
    return () => {
      disposed = true;
    };
  }, [preview]);

  const apply = async (
    name: string,
    action: (patch: string) => Promise<unknown>,
    patch = diff?.patch ?? "",
  ) => {
    if (!patch || operation) return;
    setOperation(name);
    setError(null);
    try {
      await action(patch);
      await refreshRepository(preview.projectId, preview.expectedRoot);
      if (name === "discard-file") {
        const tabs = useTabStore.getState();
        if (tabs.activeTabId) tabs.closeTab(tabs.activeTabId);
        return;
      }
      const nextScope = name === "stage-file"
        ? "staged"
        : name === "unstage-file"
          ? "working"
          : preview.scope;
      await openProjectGitDiffInEditor(
        preview.projectId,
        preview.relativePath,
        preview.expectedRoot ?? "",
        nextScope,
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setOperation(null);
    }
  };
  const activeHunk = hunkIndexes[hunkPosition];
  const activeHunkPatch =
    activeHunk === undefined || !diff
      ? null
      : unifiedDiffHunkPatch(diff.patch, activeHunk);
  const staged = preview.scope === "staged";

  return (
    <div className="shrink-0 border-b border-[hsl(var(--wb-border-subtle))] bg-[hsl(var(--wb-toolbar))]">
      <div className="wb-editor-commandbar justify-between gap-2 border-0">
        <div className="flex min-w-0 items-center gap-1.5 truncate text-[10px] wb-muted" title={preview.relativePath}>
          <GitCompareArrows size={12} className="shrink-0 text-[hsl(var(--wb-accent))]" />
          <span className="truncate">{preview.relativePath}</span>
          <span className="uppercase opacity-70">{preview.scope}</span>
        </div>
        <span className="flex shrink-0 gap-2 font-mono text-[9px]">
          <span className="text-emerald-400">+{preview.additions}</span>
          <span className="text-red-400">-{preview.deletions}</span>
        </span>
      </div>
      <div className="flex min-h-7 items-center gap-1 border-t border-[hsl(var(--wb-border-subtle))] px-2">
        {hunkIndexes.length > 0 && (
          <>
            <button type="button" className="wb-icon-button h-5 w-5" disabled={hunkPosition <= 0 || Boolean(operation)} onClick={() => setHunkPosition((value) => Math.max(0, value - 1))} title="Previous hunk"><ChevronLeft size={10} /></button>
            <span className="text-[8px] tabular-nums text-[hsl(var(--wb-text-muted))]">Hunk {hunkPosition + 1}/{hunkIndexes.length}</span>
            <button type="button" className="wb-icon-button h-5 w-5" disabled={hunkPosition >= hunkIndexes.length - 1 || Boolean(operation)} onClick={() => setHunkPosition((value) => Math.min(hunkIndexes.length - 1, value + 1))} title="Next hunk"><ChevronRight size={10} /></button>
            <button
              type="button"
              className="wb-text-button h-5 px-1.5 text-[8px]"
              disabled={!activeHunkPatch || Boolean(operation)}
              onClick={() => activeHunkPatch && void apply(
                staged ? "unstage-hunk" : "stage-hunk",
                (patch) => projectGitService.updateIndexPatch(
                  preview.projectId,
                  patch,
                  staged,
                  preview.expectedRoot,
                ),
                activeHunkPatch,
              )}
            >
              {operation?.endsWith("hunk") && <LoaderCircle size={9} className="animate-spin" />}
              {staged ? "Unstage hunk" : "Stage hunk"}
            </button>
            {!staged && (
              <button
                type="button"
                className="wb-text-button h-5 px-1.5 text-[8px] text-red-400"
                disabled={!activeHunkPatch || Boolean(operation)}
                onClick={async () => {
                  if (!activeHunkPatch || !(await confirmAction(`Discard this hunk from ${preview.relativePath}?`))) return;
                  void apply(
                    "discard-hunk",
                    (patch) => projectGitService.applyPatch(
                      preview.projectId,
                      patch,
                      true,
                      preview.expectedRoot,
                    ),
                    activeHunkPatch,
                  );
                }}
              >
                Discard hunk
              </button>
            )}
          </>
        )}
        <div className="ml-auto flex items-center gap-1">
          {!staged && (
            <button
              type="button"
              className="wb-text-button h-5 px-1.5 text-[8px]"
              disabled={!diff?.patch || Boolean(operation)}
              onClick={() => void apply("stage-file", (patch) =>
                projectGitService.updateIndexPatch(preview.projectId, patch, false, preview.expectedRoot))}
            >
              Stage file
            </button>
          )}
          {staged && (
            <button
              type="button"
              className="wb-text-button h-5 px-1.5 text-[8px]"
              disabled={!diff?.patch || Boolean(operation)}
              onClick={() => void apply("unstage-file", (patch) =>
                projectGitService.updateIndexPatch(preview.projectId, patch, true, preview.expectedRoot))}
            >
              Unstage file
            </button>
          )}
          {!staged && (
            <button
              type="button"
              className="wb-text-button h-5 px-1.5 text-[8px] text-red-400"
              disabled={!diff?.patch || Boolean(operation)}
              onClick={async () => {
                if (!(await confirmAction(`Discard all working-tree changes in ${preview.relativePath}?`))) return;
                void apply("discard-file", (patch) =>
                  projectGitService.applyPatch(preview.projectId, patch, true, preview.expectedRoot));
              }}
            >
              <RotateCcw size={9} />Discard
            </button>
          )}
        </div>
      </div>
      {error && <div role="alert" className="border-t border-red-500/20 px-2 py-1 text-[8px] text-red-400">{error}</div>}
    </div>
  );
}

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}
